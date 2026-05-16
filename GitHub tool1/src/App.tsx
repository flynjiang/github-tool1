import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  initFs, cloneRepo, pullRepo, pushRepo, addAllAndCommit, removeFile,
  listCommits, listBranches, createBranch, switchBranch, deleteBranch,
  getStatus, getDiff, uploadLfsFile, needsLfs, verifyToken, verifyRepo,
  pfs,
  type BranchInfo, type StatusEntry, type CommitEntry, LFS_SIZE_THRESHOLD,
} from './gitClient';
import { detectSystemProxy, type ProxyInfo } from './proxyDetect';
import './styles.css';

/* ============================================
   默认凭据（你的 Token 和仓库）
   ============================================ */
const DEFAULT_TOKEN = '';
const DEFAULT_REPO  = 'https://github.com/flynjiang/stm32f103-hal.git';

/* ============================================
   命令速查表
   ============================================ */
interface Cmd { desc: string; cmd: string; danger?: boolean; }
const CMDS: Cmd[] = [
  { desc: '克隆仓库', cmd: 'git clone <url>' },
  { desc: '拉取最新', cmd: 'git pull origin main' },
  { desc: '查看状态', cmd: 'git status' },
  { desc: '添加所有', cmd: 'git add .' },
  { desc: '提交', cmd: 'git commit -m "message"' },
  { desc: '推送', cmd: 'git push origin main' },
  { desc: '查看分支', cmd: 'git branch -a' },
  { desc: '新建+切换', cmd: 'git checkout -b <name>' },
  { desc: '切换分支', cmd: 'git checkout <name>' },
  { desc: '合并分支', cmd: 'git merge <branch>' },
  { desc: '查看日志', cmd: 'git log --oneline -20' },
  { desc: '查看差异', cmd: 'git diff' },
  { desc: '暂存改动', cmd: 'git stash' },
  { desc: '弹出暂存', cmd: 'git stash pop' },
  { desc: '撤销文件', cmd: 'git checkout -- <file>', danger: true },
  { desc: '回退提交', cmd: 'git reset --soft HEAD~1', danger: true },
  { desc: '添加远程', cmd: 'git remote add origin <url>' },
  { desc: '初始化仓库', cmd: 'git init' },
  { desc: '查看远程', cmd: 'git remote -v' },
  { desc: '安装 LFS', cmd: 'git lfs install' },
  { desc: 'LFS 追踪类型', cmd: 'git lfs track "*.psd"' },
  { desc: 'LFS 追踪文件', cmd: 'git lfs track "<filename>"' },
  { desc: '列出 LFS 规则', cmd: 'git lfs track' },
  { desc: '查看 LFS 文件', cmd: 'git lfs ls-files' },
  { desc: '查看代码作者', cmd: 'git blame <file>' },
  { desc: 'Cherry-pick', cmd: 'git cherry-pick <commit>' },
  { desc: 'Reflog', cmd: 'git reflog' },
  { desc: '交互式 rebase', cmd: 'git rebase -i HEAD~3', danger: true },
  { desc: '创建 Tag', cmd: 'git tag -a v1.0 -m "msg"' },
  { desc: '推送 Tag', cmd: 'git push origin --tags' },
];

/* ============================================
   工具
   ============================================ */
const fmtMB = (b: number) => (b / 1024 / 1024).toFixed(2);
const parseOwner = (u: string) => { const m = u.match(/github\.com[/:](.+?)\/(.+?)(?:\.git|\/|$)/); return m ? { o: m[1], r: m[2] } : null; };
async function mkdirp(path: string) { const parts = path.split('/').filter(Boolean); let cur = ''; for (const p of parts) { cur += '/' + p; await pfs.mkdir(cur).catch(() => {}); } }

/* ============================================
   Toast
   ============================================ */
interface T { id: number; t: 'ok'|'err'|'info'|'warn'; msg: string; }
let _tid = 0;
function useToast() {
  const [ts, set] = useState<T[]>([]);
  const push = useCallback((t: T['t'], msg: string) => {
    const id = ++_tid;
    set((p) => [...p.slice(-4), { id, t, msg }]);
    setTimeout(() => set((p) => p.filter((x) => x.id !== id)), 4000);
  }, []);
  return { ts, push, remove: useCallback((id: number) => set((p) => p.filter((x) => x.id !== id)), []) };
}
const IC: Record<string, string> = { ok: '✓', err: '✗', info: 'ℹ', warn: '⚠' };

