import { useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ChevronDown,
  Clock3,
  Gauge,
  Layers,
  RefreshCw,
  Server,
  ShieldCheck,
  Timer,
  Wifi,
  WifiOff, ImagePlus } from 'lucide-react';
import { useOverview } from '@/app/lib/overview-context';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  errorRate,
  formatDateTime,
  formatDuration,
  formatNumber,
  formatQueueWait,
  formatRelative,
  formatUptime,
  topEntries
} from '@/app/lib/format';
import type { AdminLogItem, ModelInfo, UpstreamLogItem } from '@/app/lib/types';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/app/components/page-header';
import { ErrorBanner } from '@/app/components/error-banner';
import { StatTile } from '@/app/components/stat-tile';
import { MiniBarList } from '@/app/components/mini-bar-list';
import { EmptyState } from '@/app/components/empty-state';
import { ModelCapabilityBadges, ModelCompactionBadge, ModelContextLine, ModelTierBadge, isModelLocked } from '@/app/components/model-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

function StatusBadge({ status }: { status: number }) {
  const variant =
    status >= 500 ? 'destructive' : status >= 400 ? 'warning' : status >= 300 ? 'info' : 'success';
  return (
    <Badge variant={variant} className="font-mono text-[10px]">
      {status}
    </Badge>
  );
}

