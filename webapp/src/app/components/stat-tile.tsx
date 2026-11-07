import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export function StatTile({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'default',
  title
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: LucideIcon;
  tone?: 'default' | 'primary' | 'danger' | 'success' | 'warning';
  title?: string;
}) {
  const toneClass =
    tone === 'primary'
      ? 'border-t-[3px] border-t-[color:hsl(var(--brand))]'
      : tone === 'danger'
        ? 'border-t-[3px] border-t-red-600'
        : tone === 'success'
          ? 'border-t-[3px] border-t-emerald-600'
          : tone === 'warning'
            ? 'border-t-[3px] border-t-amber-500'
            : 'border-t-[3px] border-t-[color:var(--rule)]';
  return (
    <div className={cn('tile bg-card p-4', toneClass)} title={title}>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">{label}</span>
        {Icon ? <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : null}
      </div>
      <div className="slant mt-1.5 truncate text-2xl font-semibold tabular-nums sm:text-[28px]" title={value}>
        {value}
      </div>
      {hint ? (
        <div className="mt-1 truncate text-[11px] text-muted-foreground" title={hint}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}
