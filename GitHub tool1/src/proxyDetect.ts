export interface ProxyInfo {
  detected: boolean;
  host: string;
  port: number;
}

export async function detectSystemProxy(): Promise<ProxyInfo> {
  try {
    const r = await fetch('/__detect_proxy');
    if (r.ok) return await r.json();
  } catch {}
  return { detected: false, host: '', port: 0 };
}
