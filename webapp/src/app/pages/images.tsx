import React, { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import { toast } from 'sonner';
import {
  ArrowUp,
  Copy,
  Download,
  Heart,
  Images as ImagesIcon,
  Loader2,
  Plus,
  RefreshCw,
  Repeat2,
  Search,
  Square,
  Trash2,
  Upload,
  X
} from 'lucide-react';
import { ApiError, apiDelete, apiGet, apiPatch, apiPost, authHeaders } from '@/app/lib/api';
import { formatDateTime } from '@/app/lib/format';
import type { ModelInfo } from '@/app/lib/types';
import { EmptyState } from '@/app/components/empty-state';
import { PageHeader } from '@/app/components/page-header';
import { ConfirmDialog } from '@/app/components/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/* 类型                                                                */
/* ------------------------------------------------------------------ */

interface GalleryItem {
  id: string;
  createdAt: number;
  source: string;
  prompt: string;
  model: string | null;
  modelDisplayName: string | null;
  format: string;
  mimeType: string;
  bytes: number;
  width: number | null;
  height: number | null;
  aspect: string | null;
  keyLabel: string | null;
  referenceCount: number;
  favorite: boolean;
}

interface GalleryStats {
  count: number;
  bytes: number;
  today: number;
  lastAt: number | null;
  saveGallery: boolean;
  retentionDays: number;
  maxItems: number;
}

interface GalleryResponse {
  items: GalleryItem[];
  hasMore: boolean;
  nextBefore: number | null;
  stats: GalleryStats;
}

interface GeneratedImage extends Partial<GalleryItem> {
  dataUrl: string;
  saved: boolean;
  format: string;
}

interface GenerateResponse {
  ok: boolean;
  model: string;
  modelDisplayName: string | null;
  aspect: string | null;
  elapsedMs: number;
  identityLabel: string | null;
  images: GeneratedImage[];
  partialError?: string;
}

/* ------------------------------------------------------------------ */
/* 常量                                                                */
/* ------------------------------------------------------------------ */

const ASPECTS: Array<{ value: string; label: string; w: number; h: number }> = [
  { value: 'auto', label: '自动', w: 14, h: 14 },
  { value: '1:1', label: '1:1', w: 14, h: 14 },
  { value: '16:9', label: '16:9', w: 20, h: 11 },
  { value: '9:16', label: '9:16', w: 11, h: 20 },
  { value: '4:3', label: '4:3', w: 18, h: 13 },
  { value: '3:4', label: '3:4', w: 13, h: 18 },
  { value: '3:2', label: '3:2', w: 19, h: 12 },
  { value: '21:9', label: '21:9', w: 22, h: 9 }
];

const SOURCE_LABEL: Record<string, string> = {
  admin: '工作台',
  api: 'API',
  'api-edit': 'API 参考图'
};

const MAX_REFERENCES = 4;
const REFERENCE_MAX_SIDE = 1024;

/* ------------------------------------------------------------------ */
/* 工具函数                                                            */
/* ------------------------------------------------------------------ */

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

/** 参考图在浏览器侧缩到 ≤1024px（上游最终还会缩到 512px），避免请求体过大。 */
function fileToReference(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('只能上传图片文件'));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, REFERENCE_MAX_SIDE / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const context = canvas.getContext('2d');
      if (!context) {
        URL.revokeObjectURL(url);
        reject(new Error('浏览器不支持 canvas'));
        return;
      }
      context.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片无法解码'));
    };
    img.src = url;
  });
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** 带 admin token 拉取图库图片 → object URL（<img> 不能带 Authorization 头）。 */
const blobCache = new Map<string, Promise<string>>();
function loadGalleryImage(id: string): Promise<string> {
  let pending = blobCache.get(id);
  if (!pending) {
    pending = fetch(`/admin/api/images/${encodeURIComponent(id)}/file`, {
      headers: authHeaders({ Accept: 'image/*' }),
      credentials: 'same-origin'
    }).then(async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return URL.createObjectURL(await response.blob());
    });
    pending.catch(() => blobCache.delete(id));
    blobCache.set(id, pending);
  }
  return pending;
}

