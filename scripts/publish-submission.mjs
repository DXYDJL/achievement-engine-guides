import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gh, ghRepo, ghDownloadToFile, repository, validateSubmission } from './github.mjs';
import { assertAeguideSchema } from '../lib/validate.mjs';
import { inspectAeguideFile } from '../lib/validate-file.mjs';
import { validateImages } from './validate-images.mjs';

const sha = process.env.GH_SHA;
const before = process.env.GH_BEFORE;
const appVersion = process.env.APP_VERSION;
let submissionId = process.env.SUBMISSION_ID;
const workflowRunId = process.env.WORKFLOW_RUN_ID;
const GUIDE_OWNER_LOGIN = 'dxydjl0521-maker';
const GUIDE_REVIEWER_LOGINS = new Set([GUIDE_OWNER_LOGIN, 'dxydjl']);

async function uploadOfficialAsset(release, packagePath, assetName) {
  const url = new URL(release.upload_url.replace(/\{.*$/, ''));
  if (url.protocol !== 'https:' || url.hostname !== 'uploads.github.com')
    throw new Error('Unexpected release upload URL');
  url.searchParams.set('name', assetName);
  const size = (await stat(packagePath)).size;
  const response = await fetch(url, {
    method: 'POST',
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${process.env.GH_TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/octet-stream',
      'Content-Length': String(size) },
    body: createReadStream(packagePath), duplex: 'half',
  });
  if (!response.ok) throw new Error(`Official release upload failed: ${response.status}`);
  return response.json();
}
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

let changedFiles;
if (submissionId) {
  if (!/^[a-f0-9-]{36}$/.test(submissionId)) throw new Error('Invalid submission ID');
  changedFiles = [`submissions/${submissionId}.json`];
} else {
  if (!/^[a-f0-9]{40}$/.test(before || '')) throw new Error('Previous commit SHA missing');
  changedFiles = execFileSync('git', ['diff', '--name-only', before, sha, '--', 'submissions'], { encoding: 'utf8' })
    .split(/\r?\n/).filter(Boolean);
}
const files = changedFiles.filter((name) => /^submissions\/[a-f0-9-]{36}\.json$/.test(name));
if (!files.length)
  throw new Error('No valid submission metadata to publish');
const expectedUnits = new Set();

const records = files.map((filename) => ({ filename, record: JSON.parse(readFileSync(filename, 'utf8')) }));
for (const { filename, record } of records) {
  validateSubmission(record);
  assertAeguideSchema('manifest', record.manifest);
  if (filename !== `submissions/${record.submissionId}.json`) throw new Error('Submission ID mismatch');
  for (const unit of record.changeFiles) {
    expectedUnits.add(unit.path);
    const bytes = readFileSync(unit.path);
    if (createHash('sha256').update(bytes).digest('hex') !== unit.sha256)
      throw new Error(`Contribution unit hash mismatch: ${unit.path}`);
  }
}
if (!submissionId && changedFiles.some((name) => !files.includes(name) && !expectedUnits.has(name)))
  throw new Error('Merge changed an unexpected submission file');

for (const { filename, record } of records) {
  const fileCommit = execFileSync('git', ['log', '-1', '--format=%H', '--', filename], { encoding: 'utf8' }).trim();
  const linked = await gh('GET', `/commits/${fileCommit}/pulls`);
  const linkedPr = linked?.find((item) => item.merged_at && item.base.ref === 'main' && item.head.ref === `submissions/${record.submissionId}`);
  if (!linkedPr) throw new Error('Submission was not merged from its validated PR');
  // The commit-to-PR endpoint omits merged_by; fetch the PR to verify the account that merged it.
  const pr = await gh('GET', `/pulls/${linkedPr.number}`);
  if (!pr || !pr.merged_at || pr.base?.ref !== 'main' || pr.head?.ref !== `submissions/${record.submissionId}`)
    throw new Error('Merged submission PR details unavailable');
  const validation = await gh('GET', `/actions/workflows/validate-guide.yml/runs?event=pull_request&branch=${encodeURIComponent(pr.head.ref)}&per_page=100`);
  if (!validation?.workflow_runs?.some((run) => run.name === 'Validate guide submission'
    && run.event === 'pull_request' && run.conclusion === 'success'
    && run.head_branch === pr.head.ref && run.head_sha === pr.head.sha))
    throw new Error('Final PR revision has no successful validation run');
  const reviews = await gh('GET', `/pulls/${pr.number}/reviews?per_page=100`);
  if (!Array.isArray(reviews)) throw new Error('PR reviews unavailable');
  const latestReviewByUser = new Map();
  for (const review of reviews) if (review.user?.login) latestReviewByUser.set(review.user.login.toLowerCase(), review);
  const contributorLogin = record.contributor.githubLogin.toLowerCase();
  const approved = [...latestReviewByUser].some(([login, review]) => GUIDE_REVIEWER_LOGINS.has(login)
    && login !== contributorLogin
    && review.state === 'APPROVED' && review.commit_id === pr.head.sha);
  const mergedByLogin = pr.merged_by?.login?.toLowerCase() || '';
  const authorizedMerge = GUIDE_REVIEWER_LOGINS.has(mergedByLogin);
  // GitHub has no self-approval event, so verify the owner submitted and personally merged this PR.
  const ownerSelfMerge = contributorLogin === GUIDE_OWNER_LOGIN && mergedByLogin === GUIDE_OWNER_LOGIN;
  if (!ownerSelfMerge && (!approved || !authorizedMerge))
    throw new Error('An authorized reviewer must approve this contribution and an authorized account must merge it');

  const sourceRepository = record.assetRepository || repository;
  if (sourceRepository !== repository && sourceRepository.toLowerCase()
    !== `${record.contributor.githubLogin}/achievement-engine-guides`.toLowerCase())
    throw new Error('Submission asset belongs to an unexpected repository');
  const sourceRelease = await ghRepo(sourceRepository, 'GET', `/releases/${record.draftReleaseId}`);
  const sourceAsset = sourceRelease?.assets?.find((item) => item.id === record.assetId);
  const sourceTag = record.assetRepository ? `submission-${record.submissionId}`
    : `guide-${record.guideId}-v${record.version}`;
  const sourceName = record.assetName || `${record.guideId}-v${record.version}.aeguide`;
  if (!sourceRelease || !sourceAsset || sourceRelease.tag_name !== sourceTag
    || sourceAsset.name !== sourceName
    || record.assetRepository && sourceRepository !== repository && (sourceRelease.draft || !sourceRelease.prerelease))
    throw new Error('Submission release asset mismatch');
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'ae-publish-'));
  try {
    const packagePath = path.join(tempDirectory, 'submission.aeguide');
    const downloaded = await ghDownloadToFile(`/releases/assets/${record.assetId}`,
      packagePath, 500_000_000, sourceRepository);
    if (downloaded.size !== sourceAsset.size || downloaded.sha256 !== record.packageSha256)
      throw new Error('Release asset SHA-256 mismatch');
    const parsed = await inspectAeguideFile(packagePath, appVersion);
    if (JSON.stringify(parsed.manifest) !== JSON.stringify(record.manifest))
      throw new Error('Manifest differs from reviewed PR');
    await validateImages(packagePath, parsed);

    const catalogFile = await gh('GET', '/contents/catalog/index.json?ref=main');
    if (!catalogFile || catalogFile.encoding !== 'base64') throw new Error('Catalog unavailable');
    const catalog = JSON.parse(Buffer.from(catalogFile.content.replace(/\s/g, ''), 'base64').toString('utf8'));
    if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.entries)) throw new Error('Catalog schema invalid');
    const sameScope = catalog.entries.filter((item) => item.game.platform === record.manifest.game.platform
      && item.game.platformGameId === record.manifest.game.platformGameId
      && item.guide.language === record.manifest.guide.language);
    // Separate guide IDs are independent series and may coexist for one game and language.
    const versions = sameScope.filter((item) => item.guideId === record.guideId)
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    const prior = catalog.entries.find((item) => item.guideId === record.guideId && item.version === record.version);
    if (prior && prior.sha256 !== record.packageSha256) throw new Error('Catalog version conflict');
    if (!prior && versions.length && versions[0].sha256 !== record.baseRevision)
      throw new Error('Community guide advanced after this PR was reviewed');
    if (!prior && !versions.length && record.baseRevision !== null)
      throw new Error('Community base revision is not published');

    const publishedBody = `已审核通过并发布的社区攻略。投稿 ID: ${record.submissionId}\nSHA-256: ${record.packageSha256}`;
    const tag = `guide-${record.guideId}-v${record.version}`;
    const name = `${record.guideId}-v${record.version}.aeguide`;
    let release = record.assetRepository ? await gh('GET', `/releases/tags/${tag}`) : sourceRelease;
    if (!release) release = await gh('POST', '/releases', {
      tag_name: tag, target_commitish: 'main', draft: true, prerelease: false,
      make_latest: 'false', name: `${record.manifest.guide.title} v${record.version}`,
      body: publishedBody,
    });
    if (release.tag_name !== tag) throw new Error('Official release tag mismatch');
    let asset = release.assets.find((item) => item.name === name);
    if (asset) {
      const existing = await ghDownloadToFile(`/releases/assets/${asset.id}`,
        path.join(tempDirectory, 'official.aeguide'), 500_000_000);
      if (existing.sha256 !== record.packageSha256) throw new Error('Official release asset hash mismatch');
    } else asset = await uploadOfficialAsset(release, packagePath, name);
    if (asset.size !== downloaded.size) throw new Error('Official release asset size mismatch');
    await gh('PATCH', `/releases/${release.id}`, {
      draft: false, prerelease: false, make_latest: 'false', body: publishedBody,
    });
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
  } finally { await rm(tempDirectory, { recursive: true, force: true }); }
}
