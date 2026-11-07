import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { apiGet, apiPost, apiPut, ApiError } from '@/app/lib/api';
import { formatDuration } from '@/app/lib/format';
import { maskIp } from '@/app/lib/mask-ip.mjs';
import { formatProxyUrl, parseProxyUrl } from '@/app/lib/proxy-url';
import type { ProxyConfig, ProxyResponse, ProxyTestResult, ProxyUpdateResponse } from '@/app/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { SettingRow, SettingsCard } from './setting-row';

function errorText(error: unknown, fallback: string): string | null {
  if ((error as ApiError)?.handled) return null;
  return (error as Error)?.message || fallback;
}

/** 设置页「代理」区块：开关 + 一串代理地址，保存/测试结果用 toast。 */
export function ProxySection() {
  const [proxy, setProxy] = useState<ProxyConfig | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [url, setUrl] = useState('');
  const [noProxy, setNoProxy] = useState('127.0.0.1\nlocalhost');
  const [testUrl, setTestUrl] = useState('');
  const [ipCheckUrl, setIpCheckUrl] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const hydrate = (value: ProxyConfig) => {
    setProxy(value);
    setEnabled(value.enabled === true);
    setUrl(formatProxyUrl(value));
    setNoProxy((value.noProxy ?? ['127.0.0.1', 'localhost']).join('\n'));
    setTestUrl(value.testUrl || '');
    setIpCheckUrl(value.ipCheckUrl || '');
  };

  const load = useCallback(async () => {
    try {
      const response = await apiGet<ProxyResponse>('/proxy');
      if (response?.proxy) hydrate(response.proxy);
    } catch (error) {
      const text = errorText(error, '代理配置加载失败');
      if (text) toast.error(text);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const buildPayload = (nextEnabled: boolean): Record<string, unknown> | null => {
    const base: Record<string, unknown> = {
      enabled: nextEnabled,
      noProxy: [...new Set(noProxy.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean))],
      testUrl: testUrl.trim(),
      ipCheckUrl: ipCheckUrl.trim()
    };
    if (!url.trim()) {
      if (nextEnabled) {
        toast.error('请先填写代理地址');
        return null;
      }
      return base;
    }
    const parsed = parseProxyUrl(url);
    if ('error' in parsed) {
      toast.error(parsed.error);
      return null;
    }
    Object.assign(base, { type: parsed.type, host: parsed.host, port: parsed.port, username: parsed.username });
    if (parsed.password !== undefined) base.password = parsed.password;
    return base;
  };

  const save = async (nextEnabled = enabled) => {
    const payload = buildPayload(nextEnabled);
    if (!payload) return false;
    setSaving(true);
    try {
      const response = await apiPut<ProxyUpdateResponse>('/proxy', payload);
      if (response?.proxy) hydrate(response.proxy);
      toast.success(nextEnabled ? '代理已启用' : '代理已关闭');
      return true;
    } catch (error) {
      const text = errorText(error, '保存代理失败');
      if (text) toast.error(text);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (value: boolean) => {
    setEnabled(value);
    if (value && !url.trim()) return; // 先填地址再保存
    const ok = await save(value);
    if (!ok) setEnabled(!value);
  };

  const test = async () => {
    const payload = buildPayload(true);
    if (!payload) return;
    // /proxy/test 只接受连接参数；enabled 属于保存语义，传了会被后端拒绝。
    delete payload.enabled;
    setTesting(true);
    try {
      const result = await apiPost<ProxyTestResult>('/proxy/test', payload);
      if (result.ok) {
        toast.success(`连通 · ${formatDuration(result.latencyMs)}${result.exitIp ? ` · 出口 IP ${maskIp(result.exitIp)}` : ''}`);
      } else {
        toast.error(`测试失败：${result.error || result.code || '未知错误'}`);
      }
    } catch (error) {
      const text = errorText(error, '测试失败');
      if (text) toast.error(text);
    } finally {
      setTesting(false);
    }
  };

  return (
    <SettingsCard title="代理" data-testid="settings-proxy">
      <SettingRow label="启用代理" htmlFor="proxy-enabled">
        <Switch id="proxy-enabled" checked={enabled} onCheckedChange={(value) => void toggle(value)} disabled={saving || !proxy} />
      </SettingRow>
      <div className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center">
        <label htmlFor="proxy-url" className="w-28 shrink-0 text-sm">代理地址</label>
        <Input
          id="proxy-url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="socks5://user:pass@host:1080"
          spellCheck={false}
          autoComplete="off"
          className="h-9 flex-1 font-mono text-[13px]"
        />
        <div className="flex shrink-0 gap-2">
          <Button size="sm" variant="outline" onClick={() => void test()} disabled={testing || !url.trim()}>
            {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            测试
          </Button>
          <Button size="sm" variant="outline" onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            保存
          </Button>
        </div>
      </div>
      <div className="py-2">
        <button
          type="button"
          onClick={() => setAdvanced((value) => !value)}
          className="flex items-center gap-1 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
        >
          高级
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', advanced && 'rotate-180')} />
        </button>
        {advanced ? (
          <div className="mt-2 space-y-1">
            <SettingRow label="不走代理" align="start">
              <Textarea value={noProxy} onChange={(event) => setNoProxy(event.target.value)} rows={2} className="w-64 font-mono text-[12.5px]" />
            </SettingRow>
            <SettingRow label="测试地址">
              <Input value={testUrl} onChange={(event) => setTestUrl(event.target.value)} className="h-9 w-80 font-mono text-[12.5px]" />
            </SettingRow>
            <SettingRow label="出口 IP 查询">
              <Input value={ipCheckUrl} onChange={(event) => setIpCheckUrl(event.target.value)} className="h-9 w-80 font-mono text-[12.5px]" />
            </SettingRow>
          </div>
        ) : null}
      </div>
    </SettingsCard>
  );
}
