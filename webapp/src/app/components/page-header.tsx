import type { ReactNode } from 'react';
import { QueueStatusChips } from './queue-status-chips';

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  showQueue?: boolean;
  eyebrow?: string;
}

export function PageHeader({ title, description, actions, showQueue = true, eyebrow }: PageHeaderProps) {
  return (
    <div className="rule-bottom mb-6 flex flex-col gap-3 pb-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        <div className="eyebrow mb-1.5">Duck Image · {eyebrow ?? 'Console'}</div>
        <h1 className="slant text-[30px] font-bold leading-[1.12] sm:text-[38px]">{title}</h1>
        {description ? <p className="mt-2 max-w-2xl text-[15px] text-muted-foreground">{description}</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {showQueue ? <QueueStatusChips /> : null}
        {actions}
      </div>
    </div>
  );
}
