import { checkCommunitySubmissionPolicy } from '../lib/validate.mjs';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const repository = process.env.GH_REPO;
const token = process.env.GH_TOKEN;
if (!repository || !/^[\w.-]+\/[\w.-]+$/.test(repository) || !token) throw new Error('GH_REPO / GH_TOKEN missing');

export async function gh(method, pathname, body, accept = 'application/vnd.github+json') {
  const response = await fetch(`https://api.github.com/repos/${repository}${pathname}`, {
    method,
    headers: { Accept: accept, Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub ${method} ${pathname}: ${response.status}`);
  return accept === 'application/octet-stream' ? new Uint8Array(await response.arrayBuffer()) : response.json();
}

export async function ghDownloadToFile(pathname, filePath, maxBytes) {
  const response = await fetch(`https://api.github.com/repos/${repository}${pathname}`, {
    headers: { Accept: 'application/octet-stream', Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28' },
  });
  if (!response.ok || !response.body) throw new Error(`GitHub download ${pathname}: ${response.status}`);
  const hash = createHash('sha256');
  let size = 0;
  const digest = new Transform({ transform(chunk, _encoding, callback) {
    size += chunk.length;
    if (size > maxBytes) return callback(new Error('Release asset exceeds package limit'));
    hash.update(chunk);
    callback(null, chunk);
  } });
  try {
    await pipeline(Readable.fromWeb(response.body), digest, createWriteStream(filePath, { flags: 'wx' }));
    return { size, sha256: hash.digest('hex') };
  } catch (error) {
    await rm(filePath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export function validateSubmission(record) {
  if (!record || typeof record !== 'object' || !/^[a-f0-9-]{36}$/.test(record.submissionId)
    || !/^[a-f0-9-]{36}$/.test(record.guideId) || !/^\d+\.\d+\.\d+$/.test(record.version)
    || !/^[a-f0-9]{64}$/.test(record.packageSha256)
    || !Number.isSafeInteger(record.draftReleaseId) || !Number.isSafeInteger(record.assetId)
    || record.manifest?.guideId !== record.guideId || record.manifest?.version !== record.version
    || typeof record.manifest?.license !== 'string' || !Array.isArray(record.manifest?.assets)
    || checkCommunitySubmissionPolicy(record.manifest)
    || !Number.isSafeInteger(record.contributor?.userId) || record.contributor.userId <= 0
    || !/^[a-z0-9-]{1,39}$/i.test(record.contributor?.githubLogin || '')
    || record.manifest?.author?.githubLogin?.toLowerCase() !== record.contributor.githubLogin.toLowerCase()
    || !(record.baseRevision === null || /^[a-f0-9]{64}$/.test(record.baseRevision || ''))
    || !Array.isArray(record.changeFiles) || record.changeFiles.length < 1 || record.changeFiles.length > 2500
    || record.changeFiles.some((item) => !item || typeof item.path !== 'string'
      || !new RegExp(`^submissions/${record.submissionId}/units/(?:chapter|achievement|layout|notes|categories)-[a-f0-9]{20}\\.json$`).test(item.path)
      || !/^[a-f0-9]{64}$/.test(item.sha256 || ''))) {
    throw new Error('Submission metadata invalid');
  }
  if (new Set(record.changeFiles.map((item) => item.path)).size !== record.changeFiles.length)
    throw new Error('Duplicate contribution unit path');
}
