import { useEffect, useState, type ReactNode } from 'react';
import { Menu } from 'lucide-react';
import type { Route } from '@/app/lib/hash-route';
import { useOverview } from '@/app/lib/overview-context';
import { Button } from '@/components/ui/button';
import { Brand } from './brand';
import { Sidebar } from './sidebar';

export function ConsoleLayout({
  route,
  onLogout,
  children
}: {
  route: Route;
  onLogout: () => void;
  children: ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { data } = useOverview();

  useEffect(() => {
    setMobileOpen(false);
  }, [route]);

  const upstream = data?.upstream;
  const dotClass = !data
    ? 'bg-muted-foreground animate-pulse'
    : upstream?.rateLimited || (!upstream?.ok && upstream?.challengeOk)
      ? 'bg-amber-500'
      : upstream?.ok
        ? 'bg-emerald-500'
        : 'bg-destructive';

  return (
    <div className="flex min-h-screen">
      <Sidebar
        route={route}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
        onLogout={onLogout}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-background/90 px-4 py-2.5 backdrop-blur lg:hidden">
          <Button variant="ghost" size="icon" aria-label="打开菜单" onClick={() => setMobileOpen(true)}>
            <Menu className="h-4 w-4" />
          </Button>
          <Brand compact />
          <div className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className={`h-2 w-2 rounded-full ${dotClass}`} aria-hidden="true" />
            {upstream?.rateLimited ? '限流' : upstream?.ok ? '在线' : data ? '异常' : '连接中'}
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1080px] flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
