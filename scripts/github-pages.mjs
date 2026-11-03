#!/usr/bin/env node
/** GitHub Pages setup using session credentials. Never writes or prints credentials. */
import { spawnSync } from 'node:child_process';

const OWNER = 'robdojo88science';
const REPO = 'sunix';
const API = `https://api.github.com/repos/${OWNER}/${REPO}`;
const URL = `https://${OWNER}.github.io/${REPO}/`;
const SETTINGS = `https://github.com/${OWNER}/${REPO}/settings/pages`;
const command = process.argv[2] || 'status';
if (!['status', 'enable', 'deploy', 'make-public'].includes(command)) {
  console.error('Usage: node scripts/github-pages.mjs [status|enable|deploy|make-public]');
  process.exit(2);
}

function sessionToken() {
  if (process.env.GH_TOKEN || process.env.GITHUB_TOKEN) return process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  // Git Credential Manager is already configured on many Windows installations.
  // Disable interactive acquisition; credentials stay only in this process.
  const credential = spawnSync('git', ['credential', 'fill'], {
    input: `protocol=https\nhost=github.com\n\n`,
    encoding: 'utf8',
    timeout: 15000,
    windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' },
  });
  if (credential.status !== 0) return undefined;
  const password = credential.stdout.split(/\r?\n/).find(line => line.startsWith('password='));
  return password?.slice(9);
}

const token = sessionToken();
async function api(path = '', method = 'GET', body) {
  const response = await fetch(path === '/user' ? 'https://api.github.com/user' : `${API}${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'sunix-pages-setup',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20000),
  });
  let data;
  if (response.status !== 204) data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data };
}

try {
  if (command !== 'status' && !token) {
    console.error(`No GitHub API session is available. Set Pages → Source → GitHub Actions at ${SETTINGS}, or run this command in a session with GH_TOKEN.`);
    process.exitCode = 1;
  } else if (command === 'make-public') {
    const result = await api('', 'PATCH', { private: false });
    if (!result.ok) throw new Error(`Could not change repository visibility (HTTP ${result.status}). Repository administration permission is required.`);
    console.log(`Repository visibility: ${result.data.visibility}. https://github.com/${OWNER}/${REPO}`);
  } else if (command === 'enable') {
    const current = await api('/pages');
    if (current.ok && current.data.build_type === 'workflow') {
      console.log(`GitHub Pages already uses GitHub Actions. ${URL}`);
    } else {
      const result = await api('/pages', current.ok ? 'PUT' : 'POST', { build_type: 'workflow' });
      if (!result.ok) throw new Error(`Could not enable GitHub Pages (HTTP ${result.status}). Check repository admin/Pages permission at ${SETTINGS}.`);
      console.log(`GitHub Pages configured for GitHub Actions. ${URL}`);
    }
  } else if (command === 'deploy') {
    const result = await api('/actions/workflows/deploy.yml/dispatches', 'POST', { ref: 'main' });
    if (!result.ok) throw new Error(`Could not start the Pages workflow (HTTP ${result.status}). Push main first and verify Actions permission.`);
    console.log(`Pages deployment started. https://github.com/${OWNER}/${REPO}/actions`);
  } else {
    const [repository, pages, runs, account] = await Promise.all([api(), api('/pages'), api('/actions/workflows/deploy.yml/runs?per_page=3'), token ? api('/user') : Promise.resolve({ ok: false })]);
    console.log(JSON.stringify({
      repository: repository.ok ? { url: repository.data.html_url, visibility: repository.data.visibility, defaultBranch: repository.data.default_branch } : { status: repository.status },
      apiSessionAvailable: Boolean(token),
      accountPlan: account.ok ? (account.data.plan?.name || 'not exposed by this credential') : 'unavailable',
      pages: pages.ok ? { url: pages.data.html_url, status: pages.data.status, buildType: pages.data.build_type } : { status: pages.status, setup: SETTINGS },
      deployments: runs.ok ? runs.data.workflow_runs.map(run => ({ id: run.id, status: run.status, conclusion: run.conclusion, commit: run.head_sha, url: run.html_url })) : { status: runs.status },
    }, null, 2));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'GitHub Pages request failed.');
  process.exitCode = 1;
}
