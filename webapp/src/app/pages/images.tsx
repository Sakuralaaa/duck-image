import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import { toast } from 'sonner';
import {
  Copy,
  Download,
  Heart,
  ImagePlus,
  Images as ImagesIcon,
  Loader2,
  RefreshCw,
  Repeat2,
  Search,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
  X
} from 'lucide-react';
import { ApiError, apiDelete, apiGet, apiPatch, apiPost, authHeaders } from '@/app/lib/api';
import { formatDateTime, formatRelative } from '@/app/lib/format';
import type { ModelInfo } from '@/app/lib/types';
import { PageHeader } from '@/app/components/page-header';
import { EmptyState } from '@/app/components/empty-state';
import { ConfirmDialog } from '@/app/components/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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

const STYLES: Array<{ id: string; label: string; suffix: string }> = [
  { id: 'none', label: '无', suffix: '' },
  { id: 'photo', label: '写实摄影', suffix: '写实摄影风格，自然光，细节丰富，35mm 镜头，浅景深' },
  { id: 'anime', label: '日系动漫', suffix: '日系动漫插画风格，干净线条，明亮配色，赛璐璐上色' },
  { id: 'watercolor', label: '水彩', suffix: '水彩画风格，柔和晕染，纸张纹理，留白' },
  { id: 'pixel', label: '像素', suffix: '16-bit 像素艺术风格，有限调色板，清晰像素边缘' },
  { id: '3d', label: '3D 渲染', suffix: '3D 渲染，柔和全局光照，粘土质感，干净背景' },
  { id: 'ink', label: '国风水墨', suffix: '中国水墨画风格，墨色浓淡变化，宣纸质感，写意' },
  { id: 'flat', label: '扁平插画', suffix: '扁平矢量插画风格，几何形状，大色块，简洁' },
  { id: 'cyber', label: '赛博朋克', suffix: '赛博朋克风格，霓虹灯光，雨夜城市，高对比度' }
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
      <button type="button" onClick={onOpen} className="surface surface-hover checker block w-full overflow-hidden">
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

/* ------------------------------------------------------------------ */
/* 页面                                                                */
/* ------------------------------------------------------------------ */

export function ImagesPage() {
  // 生成参数
  const [prompt, setPrompt] = useState('');
  const [style, setStyle] = useState('none');
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
  const [result, setResult] = useState<GenerateResponse | null>(null);
  const [resultPrompt, setResultPrompt] = useState('');
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
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      const dataUrl = src.startsWith('data:') ? src : await blobToDataUrl(await (await fetch(src)).blob());
      setReferences((current) => [...current, dataUrl].slice(0, MAX_REFERENCES));
    }
  }, [addReferenceFiles]);

  const fullPrompt = useMemo(() => {
    const preset = STYLES.find((entry) => entry.id === style);
    const base = prompt.trim();
    if (!base) return '';
    return preset?.suffix ? `${base}\n\n风格：${preset.suffix}` : base;
  }, [prompt, style]);

  const generate = useCallback(async () => {
    if (!fullPrompt) {
      toast.error('先写点提示词');
      return;
    }
    if (busy) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setResultPrompt(fullPrompt);
    try {
      const response = await apiPost<GenerateResponse>(
        '/images/generate',
        {
          prompt: fullPrompt,
          model: model || undefined,
          n: count,
          aspect: aspect === 'auto' ? undefined : aspect,
          references
        },
        { signal: controller.signal }
      );
      setResult(response);
      if (response.partialError) toast.warning(`只生成了 ${response.images.length} 张：${response.partialError}`);
      else toast.success(`生成完成 · ${(response.elapsedMs / 1000).toFixed(1)}s`);
      void loadGallery();
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') {
        toast.info('已取消（上游可能仍会完成这次生成）');
      } else if (!(error as ApiError)?.handled) {
        toast.error((error as Error).message || '生成失败');
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }, [aspect, busy, count, fullPrompt, loadGallery, model, references]);

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
    setStyle('none');
    if (item.aspect) setAspect(item.aspect);
    if (item.model) setModel(item.model);
    setLightbox(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
      if (event.dataTransfer?.files?.length) void addReferenceFiles(event.dataTransfer.files);
    },
    [addReferenceFiles]
  );

  const selectedModel = imageModels.find((entry) => entry.id === model);

  return (
    <div className="space-y-6">
      <PageHeader
        title="生图工作台"
        description="文生图 / 参考图生图 · 每张图自动进图库，API 生成的图也会出现在这里"
        actions={
          stats ? (
            <div className="chip flex items-center gap-2 bg-card px-2.5 py-1 font-mono text-[11px]">
              <ImagesIcon className="h-3.5 w-3.5" />
              共 {stats.count} 张 · 今日 {stats.today} · {formatBytes(stats.bytes)}
            </div>
          ) : null
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(340px,420px)_minmax(0,1fr)]">
        {/* ---------------- 左：参数 ---------------- */}
        <Card className="h-fit xl:sticky xl:top-6">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Wand2 className="h-4 w-4" />
              描述你想要的画面
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={cn('relative', dragging && 'outline-dashed outline-2 outline-offset-4 outline-[hsl(var(--primary))]')}
            >
              <Textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onPaste={onPaste}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                    event.preventDefault();
                    void generate();
                  }
                }}
                rows={5}
                maxLength={4000}
                placeholder="例如：一只戴着飞行员墨镜的柴犬坐在复古摩托车上，黄昏的海边公路，胶片质感"
                className="resize-y text-[13.5px] leading-relaxed"
              />
              <div className="mt-1 flex justify-between font-mono text-[10.5px] text-muted-foreground">
                <span>Ctrl/⌘ + Enter 生成 · 可粘贴/拖入参考图</span>
                <span>{prompt.length}/4000</span>
              </div>
            </div>

            <div>
              <div className="mb-1.5 font-mono text-[11px] font-bold uppercase tracking-wide text-muted-foreground">风格</div>
              <div className="flex flex-wrap gap-1.5">
                {STYLES.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => setStyle(entry.id)}
                    className={cn(
                      'chip px-2 py-0.5 text-xs transition',
                      style === entry.id ? 'border-[color:var(--rule)] bg-foreground font-semibold text-background' : 'bg-card hover:bg-muted'
                    )}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-1.5 font-mono text-[11px] font-bold uppercase tracking-wide text-muted-foreground">画幅</div>
              <div className="grid grid-cols-4 gap-1.5">
                {ASPECTS.map((entry) => (
                  <button
                    key={entry.value}
                    type="button"
                    onClick={() => setAspect(entry.value)}
                    className={cn(
                      'chip flex flex-col items-center gap-1 px-1 py-1.5 text-[11px] transition',
                      aspect === entry.value ? 'bg-accent font-semibold text-accent-foreground' : 'bg-card hover:bg-muted'
                    )}
                  >
                    <span
                      className="block rounded-[2px] border-[1.5px] border-current"
                      style={{ width: entry.w, height: entry.h, borderStyle: entry.value === 'auto' ? 'dashed' : 'solid' }}
                    />
                    <span className="font-mono">{entry.label}</span>
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">duck.ai 不接受尺寸参数，画幅会作为提示交给模型，结果可能有偏差。</p>
            </div>

            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
              <div>
                <div className="mb-1.5 font-mono text-[11px] font-bold uppercase tracking-wide text-muted-foreground">模型</div>
                <Select value={model} onValueChange={setModel}>
                  <SelectTrigger>
                    <SelectValue placeholder="选择模型" />
                  </SelectTrigger>
                  <SelectContent>
                    {imageModels.map((entry) => (
                      <SelectItem key={entry.id} value={entry.id} disabled={entry.available === false}>
                        {entry.display_name || entry.name || entry.id}
                        {entry.paid ? ' · 付费' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <div className="mb-1.5 font-mono text-[11px] font-bold uppercase tracking-wide text-muted-foreground">张数</div>
                <div className="flex gap-1">
                  {[1, 2, 3, 4].map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setCount(value)}
                      className={cn(
                        'chip h-9 w-9 font-mono text-sm font-bold transition',
                        count === value ? 'bg-accent text-accent-foreground' : 'bg-card hover:bg-muted'
                      )}
                    >
                      {value}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {selectedModel?.paid ? (
              <p className="text-[11px] text-amber-700 dark:text-amber-300">付费模型需要绑定订阅的身份。</p>
            ) : null}

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="font-mono text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                  参考图 {references.length}/{MAX_REFERENCES}
                </span>
                {references.length ? (
                  <button type="button" className="text-[11px] text-muted-foreground hover:text-foreground" onClick={() => setReferences([])}>
                    清空
                  </button>
                ) : null}
              </div>
              <div className="grid grid-cols-4 gap-2">
                {references.map((src, index) => (
                  <div key={`${index}-${src.length}`} className="tile checker group relative aspect-square overflow-hidden">
                    <img src={src} alt={`参考图 ${index + 1}`} className="h-full w-full object-cover" />
                    <button
                      type="button"
                      aria-label="移除参考图"
                      onClick={() => setReferences((current) => current.filter((_, i) => i !== index))}
                      className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-[2px] border border-border bg-card opacity-0 transition group-hover:opacity-100"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                {references.length < MAX_REFERENCES ? (
                  <button
                    type="button"
                    onClick={() => fileInput.current?.click()}
                    className="field flex aspect-square flex-col items-center justify-center gap-1 border-dashed text-[10.5px] text-muted-foreground transition hover:text-foreground"
                  >
                    <Upload className="h-4 w-4" />
                    上传
                  </button>
                ) : null}
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
              <p className="mt-1 text-[11px] text-muted-foreground">有参考图时会基于它修改或延展；上游会把参考图缩到 512px。</p>
            </div>

            <div className="flex gap-2 pt-1">
              <Button className="h-11 flex-1 text-[15px]" disabled={busy || !prompt.trim()} onClick={() => void generate()}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {busy ? `生成中 ${(elapsed / 1000).toFixed(1)}s` : `生成 ${count} 张`}
              </Button>
              {busy ? (
                <Button variant="outline" className="h-11" onClick={() => abortRef.current?.abort()}>
                  取消
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>

        {/* ---------------- 右：结果 + 图库 ---------------- */}
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <ImagePlus className="h-4 w-4" />
                本次结果
              </CardTitle>
              {result ? (
                <span className="font-mono text-[11px] text-muted-foreground">
                  {result.modelDisplayName || result.model} · {(result.elapsedMs / 1000).toFixed(1)}s
                  {result.identityLabel ? ` · ${result.identityLabel}` : ''}
                </span>
              ) : null}
            </CardHeader>
            <CardContent>
              {busy ? (
                <div className={cn('grid gap-4', count > 1 ? 'sm:grid-cols-2' : '')}>
                  {Array.from({ length: count }).map((_, index) => (
                    <div key={index} className="tile checker flex aspect-square flex-col items-center justify-center gap-2 text-muted-foreground">
                      <Loader2 className="h-6 w-6 animate-spin" />
                      <span className="font-mono text-[11px]">第 {index + 1} 张 · 排队/生成中</span>
                    </div>
                  ))}
                </div>
              ) : result?.images.length ? (
                <div className={cn('grid gap-4', result.images.length > 1 ? 'sm:grid-cols-2' : 'mx-auto max-w-2xl')}>
                  {result.images.map((image, index) => (
                    <ResultTile
                      key={image.id || index}
                      image={{ ...image, prompt: resultPrompt }}
                      onOpen={() =>
                        setLightbox({
                          id: image.id || '',
                          createdAt: image.createdAt || Date.now(),
                          source: 'admin',
                          prompt: resultPrompt,
                          model: result.model,
                          modelDisplayName: result.modelDisplayName,
                          format: image.format,
                          mimeType: image.mimeType || 'image/png',
                          bytes: image.bytes || 0,
                          width: image.width ?? null,
                          height: image.height ?? null,
                          aspect: result.aspect,
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
              ) : (
                <EmptyState icon={Sparkles} title="还没有生成" description="在左边写下提示词，选个风格和画幅，点生成。" />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-col gap-3 space-y-0 pb-3 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <ImagesIcon className="h-4 w-4" />
                图库
              </CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                <form
                  className="relative"
                  onSubmit={(event) => {
                    event.preventDefault();
                    setAppliedQuery(query.trim());
                  }}
                >
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索提示词" className="h-8 w-44 pl-8 text-xs" />
                </form>
                <Button
                  size="sm"
                  variant={favoritesOnly ? 'default' : 'outline'}
                  onClick={() => setFavoritesOnly((value) => !value)}
                >
                  <Heart className={cn('h-3.5 w-3.5', favoritesOnly ? 'fill-current' : '')} />
                  收藏
                </Button>
                <Button size="sm" variant="outline" onClick={() => void loadGallery()} aria-label="刷新">
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" variant="outline" onClick={() => setConfirmClear(true)} disabled={!items.length}>
                  <Trash2 className="h-3.5 w-3.5" />
                  清空
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {stats && !stats.saveGallery ? (
                <p className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                  图库保存已关闭（设置 → images.saveGallery），新生成的图片不会出现在这里。
                </p>
              ) : null}
              {loading ? (
                <div className="flex items-center justify-center py-12 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              ) : items.length ? (
                <>
                  <div className="columns-2 gap-3 sm:columns-3 2xl:columns-4 [&>*]:mb-3 [&>*]:break-inside-avoid">
                    {items.map((item) => (
                      <GalleryThumb
                        key={item.id}
                        item={item}
                        onOpen={() => setLightbox(item)}
                        onToggleFavorite={() => void toggleFavorite(item)}
                      />
                    ))}
                  </div>
                  {hasMore ? (
                    <div className="mt-2 flex justify-center">
                      <Button variant="outline" size="sm" onClick={() => void loadGallery({ append: true })}>
                        加载更多
                      </Button>
                    </div>
                  ) : (
                    <p className="mt-2 text-center font-mono text-[11px] text-muted-foreground">
                      {stats?.lastAt ? `最近一张 ${formatRelative(stats.lastAt)}` : ''}
                      {stats?.retentionDays ? ` · 保留 ${stats.retentionDays} 天` : ' · 永久保留'}
                      {stats?.maxItems ? ` · 最多 ${stats.maxItems} 张（收藏不计）` : ''}
                    </p>
                  )}
                </>
              ) : (
                <EmptyState
                  icon={ImagesIcon}
                  title={appliedQuery || favoritesOnly ? '没有匹配的图片' : '图库是空的'}
                  description={appliedQuery || favoritesOnly ? '换个关键词或取消收藏筛选。' : '在这里或通过 /v1/images/generations 生成的图片都会保存到图库。'}
                />
              )}
            </CardContent>
          </Card>
        </div>
      </div>

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
