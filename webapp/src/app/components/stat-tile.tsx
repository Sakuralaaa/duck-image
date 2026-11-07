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
      ? 'bg-[color-mix(in_srgb,hsl(var(--primary))_22%,hsl(var(--card)))]'
      : tone === 'danger'
        ? 'bg-[color-mix(in_srgb,#f87171_22%,hsl(var(--card)))]'
        : tone === 'success'
          ? 'bg-[color-mix(in_srgb,#34d399_20%,hsl(var(--card)))]'
          : tone === 'warning'
            ? 'bg-[color-mix(in_srgb,#fbbf24_24%,hsl(var(--card)))]'
            : 'bg-card';
  return (
    <div className={cn('tile p-4', toneClass)} title={title}>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-mono text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
        {Icon ? <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : null}
      </div>
      <div className="mt-1.5 truncate text-xl font-bold italic tabular-nums tracking-tight sm:text-2xl" title={value}>
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
