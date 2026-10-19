import { Buffer } from 'node:buffer';
import { gh, repository, validateSubmission } from './github.mjs';
import { assertAeguideSchema } from '../lib/validate.mjs';

const number = Number(process.env.PR_NUMBER);
const head = process.env.PR_HEAD_SHA;
if (!Number.isSafeInteger(number) || !/^[a-f0-9]{40}$/.test(head || '')) throw new Error('PR context missing');
const pr = await gh('GET', `/pulls/${number}`);
if (!pr || pr.head.repo.full_name !== repository || pr.head.sha !== head || !pr.head.ref.startsWith('submissions/'))
  throw new Error('Unexpected PR source');
const files = await gh('GET', `/pulls/${number}/files?per_page=100`);
if (!Array.isArray(files) || files.length !== 1 || files[0].status !== 'added'
  || !/^submissions\/[a-f0-9-]{36}\.json$/.test(files[0].filename)) throw new Error('PR must add exactly one submission metadata file');
const response = await gh('GET', `/contents/${files[0].filename}?ref=${head}`);
if (!response || response.encoding !== 'base64') throw new Error('Submission file unavailable');
const record = JSON.parse(Buffer.from(response.content.replace(/\s/g, ''), 'base64').toString('utf8'));
validateSubmission(record);
assertAeguideSchema('manifest', record.manifest);
if (files[0].filename !== `submissions/${record.submissionId}.json`) throw new Error('Submission ID mismatch');
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

