import { open } from 'node:fs/promises';

/** The desktop sanitizes images, but fork authors can replace a Release asset.
 * Re-decode every reviewed image in CI before the package reaches the catalog. */
export async function validateImages(packagePath, parsed) {
  if (!parsed.manifest.assets.length) return;
  const sharp = (await import('sharp')).default;
  sharp.cache(false);
  const file = await open(packagePath, 'r');
  try {
    for (const asset of parsed.manifest.assets) {
      const entry = parsed.entries.get(asset.path);
      if (!entry || entry.size > 100_000_000) throw new Error('Image entry exceeds limit');
      const bytes = Buffer.allocUnsafe(entry.size);
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, entry.dataStart + offset);
        if (!bytesRead) throw new Error('Image entry truncated');
        offset += bytesRead;
      }
      const options = { failOn: 'error', limitInputPixels: 40_000_000, animated: false };
      const image = sharp(bytes, options);
      const metadata = await image.metadata();
      const format = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/webp': 'webp' }[asset.mimeType];
      if (metadata.format !== format || !metadata.width || !metadata.height || (metadata.pages || 1) !== 1
        || metadata.exif || metadata.icc || metadata.iptc || metadata.xmp || metadata.photoshop)
        throw new Error(`Unclean or invalid image: ${asset.path}`);
      await sharp(bytes, options).resize(1, 1).toBuffer();
    }
  } finally { await file.close(); }
}