/* ============================================
   确认框
   ============================================ */
function Confirm({ title, msg, onOk, onCancel }: { title: string; msg: string; onOk: () => void; onCancel: () => void }) {
  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3><p>{msg}</p>
        <div className="dialog-actions">
          <button className="btn-secondary" onClick={onCancel}>取消</button>
          <button className="btn-danger" onClick={onOk}>确认</button>
        </div>
      </div>
    </div>
  );
}

/* ============================================
   主组件
   ============================================ */
export default function App() {
  /* ---- 状态 ---- */
  const [t, setT] = useState<'light'|'dark'>(() => (localStorage.getItem('theme') as any) || 'light');
  const [token, setToken] = useState(() => localStorage.getItem('token') || DEFAULT_TOKEN);
  const [repoUrl, setRepoUrl] = useState(() => localStorage.getItem('repo') || DEFAULT_REPO);
  const [dir, setDir] = useState('');
  const [busy, setBusy] = useState('');
  const [commits, setCommits] = useState<CommitEntry[]>([]);
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [statuses, setStatuses] = useState<StatusEntry[]>([]);
  const [diff, setDiff] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [lfsPct, setLfsPct] = useState(0);
  const [fold, setFold] = useState<Record<string,boolean>>({});
  const [bname, setBname] = useState('');
  const [cMsg, setCMsg] = useState('');
  const [pushBranch, setPushBranch] = useState('');
  const [delPath, setDelPath] = useState('');
  const [cf, setCf] = useState('');
  const [ci, setCi] = useState(-1);
  const [dlg, setDlg] = useState<any>(null);
  const [proxyInfo, setProxyInfo] = useState<ProxyInfo|null>(null);
  const { ts, push: toast, remove } = useToast();

  /* ---- 派生 ---- */
  const ok = Boolean(dir && token);
  const own = useMemo(() => parseOwner(repoUrl), [repoUrl]);
  const dot = busy ? 'busy' : statuses.length ? 'err' : 'ok';

  /* ---- 持久化 ---- */
  useEffect(() => { localStorage.setItem('theme', t); document.documentElement.setAttribute('data-theme', t); }, [t]);
  useEffect(() => { localStorage.setItem('token', token); }, [token]);
  useEffect(() => { localStorage.setItem('repo', repoUrl); }, [repoUrl]);

  /* ---- 初始化 ---- */
  useEffect(() => { initFs(); }, []);

  /* ---- 启动时自动检测系统代理 ---- */
  useEffect(() => {
    detectSystemProxy().then(info => {
      setProxyInfo(info);
      if (info.detected) toast('info', `检测到系统代理: ${info.host}:${info.port}`);
      else toast('info', '当前为直连模式（未检测到系统代理）');
    });
  }, []);

  /* ---- 助手 ---- */
  const w = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try { await fn(); } catch (e: any) { toast('err', e.message || String(e)); }
    finally { setBusy(''); }
  };
  const rf = async (d: string) => {
    if (!d) return;
    const [c, b, s] = await Promise.all([listCommits(d), listBranches(d), getStatus(d)]);
    setCommits(c); setBranches(b); setStatuses(s);
  };
  const tg = (k: string) => setFold((c) => ({ ...c, [k]: !c[k] }));

  /* ---- 操作 ---- */
  const hClone = () => {
    if (!repoUrl || !token) return toast('warn', '请填写仓库 URL 和 Token');
    w('正在克隆...', async () => {
      const d = await cloneRepo(repoUrl, token, undefined, (msg) => setBusy(msg));
      setDir(d);
      toast('ok', '克隆完成!');
      await rf(d);
    });
  };
  const hPull = () => { if (!ok) return; w('拉取中...', async () => { await pullRepo(dir, token); toast('ok', '拉取完成'); await rf(dir); }); };
  const hPush = () => { if (!ok) return; w('推送中...', async () => { await pushRepo(dir, token); toast('ok', '推送完成'); }); };
  const hStatus = () => { if (!ok) return; w('检查中...', async () => { const s = await getStatus(dir); setStatuses(s); toast('info', `${s.length} 个变更`); }); };
  const hDiff = () => { if (!ok) return; w('获取差异...', async () => { const d = await getDiff(dir); setDiff(d); setFold((c)=>({...c,diff:false})); }); };
  const hCommitPush = () => {
    if (!ok) return; if (!cMsg.trim()) return toast('warn', '请填写提交信息');
    w('提交+推送...', async () => {
      const sha = await addAllAndCommit(dir, cMsg);
      toast('info', `提交: ${sha.slice(0,7)}`);
      await pushRepo(dir, token, pushBranch || undefined);
      toast('ok', '完成'); setCMsg(''); await rf(dir);
    });
  };
  const hVerify = () => {
    if (!token) return toast('warn', '请填写 Token');
    w('验证 Token...', async () => {
      const u = await verifyToken(token);
      toast('ok', `Token 有效 — ${u.user}`);
      if (repoUrl) { const r = await verifyRepo(repoUrl, token); toast('info', `仓库: ${r.defaultBranch}`); }
    });
  };

  /* ---- 分支 ---- */
  const hCBranch = () => { if (!ok || !bname.trim()) return; w('创建分支...', async () => { await createBranch(dir, bname); toast('ok', `已创建 ${bname}`); setBname(''); await rf(dir); }); };
  const hSBranch = (n: string) => { w('切换...', async () => { await switchBranch(dir, n); toast('ok', `已切换 ${n}`); await rf(dir); }); };
  const hDBranch = (n: string) => { setDlg({ title: '删除分支', msg: `确定删除 "${n}"？不可撤销。`, onOk: async () => { setDlg(null); w('删除...', async () => { await deleteBranch(dir, n); toast('ok', `已删除 ${n}`); await rf(dir); }); } }); };

  /* ---- 删除文件 ---- */
  const hDelFile = () => {
    if (!ok || !delPath.trim()) return toast('warn', '请输入要删除的文件路径');
    const p = delPath.trim();
    setDlg({ title: '删除文件', msg: `确定从仓库中删除 "${p}"？`, onOk: async () => {
      setDlg(null);
      w('删除文件...', async () => {
        await removeFile(dir, p);
        toast('ok', `已删除 ${p}，请提交并推送`);
        setDelPath('');
        await rf(dir);
      });
    }});
  };

  /* ---- 文件 & LFS ---- */
  const hDrop = async (e: React.DragEvent) => {
    e.preventDefault(); const fs = await readDropped(e.dataTransfer.items); setFiles(fs);
    toast('info', `${fs.length} 个文件, ${fs.filter(f=>needsLfs(f.size)).length} 个需 LFS`);
  };
  const hFile = (e: React.ChangeEvent<HTMLInputElement>) => { const fs = Array.from(e.target.files||[]); setFiles(fs); };
  const hLfs = async () => {
    if (!own || !token) return toast('warn', '请先填写仓库和 Token');
    if (!dir) return toast('warn', '请先克隆仓库');
    if (!files.length) return;
    setLfsPct(0);
    const total = files.length;
    const lfsFiles = files.filter(f => needsLfs(f.size));
    const smallFiles = files.filter(f => !needsLfs(f.size));

    let done = 0;
    const updatePct = () => { done++; setLfsPct(Math.round((done / total) * 100)); };

    // LFS 大文件串行上传（需要顺序保证）
    for (const f of lfsFiles) {
      try {
        await uploadLfsFile(repoUrl, token, f, (p) => setLfsPct(Math.round(((done + p / 100) / total) * 100)));
        const oid = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await f.arrayBuffer()))).map(b => b.toString(16).padStart(2, '0')).join('');
        const pointer = `version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize ${f.size}\n`;
        const fp = `${dir}/${f.name}`;
        await mkdirp(fp.slice(0, fp.lastIndexOf('/')));
        await pfs.writeFile(fp, pointer, 'utf8');
        updatePct();
      } catch (e: any) { toast('err', `LFS失败: ${f.name} - ${e.message}`); return; }
    }

    // 小文件并发写入（批量8个一组）
    const BATCH = 8;
    for (let i = 0; i < smallFiles.length; i += BATCH) {
      const batch = smallFiles.slice(i, i + BATCH);
      const results = await Promise.allSettled(batch.map(async (f) => {
        const buf = new Uint8Array(await f.arrayBuffer());
        const fp = `${dir}/${f.name}`;
        await mkdirp(fp.slice(0, fp.lastIndexOf('/')));
        await pfs.writeFile(fp, buf);
      }));
      for (let j = 0; j < results.length; j++) {
        if (results[j].status === 'rejected') {
          toast('err', `写入失败: ${batch[j].name} - ${(results[j] as PromiseRejectedResult).reason}`);
          return;
        }
        updatePct();
      }
    }

    setLfsPct(100);
    toast('ok', `上传完成! ${total} 个文件已写入仓库，请提交并推送`);
    await rf(dir);
  };

  /* ---- 命令 ---- */
  const fcmds = cf ? CMDS.filter(c=>c.desc.includes(cf)||c.cmd.toLowerCase().includes(cf.toLowerCase())) : CMDS;
  const cc = async (cmd: string, i: number) => { await navigator.clipboard.writeText(cmd); setCi(i); setTimeout(()=>setCi(-1),2000); };

  /* ================================================ */
  return (
    <div className="app">
      <div className="toast-container">{ts.map(x=><div key={x.id} className={`toast ${x.t}`}><span className="toast-icon">{IC[x.t]}</span><span className="toast-msg">{x.msg}</span><button className="toast-close" onClick={()=>remove(x.id)}>×</button></div>)}</div>
      {dlg && <Confirm title={dlg.title} msg={dlg.msg} onOk={dlg.onOk} onCancel={()=>setDlg(null)} />}

      <header className="app-header">
        <div>
          <h1>Git + LFS Web Helper</h1>
          <p className="subtitle">一键 Clone/Pull/Push · 大文件走 LFS · 命令速查</p>
        </div>
        <div className="theme-toggle" onClick={()=>setT(p=>p==='light'?'dark':'light')}>
          <span className={t==='light'?'active':''}>☀</span>
          <span className={t==='dark'?'active':''}>☾</span>
        </div>
      </header>

      {/* 网络状态 */}
      {proxyInfo && <section className="card">
        <h2 className="card-title"><span className="icon">▼</span> 网络状态</h2>
        <div className="card-body">
          <div className="info-row">
            <strong>模式:</strong> {proxyInfo.detected ? `代理 (${proxyInfo.host}:${proxyInfo.port})` : '直连'}
          </div>
          {!proxyInfo.detected && <p className="hint">未检测到系统代理，如需加速请在系统中开启代理软件（Clash/V2Ray 等）后刷新页面</p>}
        </div>
      </section>}

      {/* 认证 */}
      <section className="card">
        <h2 className="card-title" onClick={()=>tg('auth')}><span className="icon">{fold.auth?'▶':'▼'}</span> GitHub 认证</h2>
        {!fold.auth && <div className="card-body">
          <div className="form-row">
            <label>仓库 URL<input value={repoUrl} onChange={e=>setRepoUrl(e.target.value)} placeholder="https://github.com/owner/repo.git" /></label>
            <label>Token<input type="password" value={token} onChange={e=>setToken(e.target.value)} placeholder="ghp_xxx" /></label>
          </div>
          <div className="form-row" style={{marginTop:8}}>
            <button className="btn-secondary" onClick={hVerify} disabled={!token||!!busy}>验证连接</button>
          </div>
        </div>}
      </section>

      {/* 核心操作 */}
      <section className="card">
        <h2 className="card-title" onClick={()=>tg('ops')}><span className="icon">{fold.ops?'▶':'▼'}</span> 核心操作{busy&&<span className="spinner"/>}</h2>
        {!fold.ops && <div className="card-body">
          <div className="btn-group">
            <button className="btn-primary" onClick={hClone} disabled={!!busy}>Clone</button>
            <button className="btn-primary" onClick={hPull} disabled={!ok||!!busy}>Pull</button>
            <button className="btn-primary" onClick={hPush} disabled={!ok||!!busy}>Push</button>
            <button className="btn-secondary" onClick={hStatus} disabled={!ok||!!busy}>Status</button>
            <button className="btn-secondary" onClick={hDiff} disabled={!ok||!!busy}>Diff</button>
          </div>
          <div className="info-row"><strong>目录:</strong> {dir||'未克隆'} | <strong>远程:</strong> {own?`${own.o}/${own.r}`:'—'}</div>
          {statuses.length>0 && <div className="status-list"><span className="section-label">变更</span>{statuses.map(e=><span key={e.path} className={`tag tag-${e.status}`}>{e.status}: {e.path}</span>)}</div>}
        </div>}
      </section>

      {/* 提交 */}
      <section className="card">
        <h2 className="card-title" onClick={()=>tg('commit')}><span className="icon">{fold.commit?'▶':'▼'}</span> Add + Commit + Push{statuses.length>0&&<span className="badge">{statuses.length}</span>}</h2>
        {!fold.commit && <div className="card-body">
          <div className="form-row">
            <input value={cMsg} onChange={e=>setCMsg(e.target.value)} placeholder="commit message" />
            <input value={pushBranch} onChange={e=>setPushBranch(e.target.value)} placeholder="分支（留空=当前）" style={{width:140}} />
            <button className="btn-primary" onClick={hCommitPush} disabled={!ok||!!busy}>提交所有并推送</button>
          </div>
          <p className="hint">执行 <code>git add .</code> → <code>git commit</code> → <code>git push</code>{pushBranch&&` → ${pushBranch}`}</p>
        </div>}
      </section>

      {/* 删除文件 */}
      <section className="card">
        <h2 className="card-title" onClick={()=>tg('delfile')}><span className="icon">{fold.delfile?'▶':'▼'}</span> 删除仓库文件</h2>
        {!fold.delfile && <div className="card-body">
          <div className="form-row">
            <input value={delPath} onChange={e=>setDelPath(e.target.value)} placeholder="文件路径，如 src/old.ts" />
            <button className="btn-danger" onClick={hDelFile} disabled={!ok||!!busy}>删除</button>
          </div>
          <p className="hint">从仓库中移除文件，删除后需提交并推送才会生效</p>
        </div>}
      </section>

      {/* 分支 */}
      <section className="card">
        <h2 className="card-title" onClick={()=>tg('branch')}><span className="icon">{fold.branch?'▶':'▼'}</span> 分支管理{branches.length>0&&<span className="badge">{branches.length}</span>}</h2>
        {!fold.branch && <div className="card-body">
          <div className="form-row">
            <input value={bname} onChange={e=>setBname(e.target.value)} placeholder="新分支名" />
            <button className="btn-primary" onClick={hCBranch} disabled={!ok||!!busy}>创建</button>
          </div>
          <div className="branch-list">
            {branches.map(b=><div key={b.name} className={`branch-item${b.current?' current':''}`}><span className="branch-name">{b.current?'★ ':''}{b.name}</span><span className="branch-actions">{!b.current&&<><button className="btn-sm btn-secondary" onClick={()=>hSBranch(b.name)}>切换</button><button className="btn-sm btn-danger" onClick={()=>hDBranch(b.name)}>删除</button></>}</span></div>)}
            {branches.length===0&&<div className="empty-state"><div className="empty-icon">🌿</div>暂无分支</div>}
          </div>
        </div>}
      </section>

      {/* 文件上传 */}
      <section className="card">
        <h2 className="card-title" onClick={()=>tg('upload')}><span className="icon">{fold.upload?'▶':'▼'}</span> 文件上传{files.length>0&&<span className="badge">{files.length}</span>}</h2>
        {!fold.upload && <div className="card-body">
          <div className="dropzone" onDragOver={e=>{e.preventDefault();}} onDrop={hDrop}>
            <span className="drop-icon">{files.length?'📁':'📂'}</span>
            <span className="drop-text">{files.length?`${files.length} 个文件`:'拖拽文件/文件夹'}</span>
            <span className="drop-hint">≥{LFS_SIZE_THRESHOLD/1024/1024}MB 走 LFS，其余直接写入仓库</span>
          </div>
          <div className="form-row"><input type="file" multiple onChange={hFile} /><button className="btn-primary" onClick={hLfs} disabled={!files.length||!!busy}>上传文件</button></div>
          {files.length>0 && <div className="file-list"><span className="section-label">待上传</span>{files.map((f,i)=><div key={i} className={`file-item ${needsLfs(f.size)?'lfs':'small'}`}><span>{f.name}</span><span className="file-size">{fmtMB(f.size)} MB</span><span className={`tag ${needsLfs(f.size)?'tag-lfs':'tag-normal'}`}>{needsLfs(f.size)?'LFS':'普通'}</span></div>)}</div>}
          {lfsPct>0 && <div className="progress-wrap"><div className="progress-info"><span>进度</span><span>{lfsPct}%</span></div><div className="progress-bar"><div className="progress-fill" style={{width:`${lfsPct}%`}}/></div></div>}
        </div>}
      </section>

      {/* 历史 */}
      <section className="card">
        <h2 className="card-title" onClick={()=>tg('log')}><span className="icon">{fold.log?'▶':'▼'}</span> 提交历史{commits.length>0&&<span className="badge">{commits.length}</span>}</h2>
        {!fold.log && <div className="card-body">
          <button className="btn-secondary" onClick={()=>rf(dir)} disabled={!ok||!!busy}>刷新</button>
          <div className="commit-list" style={{marginTop:10}}>
            {commits.map((c,i)=><div key={i} className="commit-item"><code className="commit-oid">{c.oid}</code><span className="commit-msg">{c.message}</span><span className="commit-meta">{c.author} · {c.date.toLocaleString()}</span></div>)}
            {commits.length===0&&<div className="empty-state"><div className="empty-icon">📜</div>暂无记录</div>}
          </div>
        </div>}
      </section>

      {/* 命令表 */}
      <section className="card">
        <h2 className="card-title" onClick={()=>tg('cheat')}><span className="icon">{fold.cheat?'▶':'▼'}</span> 命令速查<span className="badge">{CMDS.length}</span></h2>
        {!fold.cheat && <div className="card-body">
          <input className="search-input" value={cf} onChange={e=>setCf(e.target.value)} placeholder="搜索命令..." />
          <div className="cheatsheet">
            {fcmds.map((c,i)=><div key={i} className={`cmd-row${c.danger?' danger':''}`}><span className="cmd-desc">{c.desc}</span><code className="cmd-text">{c.cmd}</code><button className={`btn-copy${ci===i?' copied':''}`} onClick={()=>cc(c.cmd,i)}>{ci===i?'✓ 已复制':'复制'}</button></div>)}
          </div>
        </div>}
      </section>

      {/* Diff */}
      {diff && <section className="card"><h2 className="card-title" onClick={()=>tg('diff')}><span className="icon">{fold.diff?'▶':'▼'}</span> git diff</h2>{!fold.diff&&<div className="card-body"><pre className="diff-output">{diff}</pre></div>}</section>}

      {/* 状态栏 */}
      <div className="status-bar"><span className={`status-dot ${dot}`}/>{busy&&<span className="spinner"/>}<span>{busy||'就绪'}</span></div>
    </div>
  );
}

/* ============================================
   拖拽递归读取
   ============================================ */
async function readDropped(items: DataTransferItemList): Promise<File[]> {
  const out: File[] = [];
  const pending: Promise<void>[] = [];

  function walk(entry: any, prefix: string) {
    if (entry.isFile) {
      pending.push(new Promise<void>((resolve) =>
        entry.file((f: File) => {
          out.push(new File([f], prefix + f.name, { type: f.type }));
          resolve();
        })
      ));
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      pending.push(new Promise<void>((resolve) => {
        reader.readEntries((entries: any[]) => {
          const subs = entries.map((e: any) => new Promise<void>(r => { walk(e, prefix + entry.name + '/'); r(); }));
          Promise.all(subs).then(() => resolve());
        });
      }));
    }
  }

  for (let i = 0; i < items.length; i++) {
    const entry = items[i].webkitGetAsEntry?.();
    if (entry) walk(entry, '');
    else {
      const file = items[i].getAsFile();
      if (file) out.push(file);
    }
  }

  await Promise.all(pending);
  return out;
}
