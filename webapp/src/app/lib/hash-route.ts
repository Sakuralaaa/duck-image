import { useCallback, useEffect, useState } from 'react';

export const ROUTES = [
  'images',
  'chat',
  'gallery',
  'accounts',
  'keys',
  'settings',
  'overview',
  'subscriptions',
  'logs',
  'history',
  'model-config',
  'examples'
] as const;
export type Route = (typeof ROUTES)[number];

/**
 * 旧地址兼容：身份池（#/identities）、默认身份（#/identity）并入「账号」；
 * 代理（#/proxy）并入「设置」。值为新的 hash（可带查询串）。
 */
export const LEGACY_ROUTES: Record<string, string> = {
  identities: 'accounts',
  identity: 'accounts?adv=sync',
  proxy: 'settings?section=proxy'
};

export const ROUTE_META: Record<Route, { title: string }> = {
  images: { title: 'Duck Image' },
  chat: { title: 'Duck Chat' },
  gallery: { title: '图库' },
  accounts: { title: '账号' },
  keys: { title: 'API Key' },
  settings: { title: '设置' },
  overview: { title: '概览' },
  subscriptions: { title: '订阅' },
  logs: { title: '日志' },
  history: { title: '对话上下文' },
  'model-config': { title: '模型配置' },
  examples: { title: '调用示例' }
};

function rawHash(): { path: string; query: string } {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const index = raw.search(/[?&#]/);
  return index < 0 ? { path: raw, query: '' } : { path: raw.slice(0, index), query: raw.slice(index) };
}

/** 读取当前 hash 查询参数（如 #/accounts?adv=sync）。 */
export function hashParam(name: string): string | null {
  const { query } = rawHash();
  if (!query) return null;
  return new URLSearchParams(query.replace(/^[?&#]/, '')).get(name);
}

function redirectLegacy(): void {
  const { path, query } = rawHash();
  const target = LEGACY_ROUTES[path];
  if (!target) return;
  const extra = query && !target.includes('?') ? query : '';
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/${target}${extra}`);
}

function parseHash(): Route {
  redirectLegacy();
  const { path } = rawHash();
  return (ROUTES as readonly string[]).includes(path) ? (path as Route) : 'images';
}

export function useHashRoute(): [Route, (route: Route) => void] {
  const [route, setRoute] = useState<Route>(() => parseHash());

  useEffect(() => {
    const onChange = () => setRoute(parseHash());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  useEffect(() => {
    // 只在「hash 为空」时补默认路由；不要重写带查询串的 hash（订阅登录回调需要 ?sessionId=..&token=..）。
    if (!window.location.hash) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/${parseHash()}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const navigate = useCallback((next: Route) => {
    if (parseHash() === next) {
      setRoute(next);
      return;
    }
    window.location.hash = `#/${next}`;
  }, []);

  return [route, navigate];
}
