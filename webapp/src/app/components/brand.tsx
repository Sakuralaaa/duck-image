import { cn } from '@/lib/utils';

/** DuckAI CPA 品牌标识（杂志风：墨色方块 + 衬线字母）。 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-grid h-9 w-9 place-items-center bg-foreground text-background',
        className
      )}
      aria-hidden="true"
    >
      <span className="slant text-[19px] font-bold leading-none">D</span>
    </span>
  );
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <BrandMark />
      {compact ? null : (
        <div className="leading-tight">
          <div className="slant text-[19px] font-bold">DuckAI CPA</div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Gateway · Console</div>
        </div>
      )}
    </div>
  );
}
