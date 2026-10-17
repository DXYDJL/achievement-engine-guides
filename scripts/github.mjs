import { checkCommunitySubmissionPolicy } from '../lib/validate.mjs';

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

export function validateSubmission(record) {
  if (!record || typeof record !== 'object' || !/^[a-f0-9-]{36}$/.test(record.submissionId)
    || !/^[a-f0-9-]{36}$/.test(record.guideId) || !/^\d+\.\d+\.\d+$/.test(record.version)
    || !/^[a-f0-9]{64}$/.test(record.packageSha256)
    || !Number.isSafeInteger(record.draftReleaseId) || !Number.isSafeInteger(record.assetId)
    || record.manifest?.guideId !== record.guideId || record.manifest?.version !== record.version
    || typeof record.manifest?.license !== 'string' || !Array.isArray(record.manifest?.assets)
    || checkCommunitySubmissionPolicy(record.manifest)) {
    throw new Error('Submission metadata invalid');
  }
}
