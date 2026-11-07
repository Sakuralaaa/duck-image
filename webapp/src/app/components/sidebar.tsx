import {
  ChevronDown,
  Code2,
  CreditCard,
  ImagePlus,
  Images,
  KeyRound,
  LayoutDashboard,
  LogOut,
  MessagesSquare,
  Monitor,
  Moon,
  ScrollText,
  Settings,
  SlidersHorizontal,
  Sun,
  Users,
  X
} from 'lucide-react';
import { useState } from 'react';
import type { Route } from '@/app/lib/hash-route';
import { useOverview } from '@/app/lib/overview-context';
import { useTheme, type ThemeMode } from '@/app/lib/theme';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Brand } from './brand';

type NavItem = { route: Route; label: string; icon: typeof LayoutDashboard };

/** 主导航：生图 / 对话 / 图库；账号（原「身份池」+「默认身份」，旧地址 #/identities、#/identity 自动跳转）等。 */
const PRIMARY: NavItem[] = [
  { route: 'images', label: 'Duck Image', icon: ImagePlus },
  { route: 'chat', label: 'Duck Chat', icon: MessagesSquare },
  { route: 'gallery', label: '图库', icon: Images }
];
const SECONDARY: NavItem[] = [
  { route: 'accounts', label: '账号', icon: Users },
  { route: 'keys', label: 'API Key', icon: KeyRound },
  { route: 'settings', label: '设置', icon: Settings }
];
const MORE: NavItem[] = [
  { route: 'overview', label: '概览', icon: LayoutDashboard },
  { route: 'subscriptions', label: '订阅', icon: CreditCard },
  { route: 'logs', label: '日志', icon: ScrollText },
  { route: 'model-config', label: '模型配置', icon: SlidersHorizontal },
  { route: 'examples', label: '调用示例', icon: Code2 }
];

const NAV_ITEMS: NavItem[] = [...PRIMARY, ...SECONDARY, ...MORE];

const THEME_CYCLE: ThemeMode[] = ['light', 'dark', 'system'];
const THEME_META: Record<ThemeMode, { label: string; icon: typeof Sun }> = {
  light: { label: '浅色', icon: Sun },
  dark: { label: '深色', icon: Moon },
  system: { label: '跟随系统', icon: Monitor }
};

function connectionState(data: ReturnType<typeof useOverview>['data'], error: string | null) {
  if (error) return { dot: 'bg-destructive', label: '连接失败' };
  if (!data) return { dot: 'bg-muted-foreground/50 animate-pulse', label: '连接中…' };
  const upstream = data.upstream;
  if (upstream?.rateLimited) return { dot: 'bg-amber-500', label: '上游限流' };
  if (upstream?.ok) return { dot: 'bg-emerald-500', label: '运行正常' };
  if (upstream?.challengeOk) return { dot: 'bg-amber-500', label: '部分可用' };
  return { dot: 'bg-destructive', label: '上游异常' };
}

function NavLink({ item, active, onClick }: { item: NavItem; active: boolean; onClick: () => void }) {
  const Icon = item.icon;
  return (
    <a
      href={`#/${item.route}`}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] transition-colors duration-150',
        active ? 'bg-secondary font-medium text-foreground' : 'text-muted-foreground hover:bg-secondary/70 hover:text-foreground'
      )}
    >
      <Icon className={cn('h-4 w-4', active ? 'text-foreground' : 'text-muted-foreground')} />
      {item.label}
    </a>
  );
}

export function Sidebar({
  route,
  mobileOpen,
  onCloseMobile,
  onLogout
}: {
  route: Route;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  onLogout: () => void;
}) {
  const { data, error } = useOverview();
  const [moreOpen, setMoreOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const status = connectionState(data, error);
  const ThemeIcon = THEME_META[theme]?.icon ?? Monitor;
  const showMore = moreOpen || MORE.some((item) => item.route === route);

  return (
    <>
      {mobileOpen ? (
        <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px] lg:hidden" aria-hidden="true" onClick={onCloseMobile} />
      ) : null}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-56 flex-col border-r border-border bg-[hsl(var(--side))] transition-transform duration-200 lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex h-16 items-center justify-between px-4">
          <a href="#/images" className="rounded-lg" onClick={onCloseMobile}>
            <Brand />
          </a>
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label="关闭菜单" onClick={onCloseMobile}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 pb-3 scrollbar-thin" aria-label="主导航">
          <div className="space-y-0.5">
            {PRIMARY.map((item) => (
              <NavLink key={item.route} item={item} active={route === item.route} onClick={onCloseMobile} />
            ))}
          </div>
          <div className="mx-2.5 my-3 h-px bg-border" />
          <div className="space-y-0.5">
            {SECONDARY.map((item) => (
              <NavLink key={item.route} item={item} active={route === item.route} onClick={onCloseMobile} />
            ))}
          </div>
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setMoreOpen((value) => !value)}
              aria-expanded={showMore}
              className="flex h-8 w-full items-center gap-1 rounded-lg px-2.5 text-[12.5px] text-muted-foreground/80 transition-colors hover:text-foreground"
            >
              更多
              <ChevronDown className={cn('h-3.5 w-3.5 transition-transform duration-200', showMore && 'rotate-180')} />
            </button>
            {showMore ? (
              <div className="mt-0.5 space-y-0.5">
                {MORE.map((item) => (
                  <NavLink key={item.route} item={item} active={route === item.route} onClick={onCloseMobile} />
                ))}
              </div>
            ) : null}
          </div>
        </nav>

        <div className="flex h-14 items-center gap-1 border-t border-border px-4">
          <Tooltip>
            <TooltipTrigger asChild>
              <a href="#/overview" className="flex h-8 items-center gap-2 rounded-lg pr-2" aria-label={status.label}>
                <span className={cn('h-2 w-2 rounded-full', status.dot)} />
                <span className="text-[11px] text-muted-foreground/70 tnum">v{data?.service?.version ?? '—'}</span>
              </a>
            </TooltipTrigger>
            <TooltipContent side="top">{status.label}</TooltipContent>
          </Tooltip>
          <div className="ml-auto flex items-center">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  aria-label={`主题：${THEME_META[theme]?.label}`}
                  onClick={() => setTheme(THEME_CYCLE[(THEME_CYCLE.indexOf(theme) + 1) % THEME_CYCLE.length])}
                >
                  <ThemeIcon className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">主题：{THEME_META[theme]?.label}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="退出登录" onClick={onLogout}>
                  <LogOut className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">退出登录</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </aside>
    </>
  );
}

export { NAV_ITEMS };
