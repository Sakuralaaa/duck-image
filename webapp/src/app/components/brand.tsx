import { cn } from '@/lib/utils';

/** Duck Image 品牌标识：圆角方块 + 鸭橙点缀。 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn('inline-grid h-8 w-8 place-items-center rounded-[10px] bg-brand text-white shadow-soft', className)}
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="currentColor">
        <path d="M9.5 4.5a4.5 4.5 0 0 1 4.47 4h2.78a1.25 1.25 0 0 1 0 2.5h-2.07a7 7 0 0 1 4.32 6.47V18a1.5 1.5 0 0 1-1.5 1.5H8A5 5 0 0 1 6.2 9.83 4.5 4.5 0 0 1 9.5 4.5Zm0 2.4a.95.95 0 1 0 0 1.9.95.95 0 0 0 0-1.9Z" />
      </svg>
    </span>
  );
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <BrandMark />
      {compact ? null : <div className="text-[15px] font-semibold tracking-tight">Duck Image</div>}
    </div>
  );
}
