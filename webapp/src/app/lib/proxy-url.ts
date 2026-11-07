/** 代理地址「一串粘贴」解析/格式化：socks5://user:pass@host:port、http://host:port、host:port（默认 http）。 */
export const PASSWORD_MASK = '••••••';
const TYPES = ['http', 'https', 'socks5', 'socks4'] as const;

export interface ParsedProxy {
  type: string;
  host: string;
  port: number;
  username: string;
  /** undefined = 保持已保存的密码不变 */
  password?: string;
}

export function parseProxyUrl(input: string): ParsedProxy | { error: string } {
  let text = input.trim();
  if (!text) return { error: '请填写代理地址' };
  let type = 'http';
  const schemeMatch = text.match(/^([a-z0-9]+):\/\//i);
  if (schemeMatch) {
    let scheme = schemeMatch[1].toLowerCase();
    if (scheme === 'socks' || scheme === 'socks5h') scheme = 'socks5';
    if (scheme === 'socks4a') scheme = 'socks4';
    if (!(TYPES as readonly string[]).includes(scheme)) return { error: `不支持的协议：${schemeMatch[1]}` };
    type = scheme;
    text = text.slice(schemeMatch[0].length);
  }
  text = text.replace(/\/+$/, '');
  let username = '';
  let password: string | undefined = '';
  const at = text.lastIndexOf('@');
  if (at >= 0) {
    const auth = text.slice(0, at);
    text = text.slice(at + 1);
    const colon = auth.indexOf(':');
    const rawUser = colon >= 0 ? auth.slice(0, colon) : auth;
    const rawPass = colon >= 0 ? auth.slice(colon + 1) : '';
    try {
      username = decodeURIComponent(rawUser);
      password = rawPass === PASSWORD_MASK ? undefined : decodeURIComponent(rawPass);
    } catch {
      username = rawUser;
      password = rawPass === PASSWORD_MASK ? undefined : rawPass;
    }
  }
  const hostPort = text.match(/^(\[[^\]]+\]|[^:/]+)(?::(\d+))?$/);
  if (!hostPort) return { error: '格式应为 协议://用户名:密码@主机:端口' };
  const host = hostPort[1].replace(/^\[|\]$/g, '');
  const port = hostPort[2] ? Number(hostPort[2]) : type.startsWith('socks') ? 1080 : type === 'https' ? 443 : 8080;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { error: '端口必须是 1–65535' };
  return { type, host, port, username, password };
}

export function formatProxyUrl(proxy: { type?: string; host?: string; port?: number; username?: string; hasAuth?: boolean }): string {
  if (!proxy.host) return '';
  const auth = proxy.username
    ? `${encodeURIComponent(proxy.username)}${proxy.hasAuth !== false ? `:${PASSWORD_MASK}` : ''}@`
    : '';
  const host = proxy.host.includes(':') ? `[${proxy.host}]` : proxy.host;
  return `${proxy.type || 'http'}://${auth}${host}:${proxy.port ?? 8080}`;
}
