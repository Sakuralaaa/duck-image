import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { apiGet, apiPost, apiPut, ApiError } from '@/app/lib/api';
import { hashParam } from '@/app/lib/hash-route';
import type { Config, ConfigResponse, UpdateConfigResponse } from '@/app/lib/types';
import { PageHeader } from '@/app/components/page-header';
import { ErrorBanner } from '@/app/components/error-banner';
import { Button } from '@/components/ui/button';
import { ProxySection } from '@/app/components/proxy-section';
import { AdminTokenSection } from '@/app/components/admin-token-section';
import { SettingRow, SettingsCard } from '@/app/components/setting-row';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

interface FormState {
  rps: string;
  maxConcurrent: string;
  queueLimit: string;
  queueTimeoutMs: string;
  systemPrompt: string;
  promptMode: 'inline' | 'system';
  promptSource: 'duckai' | 'custom' | 'none';
  duckai: {
    tone: string;
    length: string;
    assistantRole: string;
    userRole: string;
    shouldSeekClarity: boolean;
    userName: string;
    assistantName: string;
    additionalInstructions: string;
  };
  webSearch: boolean;
  imageGeneration: boolean;
  /** v2.36：允许上游使用「大致位置」（user-location），默认关闭 */
  location: boolean;
  /** v2.44：客户端工具桥（Codex/DSH 文件工具） */
  clientFunctionCalling: boolean;
  /** 生图图库 */
  saveGallery: boolean;
  galleryRetentionDays: string;
  galleryMaxItems: string;
  logLevel: string;
}

const DEFAULT_FORM: FormState = {
  rps: '1',
  maxConcurrent: '1',
  queueLimit: '50',
  queueTimeoutMs: '300000',
  systemPrompt: '',
  promptMode: 'inline',
  promptSource: 'custom',
  duckai: {
    tone: 'Default',
    length: 'Default',
    assistantRole: 'Default',
    userRole: 'Default',
    shouldSeekClarity: false,
    userName: '',
    assistantName: '',
    additionalInstructions: ''
  },
  webSearch: true,
  imageGeneration: true,
  location: false,
  clientFunctionCalling: true,
  saveGallery: true,
  galleryRetentionDays: '0',
  galleryMaxItems: '2000',
  logLevel: 'info'
};

const LOG_LEVELS = ['debug', 'info', 'warn', 'error'];

/** v2.28：每张卡片的保存提示文案 */
const CARD_LABELS: Record<'queue' | 'prompts' | 'tools' | 'logging', string> = {
  queue: '队列配置',
  prompts: '提示词配置',
  tools: '工具配置',
  logging: '日志配置'
};

/** duck.ai 源码里的 assistant / user role 选项（与后端 duckai-roles.json 对齐）。 */
const ASSISTANT_ROLES = [
  'Default',
  'Brainstorm partner',
  'Career coach',
  'Coding coach',
  'Editor',
  'Entertainment guide',
  'Gardener',
  'Chef',
  'Fitness trainer',
  'Homework helper',
  'Language tutor',
  'Life coach',
  'Marketer',
  'Product manager',
  'Public speaking coach',
  'Social media copywriter',
  'Storyteller',
  'Summarizer',
  'Tech support specialist',
  'Teacher',
  'Translator',
  'Travel guide',
  'Trivia expert',
  'Writer'
];

const USER_ROLES = ['Default', 'Parent', 'Professional', 'Programmer', 'Student', 'Writer'];

function formFromConfig(config: Config, _fallbackModel?: string): FormState {
  return {
    rps: String(config.upstream?.rps ?? 1),
    maxConcurrent: String(config.upstream?.maxConcurrent ?? 1),
    queueLimit: String(config.upstream?.queueLimit ?? 50),
    queueTimeoutMs: String(config.upstream?.queueTimeoutMs ?? 300000),
    systemPrompt: config.prompts?.defaultSystemPrompt ?? '',
    promptMode: config.prompts?.mode === 'system' ? 'system' : 'inline',
    promptSource:
      config.prompts?.source === 'custom' || config.prompts?.source === 'none'
        ? config.prompts.source
        : 'duckai',
    duckai: {
      tone: config.prompts?.duckai?.tone || 'Default',
      length: config.prompts?.duckai?.length || 'Default',
      assistantRole: config.prompts?.duckai?.assistantRole || 'Default',
      userRole: config.prompts?.duckai?.userRole || 'Default',
      shouldSeekClarity: config.prompts?.duckai?.shouldSeekClarity === true,
      userName: config.prompts?.duckai?.userName || '',
      assistantName: config.prompts?.duckai?.assistantName || '',
      additionalInstructions: config.prompts?.duckai?.additionalInstructions || ''
    },
    webSearch: config.tools?.webSearch !== false,
    imageGeneration: config.tools?.imageGeneration !== false,
    location: config.tools?.location === true,
    clientFunctionCalling: config.tools?.clientFunctionCalling?.enabled !== false,
    saveGallery: (config as { images?: { saveGallery?: boolean } }).images?.saveGallery !== false,
    galleryRetentionDays: String((config as { images?: { retentionDays?: number } }).images?.retentionDays ?? 0),
    galleryMaxItems: String((config as { images?: { maxItems?: number } }).images?.maxItems ?? 2000),
    logLevel: config.logging?.level || 'info'
  };
}

