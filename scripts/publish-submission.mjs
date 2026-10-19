import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gh, ghDownloadToFile, validateSubmission } from './github.mjs';
import { assertAeguideSchema } from '../lib/validate.mjs';
import { inspectAeguideFile } from '../lib/validate-file.mjs';

const sha = process.env.GH_SHA;
const before = process.env.GH_BEFORE;
const appVersion = process.env.APP_VERSION;
let submissionId = process.env.SUBMISSION_ID;
const workflowRunId = process.env.WORKFLOW_RUN_ID;
if (!/^\d+\.\d+\.\d+$/.test(appVersion || '') || !/^[a-f0-9]{40}$/.test(sha || ''))
  throw new Error('GUIDE_APP_VERSION or commit SHA missing');

if (workflowRunId) {
  if (!/^\d+$/.test(workflowRunId)) throw new Error('Invalid validation workflow run ID');
  const run = await gh('GET', `/actions/runs/${workflowRunId}`);
  if (!run || run.name !== 'Validate guide submission' || run.event !== 'pull_request' || run.conclusion !== 'success')
    throw new Error('Submission validation workflow did not succeed');
  const match = /^submissions\/([a-f0-9-]{36})$/.exec(run.head_branch || '');
  if (!match) throw new Error('Validation run is not linked to a submission PR');
  submissionId = match[1];
}

let files;
if (submissionId) {
  if (!/^[a-f0-9-]{36}$/.test(submissionId)) throw new Error('Invalid submission ID');
  files = [`submissions/${submissionId}.json`];
} else {
  if (!/^[a-f0-9]{40}$/.test(before || '')) throw new Error('Previous commit SHA missing');
  files = execFileSync('git', ['diff', '--name-only', before, sha, '--', 'submissions'], { encoding: 'utf8' })
    .split(/\r?\n/).filter(Boolean);
}
if (!files.length || files.some((name) => !/^submissions\/[a-f0-9-]{36}\.json$/.test(name)))
  throw new Error('No valid submission metadata to publish');

for (const filename of files) {
  const record = JSON.parse(readFileSync(filename, 'utf8'));
  validateSubmission(record);
  assertAeguideSchema('manifest', record.manifest);
  if (filename !== `submissions/${record.submissionId}.json`) throw new Error('Submission ID mismatch');

  const fileCommit = execFileSync('git', ['log', '-1', '--format=%H', '--', filename], { encoding: 'utf8' }).trim();
  const linked = await gh('GET', `/commits/${fileCommit}/pulls`);
  const pr = linked?.find((item) => item.merged_at && item.base.ref === 'main' && item.head.ref === `submissions/${record.submissionId}`);
  if (!pr) throw new Error('Submission was not merged from its validated PR');

  const release = await gh('GET', `/releases/${record.draftReleaseId}`);
  const asset = release?.assets?.find((item) => item.id === record.assetId);
  if (!release || !asset || release.tag_name !== `guide-${record.guideId}-v${record.version}`
    || asset.name !== `${record.guideId}-v${record.version}.aeguide`) throw new Error('Draft release asset mismatch');
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'ae-publish-'));
  try {
    const packagePath = path.join(tempDirectory, 'submission.aeguide');
    const downloaded = await ghDownloadToFile(`/releases/assets/${record.assetId}`, packagePath, 500_000_000);
    if (downloaded.size !== asset.size || downloaded.sha256 !== record.packageSha256)
      throw new Error('Release asset SHA-256 mismatch');
    const parsed = await inspectAeguideFile(packagePath, appVersion);
    if (JSON.stringify(parsed.manifest) !== JSON.stringify(record.manifest))
      throw new Error('Manifest differs from reviewed PR');
  } finally { await rm(tempDirectory, { recursive: true, force: true }); }

  if (release.draft) await gh('PATCH', `/releases/${release.id}`, { draft: false, prerelease: false, make_latest: 'false' });
  const catalogFile = await gh('GET', '/contents/catalog/index.json?ref=main');
  if (!catalogFile || catalogFile.encoding !== 'base64') throw new Error('Catalog unavailable');
  const catalog = JSON.parse(Buffer.from(catalogFile.content.replace(/\s/g, ''), 'base64').toString('utf8'));
  if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.entries)) throw new Error('Catalog schema invalid');
  const prior = catalog.entries.find((item) => item.guideId === record.guideId && item.version === record.version);
  if (prior && prior.sha256 !== record.packageSha256) throw new Error('Catalog version conflict');
  if (!prior) {
    catalog.entries.push({
      guideId: record.guideId, version: record.version, game: record.manifest.game,
      guide: record.manifest.guide, author: record.manifest.author, license: record.manifest.license,
      minAppVersion: record.manifest.compatibility.minAppVersion,
      sha256: record.packageSha256, releaseId: release.id, assetId: asset.id,
      publishedAt: new Date().toISOString(),
    });
    await gh('PUT', '/contents/catalog/index.json', {
      message: `Publish guide ${record.guideId} v${record.version}`,
      content: Buffer.from(JSON.stringify(catalog, null, 2) + '\n').toString('base64'),
      sha: catalogFile.sha, branch: 'main',
    });
  }
  console.log(`Published ${record.guideId} v${record.version}`);
}

