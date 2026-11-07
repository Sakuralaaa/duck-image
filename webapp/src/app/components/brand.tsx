import { cn } from '@/lib/utils';

/** DuckAI CPA 品牌标识（Atoll 风格：紫底粗边硬阴影，纯内联 SVG）。 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 52 52" className={cn('h-9 w-9', className)} fill="none" aria-hidden="true">
      <rect x="5" y="5" width="45" height="45" rx="5" fill="var(--edge)" />
      <rect x="1.5" y="1.5" width="45" height="45" rx="5" fill="#a78bfa" stroke="var(--edge)" strokeWidth="3" />
      <path
        d="M13 27c0-7 5-12 12-12h7v6l-4 2v3h4c0 7-5 11-11 11h-1v-6h-4l-3 6h-4l2-6h-3v-4h5z"
        fill="#fffdf8"
        stroke="var(--edge)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx="27" cy="20" r="1.9" fill="var(--edge)" />
    </svg>
  );
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <BrandMark />
      {compact ? null : (
        <div className="leading-tight">
          <div className="slant text-[15px] font-extrabold">DuckAI CPA</div>
          <div className="font-mono text-[10.5px] text-muted-foreground">gateway · console</div>
        </div>
      )}
    </div>
  );
}