function UpstreamTable({ items }: { items: UpstreamLogItem[] }) {
  if (items.length === 0) {
    return <EmptyState icon={Server} title="暂无上游请求" description="调用 /v1/* 或连接测试后，这里会出现记录。" />;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>时间</TableHead>
          <TableHead>来源</TableHead>
          <TableHead>端点</TableHead>
          <TableHead>模型</TableHead>
          <TableHead className="text-right">状态</TableHead>
          <TableHead className="text-right">耗时</TableHead>
          <TableHead className="text-right">排队</TableHead>
          <TableHead>模式</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item, index) => (
          <TableRow key={item.id ?? `${item.ts}-${index}`} className={item.status >= 400 ? 'bg-destructive/5' : undefined}>
            <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(item.ts)}</TableCell>
            <TableCell>
              <Badge variant={item.source === 'admin-test' ? 'info' : 'outline'} className="text-[10px]">
                {item.source ?? 'v1'}
              </Badge>
            </TableCell>
            <TableCell className="max-w-[220px] truncate font-mono text-xs" title={item.endpoint}>
              {item.endpoint}
            </TableCell>
            <TableCell className="max-w-[160px] truncate font-mono text-xs">{item.model ?? '—'}</TableCell>
            <TableCell className="text-right">
              <StatusBadge status={item.status} />
            </TableCell>
            <TableCell className="text-right text-xs tabular-nums">{formatDuration(item.latencyMs)}</TableCell>
            <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
              {formatQueueWait(item.queueWaitMs)}
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">{item.stream ? '流式' : '普通'}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function AdminTable({ items }: { items: AdminLogItem[] }) {
  if (items.length === 0) {
    return <EmptyState icon={ShieldCheck} title="暂无后台 API 请求" description="管理后台自身的请求会记录在这里（与上游日志分开）。" />;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>时间</TableHead>
          <TableHead>方法</TableHead>
          <TableHead>端点</TableHead>
          <TableHead className="text-right">状态</TableHead>
          <TableHead className="text-right">耗时</TableHead>
          <TableHead>错误</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item, index) => (
          <TableRow key={item.id ?? `${item.ts}-${index}`} className={item.status >= 400 ? 'bg-destructive/5' : undefined}>
            <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(item.ts)}</TableCell>
            <TableCell className="font-mono text-xs">{item.method ?? '—'}</TableCell>
            <TableCell className="max-w-[280px] truncate font-mono text-xs" title={item.endpoint}>
              {item.endpoint}
            </TableCell>
            <TableCell className="text-right">
              <StatusBadge status={item.status} />
            </TableCell>
            <TableCell className="text-right text-xs tabular-nums">{formatDuration(item.latencyMs)}</TableCell>
            <TableCell className="max-w-[220px] truncate text-xs text-destructive" title={item.error ?? ''}>
              {item.error ?? '—'}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ModelTile({ model, allowPaidModels }: { model: ModelInfo; allowPaidModels: boolean }) {
  const locked = isModelLocked(model, allowPaidModels);
  const displayName = model.display_name || model.name || model.id;
  return (
    <div
      className={cn(
        'rounded-xl border p-3 transition-colors',
        locked ? 'border-dashed bg-muted/40' : 'bg-card hover:border-primary/30'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className={cn('truncate text-sm font-medium', locked && 'text-muted-foreground')}>{displayName}</div>
          <div className="truncate font-mono text-[11px] text-muted-foreground" title={model.id}>
            {model.id}
          </div>
        </div>
        <ModelTierBadge model={model} allowPaidModels={allowPaidModels} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {model.owned_by ? (
          <Badge variant="outline" className="font-normal text-[10px]">
            {model.owned_by}
          </Badge>
        ) : null}
        {model.default ? (
          <Badge variant="default" className="text-[10px]">
            默认
          </Badge>
        ) : null}
      </div>
      <div className="mt-2">
        <ModelCapabilityBadges model={model} />
      </div>
      <div className="mt-1.5">
        <ModelContextLine model={model} />
      </div>
      <div className="mt-1.5">
        <ModelCompactionBadge model={model} />
      </div>
    </div>
  );
}

export function OverviewPage() {
  // v2.24：token 消耗总览的模型筛选（空 = 全部模型）
  const [tokenModel, setTokenModel] = useState<string>('all');
  const { data, loading, error, lastUpdatedAt, refresh, refreshIntervalMs, setRefreshIntervalMs } = useOverview();
  // v2.34：自动刷新控制条展开状态
  const [refreshOpen, setRefreshOpen] = useState(false);

  const stats = data?.stats;
  const upstreamStats = stats?.upstream ?? {
    requests: stats?.requests ?? 0,
    errors: stats?.errors ?? 0,
    avgLatencyMs: stats?.avgLatencyMs ?? null,
    byModel: {},
    byEndpoint: {},
    rateLimitCount: 0,
    lastErrorAt: null
  };
  const adminStats = stats?.admin ?? { requests: 0, errors: 0, avgLatencyMs: null, byEndpoint: {}, lastErrorAt: null };
  const models = data?.models ?? [];
  const recentUpstream = data?.recentUpstream ?? data?.recent ?? [];
  const recentAdmin = data?.recentAdmin ?? [];
  const upstream = data?.upstream;
  const queue = upstream?.queue;
  const tokenData = data?.tokens ?? null;
  const tokenModelOptions = tokenData?.byModel ?? [];
  const filteredTokenModels =
    tokenModel === 'all'
      ? tokenModelOptions
      : tokenModelOptions.filter((item) => item.model === tokenModel);
  const filteredTokenTotal =
    tokenModel === 'all'
      ? tokenData?.total ?? null
      : filteredTokenModels[0] ?? null;
  const filteredIdentities = (tokenData?.byIdentity ?? []).filter(
    (identity) => tokenModel === 'all' || identity.byModel.some((entry) => entry.model === tokenModel)
  );
  const allowPaidModels = models.some((model) => model.paid && model.available);
  const freeCount = models.filter((model) => !model.paid).length;
  const paidCount = models.filter((model) => model.paid).length;

  const upstreamBadge = upstream?.rateLimited
    ? { variant: 'warning' as const, text: '上游限流' }
    : upstream?.ok
      ? { variant: 'success' as const, text: '正常' }
      : upstream?.challengeOk
        ? { variant: 'warning' as const, text: '部分可用' }
        : { variant: 'destructive' as const, text: '异常' };

  return (
    <div>
      <PageHeader title="概览" description="今天用了多少，一眼看完" showQueue={false} />

      {/* 状态一行：健康 / 队列 / RPS，只占一行小字，不当主角 */}
      <div className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground" data-testid="overview-status-line">
        <span className="inline-flex items-center gap-1.5">
          <span
            className={cn(
              'h-2 w-2 rounded-full',
              upstreamBadge.variant === 'success' ? 'bg-emerald-500' : upstreamBadge.variant === 'warning' ? 'bg-amber-500' : 'bg-destructive'
            )}
            aria-hidden="true"
          />
          <span className="text-foreground">{upstreamBadge.text === '正常' ? '运行正常' : upstreamBadge.text}</span>
        </span>
        <span>执行 {queue?.inFlight ?? 0}</span>
        <span>排队 {queue?.waiting ?? 0}</span>
        <span>{queue?.rps ?? '—'} req/s</span>
        <span className="hidden sm:inline">{lastUpdatedAt ? `更新于 ${formatRelative(lastUpdatedAt)}` : ''}</span>
        <button type="button" onClick={refresh} className="ml-auto inline-flex items-center gap-1 hover:text-foreground" data-testid="overview-refresh">
          <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
          刷新
        </button>
      </div>

      {error ? <ErrorBanner message={error} onRetry={refresh} /> : null}
      {data && !upstream?.ok ? (
        <div className="mb-6 flex items-center gap-2 border-l-2 border-destructive bg-card px-4 py-3 text-sm">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          上游暂时不可用，生图和对话可能失败。
          <a href="#/logs" className="ml-auto underline underline-offset-4">看日志</a>
        </div>
      ) : null}

      {!data && loading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-[92px] rounded-xl" />
          ))}
        </div>
      ) : null}

      {data ? (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <a href="#/images" className="surface-hover block" title="打开 Duck Image">
              <StatTile
                label="今日生图"
                value={formatNumber(data?.images?.today ?? 0)}
                hint={`图库共 ${formatNumber(data?.images?.count ?? 0)} 张`}
                icon={ImagePlus}
                tone="primary"
              />
            </a>
            <StatTile
              label="请求"
              value={formatNumber(upstreamStats.requests)}
              hint={`平均 ${formatDuration(upstreamStats.avgLatencyMs)}`}
              icon={Server}
            />
            <a href="#/logs" className="surface-hover block" title="看日志">
              <StatTile
                label="出错"
                value={formatNumber(upstreamStats.errors)}
                hint={upstreamStats.lastErrorAt ? `最近一次 ${formatRelative(upstreamStats.lastErrorAt)}` : '没有错误'}
                icon={AlertTriangle}
                tone={upstreamStats.errors ? 'danger' : 'default'}
              />
            </a>
            <StatTile
              label="Token"
              value={formatNumber(tokenData?.total?.total_tokens ?? 0)}
              hint="估算值"
              icon={Activity}
            />
          </div>

          <details className="group">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
              <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
              更多详情（Token 明细、模型目录、最近日志）
            </summary>
            <div className="mt-4 space-y-4">
          <Card data-testid="token-usage-card">
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-sm">Token 消耗总览</CardTitle>
                  <CardDescription className="text-xs">
                    估算值（字符数 / 4）· 按模型汇总，并可下钻到「身份 × 模型」· 累计不受清空日志影响
                  </CardDescription>
                </div>
                <Select value={tokenModel} onValueChange={setTokenModel}>
                  <SelectTrigger
                    className="h-8 w-[190px] text-xs"
                    aria-label="token 模型筛选"
                    data-testid="token-model-filter"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部模型</SelectItem>
                    {tokenModelOptions.map((item) => (
                      <SelectItem key={item.model} value={item.model}>
                        {item.model}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border bg-muted/20 px-3 py-2">
                  <div className="text-[11px] text-muted-foreground">总 tokens</div>
                  <div className="text-lg font-semibold tabular-nums" data-testid="token-total">
                    {formatNumber(filteredTokenTotal?.total_tokens ?? 0)}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    请求 {formatNumber(filteredTokenTotal?.requests ?? 0)} 次
                  </div>
                </div>
                <div className="rounded-lg border bg-muted/20 px-3 py-2">
                  <div className="text-[11px] text-muted-foreground">输入 tokens</div>
                  <div className="text-lg font-semibold tabular-nums">
                    {formatNumber(filteredTokenTotal?.prompt_tokens ?? 0)}
                  </div>
                </div>
                <div className="rounded-lg border bg-muted/20 px-3 py-2">
                  <div className="text-[11px] text-muted-foreground">输出 tokens</div>
                  <div className="text-lg font-semibold tabular-nums">
                    {formatNumber(filteredTokenTotal?.completion_tokens ?? 0)}
                  </div>
                </div>
              </div>

              <div className="grid gap-3 lg:grid-cols-2">
                <div>
                  <div className="mb-1 text-xs font-medium text-muted-foreground">按模型</div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>模型</TableHead>
                        <TableHead className="text-right">请求</TableHead>
                        <TableHead className="text-right">输入</TableHead>
                        <TableHead className="text-right">输出</TableHead>
                        <TableHead className="text-right">合计</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredTokenModels.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center text-xs text-muted-foreground">
                            暂无 token 记录（发起一次 /v1/chat/completions 后出现）
                          </TableCell>
                        </TableRow>
                      ) : (
                        filteredTokenModels.map((item) => (
                          <TableRow key={item.model}>
                            <TableCell className="max-w-[180px] truncate font-mono text-xs">{item.model}</TableCell>
                            <TableCell className="text-right tabular-nums text-xs">
                              {formatNumber(item.requests)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-xs">
                              {formatNumber(item.prompt_tokens)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-xs">
                              {formatNumber(item.completion_tokens)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-xs font-medium">
                              {formatNumber(item.total_tokens)}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
                <div>
                  <div className="mb-1 text-xs font-medium text-muted-foreground">
                    按身份（{tokenModel === 'all' ? '身份 × 模型' : `身份 · ${tokenModel}`}）
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>身份</TableHead>
                        <TableHead>模型</TableHead>
                        <TableHead className="text-right">合计</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredIdentities.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={3} className="text-center text-xs text-muted-foreground">
                            暂无身份维度记录
                          </TableCell>
                        </TableRow>
                      ) : (
                        filteredIdentities.flatMap((identity) =>
                          identity.byModel
                            .filter((entry) => tokenModel === 'all' || entry.model === tokenModel)
                            .map((entry) => (
                              <TableRow key={`${identity.identityId}-${entry.model}`}>
                                <TableCell className="max-w-[150px] truncate text-xs">
                                  <span className="font-mono">{identity.identityId}</span>
                                  {identity.identityLabel ? (
                                    <span className="ml-1 text-muted-foreground">{identity.identityLabel}</span>
                                  ) : null}
                                </TableCell>
                                <TableCell className="max-w-[130px] truncate font-mono text-xs">
                                  {entry.model}
                                </TableCell>
                                <TableCell className="text-right tabular-nums text-xs">
                                  {formatNumber(entry.total_tokens)}
                                </TableCell>
                              </TableRow>
                            ))
                        )
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-3 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">上游请求统计</CardTitle>
                <CardDescription className="text-xs">/v1/* 与连接测试真实打到 duck.ai 的请求</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-5 sm:grid-cols-2">
                <div>
                  <div className="mb-2 text-xs font-medium text-muted-foreground">按端点</div>
                  <MiniBarList entries={topEntries(upstreamStats.byEndpoint, 5)} />
                </div>
                <div>
                  <div className="mb-2 text-xs font-medium text-muted-foreground">按模型</div>
                  <MiniBarList
                    entries={topEntries(upstreamStats.byModel, 5)}
                    formatKey={(key) => (key === 'unknown' || key === '' ? '—（非模型请求）' : key)}
                  />
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">后台 API 统计</CardTitle>
                <CardDescription className="text-xs">管理后台自身的 /admin/api/* 请求（不含上游）</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-lg bg-muted/60 p-2.5">
                    <div className="text-[11px] text-muted-foreground">请求数</div>
                    <div className="text-base font-semibold tabular-nums">{formatNumber(adminStats.requests)}</div>
                  </div>
                  <div className="rounded-lg bg-muted/60 p-2.5">
                    <div className="text-[11px] text-muted-foreground">错误数</div>
                    <div className="text-base font-semibold tabular-nums">{formatNumber(adminStats.errors)}</div>
                  </div>
                  <div className="rounded-lg bg-muted/60 p-2.5">
                    <div className="text-[11px] text-muted-foreground">平均耗时</div>
                    <div className="text-base font-semibold tabular-nums">{formatDuration(adminStats.avgLatencyMs)}</div>
                  </div>
                </div>
                <div>
                  <div className="mb-2 text-xs font-medium text-muted-foreground">按端点</div>
                  <MiniBarList entries={topEntries(adminStats.byEndpoint, 6)} />
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-sm">模型目录</CardTitle>
                  <CardDescription className="text-xs">
                    共 {models.length} 个模型 · 免费 {freeCount} · 付费 {paidCount}
                    {paidCount > 0 && !allowPaidModels ? ' · 付费模型默认禁用（可在设置中开启 allowPaidModels）' : ''}
                  </CardDescription>
                </div>
                <Badge variant="outline" className="font-normal">
                  <Layers className="mr-1 h-3 w-3" />
                  {models.length}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              {models.length === 0 ? (
                <EmptyState icon={Layers} title="暂无模型数据" description="确认上游挑战已就绪后刷新。" />
              ) : (
                <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                  {models.map((model) => (
                    <ModelTile key={model.id} model={model} allowPaidModels={allowPaidModels} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">最近日志</CardTitle>
              <CardDescription className="text-xs">上游请求与后台 API 分开记录，互不混淆</CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="upstream">
                <TabsList>
                  <TabsTrigger value="upstream">上游请求</TabsTrigger>
                  <TabsTrigger value="admin">后台 API</TabsTrigger>
                </TabsList>
                <TabsContent value="upstream">
                  <UpstreamTable items={recentUpstream} />
                </TabsContent>
                <TabsContent value="admin">
                  <AdminTable items={recentAdmin} />
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
            </div>
          </details>
        </div>
      ) : null}
    </div>
  );
}
