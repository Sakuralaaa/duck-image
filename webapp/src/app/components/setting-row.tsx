import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** 设置分组卡片：标题 + 单列行列表，最大宽度约 720px。 */
export function SettingsCard({
  title,
  action,
  children,
  className,
  ...props
}: { title?: string; action?: ReactNode; children: ReactNode } & Omit<HTMLAttributes<HTMLDivElement>, 'title'>) {
  return (
    <section className={cn('w-full max-w-[720px]', className)} {...props}>
      {title || action ? (
        <div className="mb-2 flex items-center justify-between px-1">
          {title ? <h2 className="text-[13px] font-medium text-muted-foreground">{title}</h2> : <span />}
          {action}
        </div>
      ) : null}
      <div className="surface divide-y divide-border px-5">{children}</div>
    </section>
  );
}

/** 紧凑行：左侧中文名称，右侧控件（开关 / 窄输入 / 窄下拉）。 */
export function SettingRow({
  label,
  htmlFor,
  children,
  align = 'center',
  className
}: {
  label: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  align?: 'center' | 'start';
  className?: string;
}) {
  return (
    <div className={cn('flex min-h-[52px] justify-between gap-4 py-2', align === 'start' ? 'items-start py-3' : 'items-center', className)}>
      <label htmlFor={htmlFor} className={cn('text-sm text-foreground', align === 'start' && 'pt-2')}>
        {label}
      </label>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}
