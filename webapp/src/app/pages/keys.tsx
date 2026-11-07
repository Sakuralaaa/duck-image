import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2
} from 'lucide-react';
import { toast } from 'sonner';
import { apiDelete, apiGet, apiPost, ApiError } from '@/app/lib/api';
import { formatDateTime, formatNumber, formatRelative } from '@/app/lib/format';
import type { CreatedKey, KeyItem } from '@/app/lib/types';
import { PageHeader } from '@/app/components/page-header';
import { ErrorBanner } from '@/app/components/error-banner';
import { EmptyState } from '@/app/components/empty-state';
import { CopyButton } from '@/app/components/copy-button';
import { ConfirmDialog } from '@/app/components/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export function KeysPage() {
  const [items, setItems] = useState<KeyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedKey | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<KeyItem | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiGet<{ items: KeyItem[] }>('/keys');
      setItems(Array.isArray(response?.items) ? response.items : []);
    } catch (err) {
      if ((err as ApiError)?.handled) return;
      setError((err as Error)?.message || '加载 API Key 失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    setCreating(true);
    try {
      const response = await apiPost<CreatedKey>('/keys', { label: label.trim() || 'default' });
      setCreated(response);
      setCreateOpen(false);
      setLabel('');
      toast.success('API Key 已创建');
      await load();
    } catch (err) {
      if ((err as ApiError)?.handled) return;
      toast.error((err as Error)?.message || '创建失败，请重试');
    } finally {
      setCreating(false);
    }
  };

  const revoke = async () => {
    if (!revokeTarget) return;
    try {
      await apiDelete<{ ok: boolean }>(`/keys/${encodeURIComponent(revokeTarget.id)}`);
      toast.success('API Key 已吊销');
      setRevokeTarget(null);
      await load();
    } catch (err) {
      if ((err as ApiError)?.handled) return;
      toast.error((err as Error)?.message || '吊销失败，请重试');
    }
  };

  const totalRequests = items.reduce((sum, item) => sum + (Number(item.requestCount) || 0), 0);

  return (
    <div className="mx-auto w-full max-w-[860px]">
      <PageHeader
        title="API Key"
        actions={
          <Button size="sm" data-testid="keys-create" onClick={() => setCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            创建 Key
          </Button>
        }
      />

      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}

      <div className="surface px-2 py-1">
        {loading && items.length === 0 ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-10 rounded-lg" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="py-14 text-center text-sm text-muted-foreground">还没有 API Key</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[12px] text-muted-foreground">
                <th className="px-3 py-2.5 font-medium">名称</th>
                <th className="px-3 py-2.5 font-medium">Key</th>
                <th className="w-32 px-3 py-2.5 font-medium">最近使用</th>
                <th className="w-12 px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-t border-border transition-colors hover:bg-muted/40">
                  <td className="px-3 py-3 font-medium">{item.label || '未命名'}</td>
                  <td className="px-3 py-3">
                    <span className="inline-flex items-center gap-1">
                      <span className="font-mono text-[12.5px] text-muted-foreground">{item.keyPreview}</span>
                      <CopyButton value={item.keyPreview} size="sm" variant="ghost" />
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-[13px] text-muted-foreground">
                    {item.lastUsedAt ? formatRelative(item.lastUsedAt) : '—'}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="删除"
                      className="h-8 w-8 hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => setRevokeTarget(item)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Dialog open={createOpen} onOpenChange={(open) => (!creating ? setCreateOpen(open) : null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>创建 API Key</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (!creating) void create();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="key-label">名称</Label>
              <Input
                id="key-label"
                value={label}
                autoFocus
                maxLength={60}
                placeholder="例如：my-agent"
                onChange={(event) => setLabel(event.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>
                取消
              </Button>
              <Button type="submit" disabled={creating}>
                {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                创建
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(created)} onOpenChange={(open) => (!open ? setCreated(null) : null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>API Key 创建成功</DialogTitle>
            <DialogDescription>关闭后无法再次查看完整 Key。</DialogDescription>
          </DialogHeader>
          {created ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>{created.label}</Label>
                <div className="flex gap-2">
                  <Input readOnly value={created.key} className="font-mono text-xs" onFocus={(event) => event.currentTarget.select()} />
                  <CopyButton value={created.key} label="复制" />
                </div>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreated(null)}>
              关闭
            </Button>
            {created ? <CopyButton value={created.key} label="复制并关闭" /> : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(revokeTarget)}
        onOpenChange={(open) => (!open ? setRevokeTarget(null) : null)}
        title="删除 API Key？"
        description={`删除「${revokeTarget?.label ?? ''}」后，使用它的客户端会立即失效。`}
        confirmText="删除"
        destructive
        onConfirm={revoke}
      />
    </div>
  );
}
