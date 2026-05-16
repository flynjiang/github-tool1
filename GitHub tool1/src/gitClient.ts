import LightningFS from '@isomorphic-git/lightning-fs';
import git from 'isomorphic-git';
import http from 'isomorphic-git/http/web';

const fs = new LightningFS('githelper', { wipe: false });
const pfs = fs.promises;
export { fs, pfs };

/* ============================================
   Types
   ============================================ */
export interface BranchInfo { name: string; current: boolean; }
export interface StatusEntry { path: string; status: 'added' | 'modified' | 'deleted' | 'untracked'; }
export interface CommitEntry { oid: string; message: string; author: string; date: Date; }
export const LFS_SIZE_THRESHOLD = 100 * 1024 * 1024;
export const needsLfs = (size: number) => size >= LFS_SIZE_THRESHOLD;

/* ============================================
   Helpers
   ============================================ */
const corsProxy = '/gh';          // Vite → github.com（git 协议）
const apiBase = '/gh-api';       // Vite → api.github.com（REST）

function auth(token: string) {
  return { username: token, password: 'x-oauth-basic' };
}

export function getRepoDir(url: string): string {
  const n = url.replace(/\.git$/, '').replace(/^.*:\/\//, '');
  return `/repos/${n.replace(/[\/:@]/g, '_')}`;
}

export async function initFs() {
  await pfs.mkdir('/repos').catch(() => {});
}

/* ============================================
   REST API（走 Vite 代理）
   ============================================ */
async function ghApi(path: string, token: string) {
  const r = await fetch(`${apiBase}${path}`, {
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github+json',
    },
  });
  if (!r.ok) {
    const msg = r.status === 401 ? 'Token 无效或已过期'
      : r.status === 404 ? '仓库不存在或 Token 无权限'
      : `HTTP ${r.status}`;
    throw new Error(msg);
  }
  return r.json();
}

export async function verifyToken(token: string) {
  const d = await ghApi('/user', token);
  return { ok: true, user: d.login };
}

export async function verifyRepo(url: string, token: string) {
  const m = url.match(/github\.com[/:](.+?)\/(.+?)(?:\.git|\/|$)/);
  if (!m) throw new Error('无法解析仓库 URL');
  const [, owner, repo] = m;
  const d = await ghApi(`/repos/${owner}/${repo}`, token);
  return { ok: true, defaultBranch: d.default_branch || 'main' };
}

/* ============================================
   Clone / Pull / Push（走 Vite 代理）
   ============================================ */
export async function cloneRepo(url: string, token: string, branch?: string, onMsg?: (msg: string) => void) {
  const dir = getRepoDir(url);
  const report = (msg: string) => { console.log('[clone]', msg); onMsg?.(msg); };
  report('开始克隆...');

  try {
    await git.clone({
      fs, http, dir, url, corsProxy,
      ref: branch || 'main',
      singleBranch: true,
      depth: 1,
      noTags: true,
      onAuth: () => auth(token),
      onProgress: (p: any) => { if (p.phase) report(`${p.phase} ${p.loaded || 0}/${p.total || '?'}`); },
      onMessage: (msg: string) => report(msg),
    });
  } catch (e: any) {
    if (/Could not find/.test(e.message) || /HttpError/.test(e.code) || /NotFoundError/.test(e.code)) {
      report('空仓库，初始化本地仓库...');
      await pfs.mkdir(dir).catch(() => {});
      await git.init({ fs, dir, defaultBranch: branch || 'main' });
      await git.addRemote({ fs, dir, remote: 'origin', url });
    } else {
      throw e;
    }
  }

  report('克隆完成');
  return dir;
}

export async function pullRepo(dir: string, token: string) {
  await git.pull({
    fs, http, dir,
    corsProxy,
    singleBranch: true,
    author: { name: 'WebUser', email: 'web@helper.local' },
    onAuth: () => auth(token),
  });
  return '拉取完成';
}

export async function pushRepo(dir: string, token: string, branch?: string) {
  const ref = branch || await git.currentBranch({ fs, dir }).catch(() => 'main') || 'main';
  const r = await git.push({
    fs, http, dir,
    corsProxy,
    remote: 'origin',
    ref,
    force: true,
    onAuth: () => auth(token),
  });
  return r.ok ? '推送成功' : JSON.stringify(r);
}

/* ============================================
   Add / Commit
   ============================================ */
export async function addAllAndCommit(dir: string, msg: string) {
  const m = await git.statusMatrix({ fs, dir });
  for (const [filepath, h, w] of m) {
    if (w === 0) await git.remove({ fs, dir, filepath });
    else await git.add({ fs, dir, filepath });
  }
  return await git.commit({
    fs, dir,
    author: { name: 'WebUser', email: 'web@helper.local' },
    message: msg,
  });
}

