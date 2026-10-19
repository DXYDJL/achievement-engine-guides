import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { gh, repository, validateSubmission } from './github.mjs';
import { assertAeguideSchema } from '../lib/validate.mjs';

const number = Number(process.env.PR_NUMBER);
const head = process.env.PR_HEAD_SHA;
if (!Number.isSafeInteger(number) || !/^[a-f0-9]{40}$/.test(head || '')) throw new Error('PR context missing');
const pr = await gh('GET', `/pulls/${number}`);
if (!pr || pr.head.repo.full_name !== repository || pr.head.sha !== head || !pr.head.ref.startsWith('submissions/'))
  throw new Error('Unexpected PR source');
const files = [];
for (let page = 1; page <= 30; page++) {
  const batch = await gh('GET', `/pulls/${number}/files?per_page=100&page=${page}`);
  if (!Array.isArray(batch)) throw new Error('PR file list unavailable');
  files.push(...batch);
  if (batch.length < 100) break;
}
const metadata = files.find((item) => /^submissions\/[a-f0-9-]{36}\.json$/.test(item.filename));
if (!metadata || metadata.status !== 'added') throw new Error('Submission metadata missing');
const response = await gh('GET', `/contents/${metadata.filename}?ref=${head}`);
if (!response || response.encoding !== 'base64') throw new Error('Submission file unavailable');
const record = JSON.parse(Buffer.from(response.content.replace(/\s/g, ''), 'base64').toString('utf8'));
validateSubmission(record);
assertAeguideSchema('manifest', record.manifest);
if (metadata.filename !== `submissions/${record.submissionId}.json`) throw new Error('Submission ID mismatch');
const expected = new Set([metadata.filename, ...record.changeFiles.map((item) => item.path)]);
if (files.length !== expected.size || files.some((item) => item.status !== 'added' || !expected.has(item.filename)))
  throw new Error('PR contains unexpected files');
for (const unit of record.changeFiles) {
  const file = await gh('GET', `/contents/${unit.path}?ref=${head}`);
  if (!file || file.encoding !== 'base64') throw new Error('Contribution unit missing');
  const bytes = Buffer.from(file.content.replace(/\s/g, ''), 'base64');
  if (createHash('sha256').update(bytes).digest('hex') !== unit.sha256) throw new Error('Contribution unit hash mismatch');
  const parsed = JSON.parse(bytes.toString('utf8'));
  if (!['chapter', 'achievement', 'layout', 'notes', 'categories'].includes(parsed.entityType)
    || typeof parsed.entityId !== 'string' || !Array.isArray(parsed.changes) || !parsed.changes.length
    || parsed.changes.some((change) => change.entityType !== parsed.entityType || change.entityId !== parsed.entityId
      || !['add', 'update', 'delete'].includes(change.operation) || typeof change.field !== 'string'))
    throw new Error('Contribution unit invalid');
}
const summary = [
  '### 攻略投稿自动检查通过',
  `- 游戏：${record.manifest.game.title}`,
  `- 攻略：${record.manifest.guide.title} v${record.version}`,
  `- 图片：${record.manifest.assets.length} 张`,
  `- 包 SHA-256：\`${record.packageSha256}\``,
  '',
  '服务端已校验包结构、作者身份、许可证、HTML 与净化后的图片。自动检查通过后，工作流会合并此 PR 并运行发布校验。',
].join('\n');
if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import('node:fs');
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
}
console.log('Submission metadata passed');
