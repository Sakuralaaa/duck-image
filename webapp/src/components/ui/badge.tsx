import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-[2px] border border-[color:hsl(var(--input))] px-2 py-0.5 text-[11px] font-semibold tracking-[0.04em] transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'bg-secondary text-secondary-foreground',
        destructive: 'bg-destructive text-destructive-foreground',
        outline: 'text-foreground',
        success: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
        warning: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
        info: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
        muted: 'bg-muted text-muted-foreground',
        accent: 'border-transparent bg-accent text-accent-foreground'
      }
    },
    defaultVariants: { variant: 'default' }
  }
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
