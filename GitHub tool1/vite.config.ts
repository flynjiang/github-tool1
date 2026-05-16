import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import https from 'https';
import { execSync } from 'child_process';

/* 运行时代理状态（可通过 /__proxy_config API 动态切换） */
const runtimeProxy = { mode: 'direct', host: '127.0.0.1', port: 443 };

function doRequest(
  targetHost: string,
  parsed: URL,
  method: string,
  headers: Record<string, string>,
  body: Buffer | undefined,
): Promise<{ status: number; headers: any; data: Buffer }> {
  return new Promise((resolve, reject) => {
    const isDirect = runtimeProxy.mode === 'direct';
    const connectHost = isDirect ? targetHost : runtimeProxy.host;
    const connectPort = isDirect ? 443 : runtimeProxy.port;

    const req = https.request({
      hostname: connectHost,
      port: connectPort,
      path: parsed.pathname + parsed.search,
      method,
      headers: { ...headers, host: targetHost },
      servername: targetHost,
      rejectUnauthorized: false,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode || 200, headers: res.headers, data: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.setTimeout(120000, () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function ghProxy(prefix: string, host: string) {
  return (req: any, res: any, next: any) => {
    if (!req.url?.startsWith(prefix)) return next();

    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', '*');
      res.setHeader('Access-Control-Max-Age', '86400');
      res.statusCode = 204;
      res.end();
      return;
    }

    const after = req.url.slice(prefix.length);
    let rest = after;
    if (rest.startsWith(`https://${host}`)) rest = rest.slice(`https://${host}`.length);
    else if (rest.startsWith(`${host}/`)) rest = rest.slice(host.length);
    else if (rest.startsWith(`${host}`)) rest = rest.slice(host.length);
    const targetUrl = `https://${host}${rest.startsWith('/') ? rest : '/' + rest}`;
    const parsed = new URL(targetUrl);

    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', async () => {
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const hdrs: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        const kl = k.toLowerCase();
        if (['host', 'origin', 'referer', 'connection', 'content-length'].includes(kl)) continue;
        if (v) hdrs[k] = String(v);
      }
      if (body) hdrs['content-length'] = String(body.length);

      try {
        const result = await doRequest(host, parsed, req.method, hdrs, body);
        res.statusCode = result.status;
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Expose-Headers', '*');
        for (const [k, v] of Object.entries(result.headers)) {
          if (k && v && !['transfer-encoding', 'connection', 'www-authenticate'].includes(k.toLowerCase())) {
            res.setHeader(k, v as string);
          }
        }
        res.end(result.data);
      } catch (e: any) {
        console.error(`[proxy] FAIL ${req.method} ${parsed.pathname}: ${e.message}`);
        if (!res.headersSent) { res.statusCode = 502; res.end(`proxy: ${e.message}`); }
      }
    });
  };
}

function detectProxyApi(req: any, res: any, next: any) {
  if (req.url === '/__detect_proxy' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    try {
      const out = execSync(
        'reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable & ' +
        'reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyServer',
        { encoding: 'utf8', timeout: 3000 }
      );
      const enabled = /ProxyEnable\s+REG_DWORD\s+0x1/.test(out);
      const match = out.match(/ProxyServer\s+REG_SZ\s+(.+)/);
      if (enabled && match) {
        const proxy = match[1].trim();
        const [host, port] = proxy.includes(':') ? proxy.split(':') : [proxy, '0'];
        runtimeProxy.mode = 'custom';
        runtimeProxy.host = host;
        runtimeProxy.port = parseInt(port, 10) || 7890;
        res.end(JSON.stringify({ detected: true, host, port: runtimeProxy.port }));
      } else {
        runtimeProxy.mode = 'direct';
        res.end(JSON.stringify({ detected: false, host: '', port: 0 }));
      }
    } catch {
      res.end(JSON.stringify({ detected: false, host: '', port: 0 }));
    }
    return;
  }
  next();
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const proxyMode = (env.PROXY_MODE || 'direct').toLowerCase();
  const proxyHost = env.PROXY_HOST || '127.0.0.1';
  const proxyPort = parseInt(env.PROXY_PORT || '443', 10);

  runtimeProxy.mode = proxyMode;
  runtimeProxy.host = proxyMode === 'steam++' ? '127.0.0.1' : proxyHost;
  runtimeProxy.port = proxyMode === 'steam++' ? 443 : proxyMode === 'direct' ? 443 : proxyPort;

  console.log(`[proxy] 初始模式: ${runtimeProxy.mode}` +
    (runtimeProxy.mode === 'custom' ? ` -> ${runtimeProxy.host}:${runtimeProxy.port}` : '') +
    (runtimeProxy.mode === 'steam++' ? ' -> 127.0.0.1:443' : '') +
    (runtimeProxy.mode === 'direct' ? ' -> 直连 GitHub' : ''));

  return {
    define: { 'global': 'globalThis' },
    resolve: { alias: { buffer: 'buffer/' } },
    plugins: [
      react(),
      {
        name: 'github-proxy',
        configureServer(server: any) {
          server.middlewares.use(detectProxyApi);
          server.middlewares.use(ghProxy('/gh/', 'github.com'));
          server.middlewares.use(ghProxy('/gh-api/', 'api.github.com'));
        },
      },
    ],
    server: { host: '0.0.0.0', port: 5173 },
  };
});
