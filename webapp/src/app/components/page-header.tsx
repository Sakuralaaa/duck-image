import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  /** 保留参数以兼容旧调用；v0.5 起不再显示说明文字。 */
  description?: string;
  /** 唯一保留的一行灰字说明（仅账号页使用）。 */
  note?: string;
  actions?: ReactNode;
  showQueue?: boolean;
  eyebrow?: string;
}

export function PageHeader({ title, note, actions }: PageHeaderProps) {
  return (
    <div className="mb-6 flex min-h-9 flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-baseline gap-3">
        <h1 className="text-[20px] font-semibold leading-7 tracking-tight">{title}</h1>
        {note ? <span className="truncate text-[13px] text-muted-foreground">{note}</span> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