export async function removeFile(dir: string, filepath: string) {
  await pfs.unlink(`${dir}/${filepath}`).catch(() => {});
  await git.remove({ fs, dir, filepath }).catch(() => {});
}

/* ============================================
   Log / Branches / Status / Diff
   ============================================ */
export async function listCommits(dir: string, depth = 20): Promise<CommitEntry[]> {
  try {
    const commits = await git.log({ fs, dir, depth });
    return commits.map((c) => ({
      oid: c.oid.slice(0, 7),
      message: c.commit.message.trim(),
      author: c.commit.author.name,
      date: new Date(c.commit.author.timestamp * 1000),
    }));
  } catch {
    return [];
  }
}

export async function listBranches(dir: string): Promise<BranchInfo[]> {
  const branches = await git.listBranches({ fs, dir });
  const cur = await git.currentBranch({ fs, dir }) || '';
  return branches.map((name) => ({ name, current: name === cur }));
}

export async function createBranch(dir: string, name: string) {
  await git.branch({ fs, dir, ref: name, checkout: false });
}

export async function switchBranch(dir: string, name: string) {
  await git.checkout({ fs, dir, ref: name });
}

export async function deleteBranch(dir: string, name: string) {
  await git.deleteBranch({ fs, dir, ref: name });
}

export async function getStatus(dir: string): Promise<StatusEntry[]> {
  const r: StatusEntry[] = [];
  const m = await git.statusMatrix({ fs, dir });
  for (const [p, h, w, s] of m) {
    if (h === 1 && w === 0 && s === 0) r.push({ path: p, status: 'deleted' });
    else if (h === 0 && w === 2 && s === 0) r.push({ path: p, status: 'untracked' });
    else if (h === 1 && w === 2 && s === 1) r.push({ path: p, status: 'modified' });
    else if ((h === 0 && s === 2) || (h === 0 && s === 3)) r.push({ path: p, status: 'added' });
    else if (h === 1 && w === 2 && s === 2) r.push({ path: p, status: 'modified' });
  }
  return r;
}

export async function getDiff(dir: string): Promise<string> {
  const m = await git.statusMatrix({ fs, dir });
  const l: string[] = [];
  for (const [p, h, w, s] of m) {
    if (h === 1 && w === 2 && s === 1) l.push(`M  ${p}`);
    else if ((h === 0 && s === 2) || (h === 0 && s === 3)) l.push(`A  ${p}`);
    else if (h === 1 && w === 0 && s === 0) l.push(`D  ${p}`);
    else if (h === 0 && w === 2 && s === 0) l.push(`?? ${p}`);
  }
  return l.join('\n') || '无变更';
}

/* ============================================
   LFS 大文件上传
   ============================================ */
async function sha256(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const h = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function uploadLfsFile(
  repoUrl: string,
  token: string,
  file: File,
  onProgress?: (pct: number) => void
) {
  const m = repoUrl.match(/github\.com[/:](.+?)\/(.+?)(?:\.git|\/|$)/);
  if (!m) throw new Error('无法解析仓库地址');
  const [, owner, repo] = m;
  const oid = await sha256(file);
  const size = file.size;

  // Batch API
  const batchUrl = `${corsProxy}/https://github.com/${owner}/${repo}.git/info/lfs/objects/batch`;
  const r = await fetch(batchUrl, {
    method: 'POST',
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.git-lfs+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ operation: 'upload', transfers: ['basic'], objects: [{ oid, size }] }),
  });
  if (!r.ok) throw new Error(`LFS batch ${r.status}`);
  const p = await r.json();
  const act = p.objects?.[0]?.actions?.upload;
  if (!act) return { oid, size, name: file.name };

  // Chunked upload with retry
  const buf = await file.arrayBuffer();
  const cs = 10 * 1024 * 1024;
  for (let off = 0; off < buf.byteLength; off += cs) {
    const end = Math.min(off + cs, buf.byteLength);
    let retries = 3;
    while (retries > 0) {
      const ur = await fetch(act.href, {
        method: act.method || 'PUT',
        headers: { ...act.header, 'Content-Type': 'application/octet-stream', 'Content-Range': `bytes ${off}-${end - 1}/${buf.byteLength}` },
        body: buf.slice(off, end),
      });
      if (ur.ok) break;
      retries--;
      if (retries === 0) throw new Error(`LFS chunk failed at ${off}, status ${ur.status}`);
      await new Promise(r => setTimeout(r, 1000));
    }
    onProgress?.(Math.round((end / buf.byteLength) * 100));
  }
  return { oid, size, name: file.name };
}