type FieldErrors = Partial<Record<'rps' | 'maxConcurrent' | 'queueLimit' | 'queueTimeoutMs', string>>;

function validate(form: FormState): FieldErrors {
  const errors: FieldErrors = {};
  const rps = Number(form.rps);
  if (!Number.isFinite(rps) || rps < 0.2 || rps > 20) errors.rps = '范围 0.2 – 20（可填 0.1 的倍数）';
  const maxConcurrent = Number(form.maxConcurrent);
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 10) {
    errors.maxConcurrent = '范围 1 – 10 的整数';
  }
  const queueLimit = Number(form.queueLimit);
  if (!Number.isInteger(queueLimit) || queueLimit < 1 || queueLimit > 1000) {
    errors.queueLimit = '范围 1 – 1000 的整数';
  }
  const queueTimeoutMs = Number(form.queueTimeoutMs);
  if (!Number.isInteger(queueTimeoutMs) || queueTimeoutMs < 1000 || queueTimeoutMs > 3_600_000) {
    errors.queueTimeoutMs = '范围 1000 – 3600000 毫秒';
  }
  return errors;
}

export function SettingsPage() {
  // v2.28：不再订阅 /overview 轮询——此前 overviewModels 每 5 秒换新数组，
  // 导致 load() 的 useCallback 依赖变化 → useEffect 重新执行 → setLoading(true) → 页面抖动。
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // v2.28：每张卡片独立保存（保存后只提示该卡片）
  const [savingCard, setSavingCard] = useState<string | null>(null);
  // duck.ai 提示词生成器选项 + 预览
  const [promptOptions, setPromptOptions] = useState<{
    tones: Array<{ id: string; prompt: string }>;
    lengths: Array<{ id: string; prompt: string }>;
    clarify_prompt: string;
    assistant_roles: Array<{ id: string }>;
    user_roles: Array<{ id: string }>;
  } | null>(null);
  const [promptPreview, setPromptPreview] = useState('');
  const [promptPreviewError, setPromptPreviewError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'warning'; text: string } | null>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [savedForm, setSavedForm] = useState<FormState>(DEFAULT_FORM);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiGet<ConfigResponse>('/config');
      const config = response?.config ?? {};
      setForm(formFromConfig(config));
      setSavedForm(formFromConfig(config));
      setLoadedAt(Date.now());
      setFieldErrors({});
    } catch (err) {
      if ((err as ApiError)?.handled) return;
      setError((err as Error)?.message || '加载配置失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** 旧地址 #/proxy 会跳到 #/settings?section=proxy：加载完成后滚动到代理区块。 */
  useEffect(() => {
    if (loading || hashParam('section') !== 'proxy') return;
    document.querySelector('[data-testid="settings-proxy"]')?.scrollIntoView({ block: 'start' });
  }, [loading]);

  const patch = (values: Partial<FormState>) => setForm((current) => ({ ...current, ...values }));

  /** 按卡片保存：只提交该卡片负责的配置段。 */
  const saveCard = async (card: 'queue' | 'prompts' | 'tools' | 'logging', f: FormState = form) => {
    const errors = validate(f);
    setFieldErrors(errors);
    if (errors.rps || errors.maxConcurrent || errors.queueLimit || errors.queueTimeoutMs) {
      if (card === 'queue') {
        toast.error('请先修正队列参数');
        return;
      }
    }
    setSavingCard(card);
    setSaving(true);
    setNotice(null);
    try {
      const body: Record<string, unknown> =
        card === 'queue'
          ? {
              upstream: {
                rps: Number(f.rps),
                maxConcurrent: Number(f.maxConcurrent),
                queueLimit: Number(f.queueLimit),
                queueTimeoutMs: Number(f.queueTimeoutMs)
              }
            }
          : card === 'prompts'
            ? {
                prompts: {
                  defaultSystemPrompt: f.systemPrompt,
                  mode: f.promptMode,
                  source: f.promptSource,
                  duckai: f.duckai
                }
              }
            : card === 'tools'
              ? {
                  tools: {
                    webSearch: f.webSearch,
                    imageGeneration: f.imageGeneration,
                    location: f.location,
                    clientFunctionCalling: { enabled: f.clientFunctionCalling }
                  },
                  images: {
                    saveGallery: f.saveGallery,
                    retentionDays: Math.max(0, Math.trunc(Number(f.galleryRetentionDays) || 0)),
                    maxItems: Math.max(0, Math.trunc(Number(f.galleryMaxItems) || 0))
                  }
                }
              : { logging: { level: f.logLevel } };
      const response = await apiPut<UpdateConfigResponse>('/config', body);
      if (response?.config) {
        setForm(formFromConfig(response.config));
        setSavedForm(formFromConfig(response.config));
      }
      setLoadedAt(Date.now());
      const ignored = response?.ignored ?? [];
      const label = CARD_LABELS[card];
      if (response?.restartRequired) {
        toast.warning(`${label}已保存，部分改动需重启生效`);
      } else {
        toast.success('已保存');
      }
      if (ignored.length > 0) {
        toast.warning(`以下字段被忽略：${ignored.join('、')}`, { duration: 6000 });
      }
    } catch (err) {
      if ((err as ApiError)?.handled) return;
      toast.error((err as Error)?.message || '保存失败');
    } finally {
      setSavingCard(null);
      setSaving(false);
    }
  };

  const savingFor = (card: string) => savingCard === card;

  /** 加载 duck.ai 提示词选项（tones/lengths/roles）。 */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const options = await apiGet<NonNullable<typeof promptOptions>>('/prompts/duckai');
        if (!cancelled) setPromptOptions(options);
      } catch (err) {
        if ((err as ApiError)?.handled) return;
        if (!cancelled) setPromptOptions(null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 生成预览（防抖）：由服务端按源码逻辑拼装，保证与真正注入的文本一致。 */
  const promptSignature = JSON.stringify({
    source: form.promptSource,
    custom: form.systemPrompt,
    duckai: form.duckai
  });
  useEffect(() => {
    if (form.promptSource === 'none') {
      setPromptPreview('');
      setPromptPreviewError(null);
      return;
    }
    if (form.promptSource === 'custom') {
      setPromptPreview(form.systemPrompt.trim());
      setPromptPreviewError(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const result = await apiPost<{ prompt: string }>('/prompts/duckai/preview', {
            customization: form.duckai
          });
          if (!cancelled) {
            setPromptPreview(result?.prompt || '');
            setPromptPreviewError(null);
          }
        } catch (err) {
          if ((err as ApiError)?.handled) return;
          if (!cancelled) setPromptPreviewError((err as Error)?.message || '生成预览失败');
        }
      })();
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promptSignature]);

  const patchDuckai = (values: Partial<FormState['duckai']>) =>
    setForm((current) => ({ ...current, duckai: { ...current.duckai, ...values } }));

  /** 开关类：改动即保存。 */
  const toggleTools = (values: Partial<FormState>) => {
    const next = { ...form, ...values };
    setForm(next);
    void saveCard('tools', next);
  };

  const numberCommit = (key: 'galleryRetentionDays' | 'galleryMaxItems') => () => {
    if (form[key] === savedForm[key]) return;
    void saveCard('tools');
  };

  const selectRow = (
    label: string,
    value: string,
    onChange: (value: string) => void,
    options: Array<{ value: string; label: string }>,
    testId?: string,
    width = 'w-56'
  ) => (
    <SettingRow label={label}>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className={`h-9 ${width}`} data-testid={testId}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingRow>
  );

  const ids = (list: Array<{ id: string }> | undefined, fallback: string[]) =>
    (list?.length ? list.map((item) => item.id) : fallback).map((id) => ({ value: id, label: id === 'Default' ? '默认' : id }));

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-[720px]">
        <PageHeader title="设置" />
        <div className="space-y-6">
          <Skeleton className="h-52 rounded-2xl" />
          <Skeleton className="h-40 rounded-2xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[720px]">
      <PageHeader title="设置" />
      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}

      <div className="space-y-8">
        <SettingsCard title="功能">
          <SettingRow label="联网搜索" htmlFor="settings-tool-web">
            <Switch id="settings-tool-web" checked={form.webSearch} onCheckedChange={(value) => toggleTools({ webSearch: value })} disabled={saving} />
          </SettingRow>
          <SettingRow label="图片生成" htmlFor="settings-tool-image">
            <Switch id="settings-tool-image" checked={form.imageGeneration} onCheckedChange={(value) => toggleTools({ imageGeneration: value })} disabled={saving} />
          </SettingRow>
          <SettingRow label="保存到图库" htmlFor="settings-gallery-save">
            <Switch id="settings-gallery-save" checked={form.saveGallery} onCheckedChange={(value) => toggleTools({ saveGallery: value })} disabled={saving} />
          </SettingRow>
          {form.saveGallery ? (
            <>
              <SettingRow label="保留天数" htmlFor="settings-gallery-days" className="[&>div]:relative">
                <Input
                  id="settings-gallery-days"
                  type="number"
                  min={0}
                  value={form.galleryRetentionDays}
                  onChange={(event) => patch({ galleryRetentionDays: event.target.value })}
                  onBlur={numberCommit('galleryRetentionDays')}
                  onKeyDown={(event) => event.key === 'Enter' && (event.target as HTMLInputElement).blur()}
                  className="h-9 w-32 pr-11 text-right tnum"
                />
                <span className="pointer-events-none absolute right-3 text-xs text-muted-foreground">{Number(form.galleryRetentionDays) ? '天' : '永久'}</span>
              </SettingRow>
              <SettingRow label="最多张数" htmlFor="settings-gallery-max" className="[&>div]:relative">
                <Input
                  id="settings-gallery-max"
                  type="number"
                  min={0}
                  value={form.galleryMaxItems}
                  onChange={(event) => patch({ galleryMaxItems: event.target.value })}
                  onBlur={numberCommit('galleryMaxItems')}
                  onKeyDown={(event) => event.key === 'Enter' && (event.target as HTMLInputElement).blur()}
                  className="h-9 w-32 pr-11 text-right tnum"
                />
                <span className="pointer-events-none absolute right-3 text-xs text-muted-foreground">{Number(form.galleryMaxItems) ? '张' : '不限'}</span>
              </SettingRow>
            </>
          ) : null}
        </SettingsCard>

        <ProxySection />
        <AdminTokenSection />

        <div>
          <button
            type="button"
            onClick={() => setAdvancedOpen((value) => !value)}
            className="flex items-center gap-1.5 px-1 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            aria-expanded={advancedOpen}
          >
            高级设置
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${advancedOpen ? 'rotate-180' : ''}`} />
          </button>

          {advancedOpen ? (
            <div className="mt-4 space-y-8">
              <SettingsCard
                title="请求队列"
                action={
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => void saveCard('queue')} disabled={saving}>
                    {savingFor('queue') ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                    保存
                  </Button>
                }
              >
                {(
                  [
                    ['rps', '每秒请求数', 'settings-rps', '0.1'],
                    ['maxConcurrent', '并发上限', 'settings-max-concurrent', '1'],
                    ['queueLimit', '排队上限', 'settings-queue-limit', '1'],
                    ['queueTimeoutMs', '排队超时（毫秒）', 'settings-queue-timeout', '1000']
                  ] as const
                ).map(([key, label, id, step]) => (
                  <SettingRow key={key} label={label} htmlFor={id}>
                    <Input
                      id={id}
                      type="number"
                      step={step}
                      value={form[key]}
                      onChange={(event) => patch({ [key]: event.target.value } as Partial<FormState>)}
                      aria-invalid={Boolean(fieldErrors[key])}
                      title={fieldErrors[key]}
                      className={`h-9 text-right tnum ${key === 'queueTimeoutMs' ? 'w-32' : 'w-24'} ${fieldErrors[key] ? 'border-destructive' : ''}`}
                    />
                  </SettingRow>
                ))}
              </SettingsCard>

              <SettingsCard
                title="提示词"
                data-testid="settings-prompts-card"
                action={
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => void saveCard('prompts')} disabled={saving} data-testid="settings-save-prompts">
                    {savingFor('prompts') ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                    保存
                  </Button>
                }
              >
                {selectRow('来源', form.promptSource, (value) => patch({ promptSource: value as FormState['promptSource'] }), [
                  { value: 'duckai', label: 'duck.ai 生成器' },
                  { value: 'custom', label: '自定义' },
                  { value: 'none', label: '不注入' }
                ], 'settings-prompt-source', 'w-48')}
                {selectRow('注入方式', form.promptMode, (value) => patch({ promptMode: value as 'inline' | 'system' }), [
                  { value: 'inline', label: '合并进首条消息' },
                  { value: 'system', label: 'system 消息' }
                ], 'settings-prompt-mode', 'w-48')}
                {form.promptSource === 'duckai' ? (
                  <>
                    {selectRow('语气', form.duckai.tone, (value) => patchDuckai({ tone: value }), ids(promptOptions?.tones, ['Default', 'Casual', 'Professional']), 'settings-duckai-tone', 'w-48')}
                    {selectRow('长度', form.duckai.length, (value) => patchDuckai({ length: value }), ids(promptOptions?.lengths, ['Default', 'Short', 'Shortest']), 'settings-duckai-length', 'w-48')}
                    {selectRow('AI 角色', form.duckai.assistantRole, (value) => patchDuckai({ assistantRole: value }), ids(promptOptions?.assistant_roles, ASSISTANT_ROLES), 'settings-duckai-assistant-role', 'w-56')}
                    {selectRow('你的角色', form.duckai.userRole, (value) => patchDuckai({ userRole: value }), ids(promptOptions?.user_roles, USER_ROLES), 'settings-duckai-user-role', 'w-48')}
                    <SettingRow label="你的昵称" htmlFor="settings-duckai-user-name">
                      <Input id="settings-duckai-user-name" value={form.duckai.userName} onChange={(event) => patchDuckai({ userName: event.target.value })} className="h-9 w-48" />
                    </SettingRow>
                    <SettingRow label="AI 昵称" htmlFor="settings-duckai-assistant-name">
                      <Input id="settings-duckai-assistant-name" value={form.duckai.assistantName} onChange={(event) => patchDuckai({ assistantName: event.target.value })} className="h-9 w-48" />
                    </SettingRow>
                    <SettingRow label="先反问澄清" htmlFor="settings-duckai-clarify">
                      <Switch id="settings-duckai-clarify" checked={form.duckai.shouldSeekClarity} onCheckedChange={(value) => patchDuckai({ shouldSeekClarity: value })} />
                    </SettingRow>
                    <div className="space-y-2 py-3">
                      <label htmlFor="settings-duckai-additional" className="text-sm">附加指令</label>
                      <Textarea id="settings-duckai-additional" value={form.duckai.additionalInstructions} onChange={(event) => patchDuckai({ additionalInstructions: event.target.value })} rows={3} />
                    </div>
                  </>
                ) : null}
                {form.promptSource === 'custom' ? (
                  <div className="space-y-2 py-3">
                    <label htmlFor="settings-system-prompt" className="text-sm">系统提示词</label>
                    <Textarea id="settings-system-prompt" value={form.systemPrompt} onChange={(event) => patch({ systemPrompt: event.target.value })} rows={4} />
                  </div>
                ) : null}
                {form.promptSource !== 'none' ? (
                  <div className="space-y-2 py-3">
                    <div className="text-[13px] text-muted-foreground">预览</div>
                    <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted/60 p-3 text-[12px] text-muted-foreground" data-testid="settings-prompt-preview">
                      {promptPreviewError ? `预览失败：${promptPreviewError}` : promptPreview || '（空）'}
                    </pre>
                  </div>
                ) : null}
              </SettingsCard>

              <SettingsCard title="其他">
                <SettingRow label="允许定位" htmlFor="settings-tool-location">
                  <Switch id="settings-tool-location" checked={form.location} onCheckedChange={(value) => toggleTools({ location: value })} disabled={saving} />
                </SettingRow>
                <SettingRow label="客户端工具" htmlFor="settings-tool-client-tools">
                  <Switch id="settings-tool-client-tools" checked={form.clientFunctionCalling} onCheckedChange={(value) => toggleTools({ clientFunctionCalling: value })} disabled={saving} />
                </SettingRow>
                {selectRow('日志级别', form.logLevel, (value) => {
                  const next = { ...form, logLevel: value };
                  setForm(next);
                  void saveCard('logging', next);
                }, LOG_LEVELS.map((level) => ({ value: level, label: level })), 'settings-log-level', 'w-32')}
              </SettingsCard>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