function useGalleryImage(id: string | undefined, fallback?: string) {
  const [src, setSrc] = useState<string | null>(fallback || null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (fallback) {
      setSrc(fallback);
      return;
    }
    if (!id) return;
    let alive = true;
    setFailed(false);
    loadGalleryImage(id)
      .then((url) => alive && setSrc(url))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [id, fallback]);
  return { src, failed };
}

function downloadHref(href: string, filename: string) {
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

/* ------------------------------------------------------------------ */
/* 子组件                                                              */
/* ------------------------------------------------------------------ */

function GalleryThumb({
  item,
  onOpen,
  onToggleFavorite
}: {
  item: GalleryItem;
  onOpen: () => void;
  onToggleFavorite: () => void;
}) {
  const { src, failed } = useGalleryImage(item.id);
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={onOpen}
        className="surface-hover tile checker block w-full overflow-hidden bg-card"
        style={{ aspectRatio: item.width && item.height ? `${item.width} / ${item.height}` : '1 / 1' }}
        title={item.prompt}
      >
        {src ? (
          <img src={src} alt={item.prompt} loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            {failed ? <X className="h-5 w-5" /> : <Loader2 className="h-5 w-5 animate-spin" />}
          </div>
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 translate-y-1 bg-gradient-to-t from-black/75 to-transparent px-2 pb-1.5 pt-6 text-left text-[11px] leading-snug text-white opacity-0 transition group-hover:translate-y-0 group-hover:opacity-100">
          <span className="line-clamp-2">{item.prompt}</span>
        </div>
      </button>
      <button
        type="button"
        onClick={onToggleFavorite}
        aria-label={item.favorite ? '取消收藏' : '收藏'}
        className={cn(
          'chip absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center bg-card transition',
          item.favorite ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        )}
      >
        <Heart className={cn('h-3.5 w-3.5', item.favorite ? 'fill-rose-500 text-rose-500' : '')} />
      </button>
    </div>
  );
}

function ResultTile({
  image,
  onOpen,
  onUseAsReference
}: {
  image: GeneratedImage;
  onOpen: () => void;
  onUseAsReference: () => void;
}) {
  return (
    <div className="group relative">
      <button type="button" onClick={onOpen} className="checker block w-full overflow-hidden rounded-xl">
        <img src={image.dataUrl} alt={image.prompt || '生成结果'} className="w-full object-contain" />
      </button>
      <div className="absolute bottom-2 right-2 flex gap-1.5 opacity-0 transition group-hover:opacity-100">
        <Button size="sm" variant="outline" className="h-7 px-2" onClick={onUseAsReference}>
          <Repeat2 className="h-3.5 w-3.5" />
          作参考
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2"
          onClick={() => downloadHref(image.dataUrl, `${image.id || 'duckai-image'}.${image.format === 'jpeg' ? 'jpg' : image.format}`)}
        >
          <Download className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

function ImageLightbox({
  item,
  onClose,
  onReuse,
  onUseAsReference,
  onDelete,
  onToggleFavorite
}: {
  item: (GalleryItem & { dataUrl?: string }) | null;
  onClose: () => void;
  onReuse: (item: GalleryItem) => void;
  onUseAsReference: (src: string) => void;
  onDelete: (item: GalleryItem) => void;
  onToggleFavorite: (item: GalleryItem) => void;
}) {
  const { src } = useGalleryImage(item?.dataUrl ? undefined : item?.id, item?.dataUrl);
  if (!item) return null;
  const ext = item.format === 'jpeg' ? 'jpg' : item.format;
  return (
    <Dialog open={Boolean(item)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[94vh] max-w-5xl overflow-y-auto p-4 sm:p-5">
        <DialogHeader>
          <DialogTitle className="slant">图片详情</DialogTitle>
          <DialogDescription className="font-mono text-[11px]">
            {item.id ? `${item.id} · ` : ''}
            {formatDateTime(item.createdAt)}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="tile checker flex min-h-[260px] items-center justify-center overflow-hidden">
            {src ? <img src={src} alt={item.prompt} className="max-h-[72vh] w-auto object-contain" /> : <Loader2 className="h-6 w-6 animate-spin" />}
          </div>
          <div className="flex flex-col gap-3 text-sm">
            <div>
              <div className="mb-1 font-mono text-[11px] font-bold uppercase tracking-wide text-muted-foreground">提示词</div>
              <p className="field max-h-48 overflow-y-auto whitespace-pre-wrap break-words p-2.5 text-[13px] leading-relaxed">{item.prompt}</p>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="text-muted-foreground">模型</dt>
              <dd className="truncate font-mono">{item.modelDisplayName || item.model || '—'}</dd>
              <dt className="text-muted-foreground">尺寸</dt>
              <dd className="font-mono">{item.width && item.height ? `${item.width} × ${item.height}` : '—'}</dd>
              <dt className="text-muted-foreground">画幅</dt>
              <dd className="font-mono">{item.aspect || '自动'}</dd>
              <dt className="text-muted-foreground">来源</dt>
              <dd>
                {SOURCE_LABEL[item.source] || item.source}
                {item.keyLabel && item.source !== 'admin' ? ` · ${item.keyLabel}` : ''}
              </dd>
              {item.referenceCount ? (
                <>
                  <dt className="text-muted-foreground">参考图</dt>
                  <dd>{item.referenceCount} 张</dd>
                </>
              ) : null}
              {item.bytes ? (
                <>
                  <dt className="text-muted-foreground">大小</dt>
                  <dd className="font-mono">
                    {formatBytes(item.bytes)} · {ext.toUpperCase()}
                  </dd>
                </>
              ) : null}
            </dl>
            <div className="mt-auto grid grid-cols-2 gap-2">
              <Button variant="outline" size="sm" onClick={() => onReuse(item)}>
                <RefreshCw className="h-3.5 w-3.5" />
                再来一张
              </Button>
              <Button variant="outline" size="sm" disabled={!src} onClick={() => src && onUseAsReference(src)}>
                <Repeat2 className="h-3.5 w-3.5" />
                作参考图
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void navigator.clipboard?.writeText(item.prompt).then(() => toast.success('提示词已复制'));
                }}
              >
                <Copy className="h-3.5 w-3.5" />
                复制提示词
              </Button>
              <Button variant="outline" size="sm" disabled={!src} onClick={() => src && downloadHref(src, `${item.id || 'duckai-image'}.${ext}`)}>
                <Download className="h-3.5 w-3.5" />
                下载
              </Button>
              {item.id ? (
                <>
                  <Button variant="outline" size="sm" onClick={() => onToggleFavorite(item)}>
                    <Heart className={cn('h-3.5 w-3.5', item.favorite ? 'fill-rose-500 text-rose-500' : '')} />
                    {item.favorite ? '已收藏' : '收藏'}
                  </Button>
                  <Button variant="destructive" size="sm" onClick={() => onDelete(item)}>
                    <Trash2 className="h-3.5 w-3.5" />
                    删除
                  </Button>
                </>
              ) : null}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FanThumb({ item, large }: { item: GalleryItem; large: boolean }) {
  const { src } = useGalleryImage(item.id);
  return (
    <div
      className={cn(
        'checker aspect-square w-full overflow-hidden bg-card',
        large ? '' : ''
      )}
    >
      {src ? <img src={src} alt={item.prompt} className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" /> : null}
    </div>
  );
}

function MenuGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 px-1 text-[12px] font-medium text-muted-foreground">{label}</div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Pill({
  active,
  disabled,
  onClick,
  children
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'rounded-full border px-2.5 py-1 text-xs transition disabled:opacity-40',
        active ? 'border-foreground bg-foreground text-background' : 'border-border hover:border-foreground'
      )}
    >
      {children}
    </button>
  );
}

function ParamChip({ children, onClear }: { children: React.ReactNode; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1">
      {children}
      <button type="button" aria-label="移除" onClick={onClear} className="hover:text-foreground">
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

interface Turn {
  key: string;
  prompt: string;
  fullPrompt: string;
  meta: string;
  count: number;
  status: 'pending' | 'done' | 'error';
  images: GeneratedImage[];
  error?: string;
  model: string | null;
  modelDisplayName: string | null;
  aspect: string | null;
}

/* ------------------------------------------------------------------ */
/* 页面                                                                */
/* ------------------------------------------------------------------ */

export function ImagesPage({ initialView = 'create' }: { initialView?: 'create' | 'gallery' } = {}) {
  // 生成参数
  const [prompt, setPrompt] = useState('');
  const [aspect, setAspect] = useState('auto');
  const [count, setCount] = useState(1);
  const [model, setModel] = useState('');
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [references, setReferences] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // 生成状态
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [view, setView] = useState<'create' | 'gallery'>(initialView);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const feedEnd = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // 图库
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [stats, setStats] = useState<GalleryStats | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [lightbox, setLightbox] = useState<(GalleryItem & { dataUrl?: string }) | null>(null);
  const [pendingDelete, setPendingDelete] = useState<GalleryItem | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const imageModels = useMemo(
    () => models.filter((entry) => Array.isArray(entry.tools) && entry.tools.includes('image_generation')),
    [models]
  );

  useEffect(() => {
    void (async () => {
      try {
        const response = await apiGet<{ items: ModelInfo[] }>('/models');
        const list = Array.isArray(response?.items) ? response.items : [];
        setModels(list);
        const usable = list.filter((entry) => entry.tools?.includes('image_generation') && entry.available !== false);
        const preferred = usable.find((entry) => entry.default) || usable.find((entry) => !entry.paid) || usable[0];
        if (preferred) setModel((current) => current || preferred.id);
      } catch (error) {
        if (!(error as ApiError)?.handled) toast.error((error as Error).message || '模型列表加载失败');
      }
    })();
  }, []);

  const loadGallery = useCallback(
    async (options: { append?: boolean } = {}) => {
      const params = new URLSearchParams({ limit: '36' });
      if (appliedQuery) params.set('q', appliedQuery);
      if (favoritesOnly) params.set('favorite', '1');
      if (options.append && nextBefore) params.set('before', String(nextBefore));
      if (!options.append) setLoading(true);
      try {
        const response = await apiGet<GalleryResponse>(`/images?${params.toString()}`);
        setItems((current) => (options.append ? [...current, ...response.items] : response.items));
        setHasMore(response.hasMore);
        setNextBefore(response.nextBefore);
        setStats(response.stats);
      } catch (error) {
        if (!(error as ApiError)?.handled) toast.error((error as Error).message || '图库加载失败');
      } finally {
        setLoading(false);
      }
    },
    [appliedQuery, favoritesOnly, nextBefore]
  );

  useEffect(() => {
    void loadGallery();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedQuery, favoritesOnly]);

  useEffect(() => {
    if (!busy) return;
    const startedAt = Date.now();
    setElapsed(0);
    const timer = window.setInterval(() => setElapsed(Date.now() - startedAt), 200);
    return () => window.clearInterval(timer);
  }, [busy]);

  const addReferenceFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files).filter((file) => file.type.startsWith('image/'));
    if (!list.length) return;
    const converted: string[] = [];
    for (const file of list) {
      try {
        converted.push(await fileToReference(file));
      } catch (error) {
        toast.error((error as Error).message);
      }
    }
    setReferences((current) => {
      const next = [...current, ...converted].slice(0, MAX_REFERENCES);
      if (current.length + converted.length > MAX_REFERENCES) toast.info(`最多 ${MAX_REFERENCES} 张参考图`);
      return next;
    });
  }, []);

  const addReferenceFromSrc = useCallback(async (src: string) => {
    try {
      const blob = await (await fetch(src)).blob();
      const file = new File([blob], 'reference.png', { type: blob.type || 'image/png' });
      await addReferenceFiles([file]);
      toast.success('已加入参考图');
      setView('create');
    } catch {
      const dataUrl = src.startsWith('data:') ? src : await blobToDataUrl(await (await fetch(src)).blob());
      setReferences((current) => [...current, dataUrl].slice(0, MAX_REFERENCES));
    }
  }, [addReferenceFiles]);

  const fullPrompt = useMemo(() => {
    return prompt.trim();
  }, [prompt]);

  const generate = useCallback(async () => {
    if (!fullPrompt) return;
    if (busy) return;
    const controller = new AbortController();
    abortRef.current = controller;
    const key = `${Date.now()}`;
    const metaParts = [
      aspect !== 'auto' ? aspect : '',
      count > 1 ? `${count} 张` : '',
      references.length ? `${references.length} 张参考图` : ''
    ].filter(Boolean);
    setTurns((current) => [
      ...current,
      {
        key,
        prompt: prompt.trim(),
        fullPrompt,
        meta: metaParts.join(' · '),
        count,
        status: 'pending',
        images: [],
        model: model || null,
        modelDisplayName: null,
        aspect: aspect === 'auto' ? null : aspect
      }
    ]);
    setPrompt('');
    setBusy(true);
    const sentReferences = references;
    setReferences([]);
    try {
      const response = await apiPost<GenerateResponse>(
        '/images/generate',
        {
          prompt: fullPrompt,
          model: model || undefined,
          n: count,
          aspect: aspect === 'auto' ? undefined : aspect,
          references: sentReferences
        },
        { signal: controller.signal }
      );
      setTurns((current) =>
        current.map((turn) =>
          turn.key === key
            ? { ...turn, status: 'done', images: response.images, model: response.model, modelDisplayName: response.modelDisplayName }
            : turn
        )
      );
      if (response.partialError) toast.warning(`只生成了 ${response.images.length} 张，详情见日志`);
      void loadGallery();
    } catch (error) {
      const aborted = (error as Error)?.name === 'AbortError';
      const message = aborted ? '已取消' : (error as Error).message || '未知错误';
      setTurns((current) => current.map((turn) => (turn.key === key ? { ...turn, status: 'error', error: message } : turn)));
      if (!aborted && !(error as ApiError)?.handled) toast.error('生成失败，详情见日志');
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }, [aspect, busy, count, fullPrompt, loadGallery, model, prompt, references]);

  useEffect(() => {
    feedEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 192)}px`;
  }, [prompt]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  const toggleFavorite = useCallback(async (item: GalleryItem) => {
    try {
      const updated = await apiPatch<GalleryItem>(`/images/${item.id}`, { favorite: !item.favorite });
      setItems((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)));
      setLightbox((current) => (current && current.id === updated.id ? { ...current, ...updated } : current));
    } catch (error) {
      if (!(error as ApiError)?.handled) toast.error((error as Error).message);
    }
  }, []);

  const reuse = useCallback((item: GalleryItem) => {
    setPrompt(item.prompt);
    if (item.aspect) setAspect(item.aspect);
    if (item.model) setModel(item.model);
    setLightbox(null);
    setView('create');
    window.setTimeout(() => textareaRef.current?.focus(), 50);
  }, []);

  const onPaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const files = Array.from(event.clipboardData?.files || []).filter((file) => file.type.startsWith('image/'));
      if (files.length) {
        event.preventDefault();
        void addReferenceFiles(files);
      }
    },
    [addReferenceFiles]
  );

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragging(false);
      setView('create');
      if (event.dataTransfer?.files?.length) void addReferenceFiles(event.dataTransfer.files);
    },
    [addReferenceFiles]
  );


  const selectedModel = imageModels.find((entry) => entry.id === model);
  const hasTurns = turns.length > 0;

  const composer = (
    <div className={cn('z-20 w-full', hasTurns ? 'sticky bottom-4 pb-2' : '')}>
      {dragging ? (
        <div className="mb-2 rounded-xl border border-dashed border-[color:hsl(var(--brand))] bg-card py-3 text-center text-sm text-brand">
          松手即可作为参考图
        </div>
      ) : null}
      <div className="rounded-2xl border border-border bg-card px-3 pb-2.5 pt-3 shadow-lift transition-shadow focus-within:border-[color:hsl(var(--ring)/0.5)]">
        {references.length ? (
          <div className="mb-2 flex gap-2 px-1">
            {references.map((src, index) => (
              <div key={`${index}-${src.length}`} className="group relative h-14 w-14 overflow-hidden rounded-lg border border-border">
                <img src={src} alt={`参考图 ${index + 1}`} className="h-full w-full object-cover" />
                <button
                  type="button"
                  aria-label="移除参考图"
                  onClick={() => setReferences((current) => current.filter((_, i) => i !== index))}
                  className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition group-hover:opacity-100"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <div className="flex items-end gap-2">
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              aria-label="更多选项"
              onClick={() => setMenuOpen((value) => !value)}
              className={cn(
                'flex h-9 w-9 items-center justify-center rounded-full border border-border text-muted-foreground transition hover:bg-muted hover:text-foreground',
                menuOpen && 'bg-muted text-foreground'
              )}
            >
              <Plus className={cn('h-4 w-4 transition', menuOpen && 'rotate-45')} />
            </button>
            {menuOpen ? (
              <div className="absolute bottom-12 left-0 z-30 w-[320px] space-y-4 rounded-xl border border-border bg-popover p-4 text-left shadow-lift">
                <button
                  type="button"
                  onClick={() => {
                    fileInput.current?.click();
                    setMenuOpen(false);
                  }}
                  disabled={references.length >= MAX_REFERENCES}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-sm hover:bg-muted disabled:opacity-50"
                >
                  <Upload className="h-4 w-4" />
                  上传参考图
                  <span className="ml-auto text-xs text-muted-foreground">
                    {references.length}/{MAX_REFERENCES}
                  </span>
                </button>
                <MenuGroup label="画幅">
                  {ASPECTS.map((entry) => (
                    <Pill key={entry.value} active={aspect === entry.value} onClick={() => setAspect(entry.value)}>
                      {entry.label}
                    </Pill>
                  ))}
                </MenuGroup>
                <MenuGroup label="张数">
                  {[1, 2, 3, 4].map((value) => (
                    <Pill key={value} active={count === value} onClick={() => setCount(value)}>
                      {value}
                    </Pill>
                  ))}
                </MenuGroup>
                {imageModels.filter((entry) => entry.available !== false).length > 1 ? (
                  <MenuGroup label="模型">
                    {imageModels.filter((entry) => entry.available !== false).map((entry) => (
                      <Pill
                        key={entry.id}
                        active={model === entry.id}
                        disabled={entry.available === false}
                        onClick={() => setModel(entry.id)}
                      >
                        {entry.display_name || entry.name || entry.id}
                      </Pill>
                    ))}
                  </MenuGroup>
                ) : null}
              </div>
            ) : null}
          </div>
          <Textarea
            ref={textareaRef}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onPaste={onPaste}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void generate();
              }
            }}
            rows={1}
            maxLength={4000}
            placeholder={references.length ? '说说要怎么改这张图' : '描述你想要的图片，或点 + 上传图片进行编辑'}
            className="max-h-48 min-h-[36px] flex-1 resize-none !border-0 !bg-transparent px-1 py-1.5 text-[15px] leading-relaxed shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
          />
          {busy ? (
            <button
              type="button"
              aria-label="停止"
              onClick={() => abortRef.current?.abort()}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-foreground text-background"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              aria-label="生成"
              disabled={!prompt.trim()}
              onClick={() => void generate()}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand text-white shadow-soft transition hover:opacity-90 disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-11 text-xs text-muted-foreground">
          <span className="rounded-full bg-muted px-2.5 py-1 text-foreground">
            {selectedModel?.display_name || selectedModel?.name || 'GPT Image'}
          </span>
          {aspect !== 'auto' ? <ParamChip onClear={() => setAspect('auto')}>{aspect}</ParamChip> : null}
          {count > 1 ? <ParamChip onClear={() => setCount(1)}>{count} 张</ParamChip> : null}
        </div>
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => {
          if (event.target.files) void addReferenceFiles(event.target.files);
          event.target.value = '';
        }}
      />
    </div>
  );

  return (
    <div
      className="relative mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-3xl flex-col"
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDragging(false);
      }}
      onDrop={onDrop}
    >
      {view === 'gallery' ? (
        <PageHeader title={`图库${stats?.count ? ` · ${stats.count}` : ''}`} />
      ) : null}

      {view === 'gallery' ? (
        <div className="flex-1 pb-10">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <form
              className="relative flex-1"
              onSubmit={(event) => {
                event.preventDefault();
                setAppliedQuery(query.trim());
              }}
            >
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索提示词" className="h-9 pl-8" />
            </form>
            <Button size="sm" variant={favoritesOnly ? 'secondary' : 'ghost'} onClick={() => setFavoritesOnly((value) => !value)}>
              <Heart className={cn('h-3.5 w-3.5', favoritesOnly ? 'fill-current' : '')} />
              收藏
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmClear(true)} disabled={!items.length}>
              <Trash2 className="h-3.5 w-3.5" />
              清空
            </Button>
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : items.length ? (
            <>
              <div className="columns-2 gap-3 sm:columns-3 [&>*]:mb-3 [&>*]:break-inside-avoid">
                {items.map((item) => (
                  <GalleryThumb key={item.id} item={item} onOpen={() => setLightbox(item)} onToggleFavorite={() => void toggleFavorite(item)} />
                ))}
              </div>
              {hasMore ? (
                <div className="mt-2 flex justify-center">
                  <Button variant="ghost" size="sm" onClick={() => void loadGallery({ append: true })}>
                    加载更多
                  </Button>
                </div>
              ) : null}
            </>
          ) : (
            <EmptyState
              icon={ImagesIcon}
              title={appliedQuery || favoritesOnly ? '没有匹配的图片' : '图库是空的'}
              description={appliedQuery || favoritesOnly ? '换个关键词或取消收藏筛选。' : '生成的图片都会自动收进这里。'}
            />
          )}
        </div>
      ) : (
        <div className="flex flex-1 flex-col">
          {hasTurns ? (
            <div className="flex-1 space-y-10 pb-6 pt-4">
              {turns.map((turn) => (
                <div key={turn.key} className="space-y-3">
                  <div className="flex justify-end">
                    <div className="max-w-[85%] rounded-2xl bg-muted px-4 py-2.5 text-[14.5px] leading-relaxed">
                      {turn.prompt}
                      {turn.meta ? <div className="mt-1 text-[11.5px] text-muted-foreground">{turn.meta}</div> : null}
                    </div>
                  </div>
                  {turn.status === 'pending' ? (
                    <div className={cn('grid gap-3', turn.count > 1 ? 'grid-cols-2' : 'max-w-md')}>
                      {Array.from({ length: turn.count }).map((_, index) => (
                        <div key={index} className="checker flex aspect-square items-center justify-center rounded-xl text-muted-foreground">
                          <div className="flex flex-col items-center gap-2 text-xs">
                            <Loader2 className="h-5 w-5 animate-spin" />
                            {(elapsed / 1000).toFixed(0)}s
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : turn.status === 'error' ? (
                    <div className="flex items-center gap-2 text-sm text-destructive">
                      <X className="h-4 w-4" />
                      生成失败：{turn.error}
                      <a href="#/logs" className="underline underline-offset-4">看日志</a>
                    </div>
                  ) : (
                    <div className={cn('grid gap-3', turn.images.length > 1 ? 'grid-cols-2' : 'max-w-xl')}>
                      {turn.images.map((image, index) => (
                        <ResultTile
                          key={image.id || index}
                          image={{ ...image, prompt: turn.prompt }}
                          onOpen={() =>
                            setLightbox({
                              id: image.id || '',
                              createdAt: image.createdAt || Date.now(),
                              source: 'admin',
                              prompt: turn.fullPrompt,
                              model: turn.model,
                              modelDisplayName: turn.modelDisplayName,
                              format: image.format,
                              mimeType: image.mimeType || 'image/png',
                              bytes: image.bytes || 0,
                              width: image.width ?? null,
                              height: image.height ?? null,
                              aspect: turn.aspect,
                              keyLabel: null,
                              referenceCount: image.referenceCount || 0,
                              favorite: Boolean(image.favorite),
                              dataUrl: image.dataUrl
                            })
                          }
                          onUseAsReference={() => void addReferenceFromSrc(image.dataUrl)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ))}
              <div ref={feedEnd} />
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center pt-[8vh] text-center">
              <h1 className="text-[26px] font-semibold tracking-tight">想画点什么？</h1>
              <div className="mt-6 w-full text-left">{composer}</div>
              {items.length ? (
                <div className="mt-10 w-full text-left">
                  <div className="mb-3 flex items-center justify-between text-[13px] text-muted-foreground">
                    <span>最近作品</span>
                    <a href="#/gallery" className="transition-colors hover:text-foreground">查看全部</a>
                  </div>
                  <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
                    {items.slice(0, 6).map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setLightbox(item)}
                        className="group overflow-hidden rounded-xl ring-1 ring-border transition duration-200 hover:-translate-y-0.5 hover:shadow-lift"
                      >
                        <FanThumb item={item} large={false} />
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {hasTurns ? composer : null}
        </div>
      )}

      <ImageLightbox
        item={lightbox}
        onClose={() => setLightbox(null)}
        onReuse={reuse}
        onUseAsReference={(src) => {
          setLightbox(null);
          void addReferenceFromSrc(src);
        }}
        onDelete={(item) => setPendingDelete(item)}
        onToggleFavorite={(item) => void toggleFavorite(item)}
      />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title="删除这张图片？"
        description="图片文件会从 data/images 中删除，无法恢复。"
        confirmText="删除"
        destructive
        onConfirm={async () => {
          if (!pendingDelete) return;
          try {
            await apiDelete(`/images/${pendingDelete.id}`);
            setItems((current) => current.filter((entry) => entry.id !== pendingDelete.id));
            setLightbox(null);
            toast.success('已删除');
          } catch (error) {
            if (!(error as ApiError)?.handled) toast.error((error as Error).message);
          } finally {
            setPendingDelete(null);
          }
        }}
      />

      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="清空图库？"
        description="会删除所有未收藏的图片，收藏的图片会保留。"
        confirmText="清空"
        destructive
        onConfirm={async () => {
          try {
            const response = await apiDelete<{ removed: number }>('/images');
            toast.success(`已清理 ${response.removed} 张`);
            void loadGallery();
          } catch (error) {
            if (!(error as ApiError)?.handled) toast.error((error as Error).message);
          } finally {
            setConfirmClear(false);
          }
        }}
      />
    </div>
  );
}
