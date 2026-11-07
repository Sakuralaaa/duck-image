import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { BrandMark } from './brand';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function LoginGate({
  onLogin,
  busy,
  error
}: {
  onLogin: (token: string) => Promise<void>;
  busy: boolean;
  error: string | null;
}) {
  const [token, setToken] = useState('');
  const [reveal, setReveal] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    const message = localError ?? error;
    if (message) toast.error(message);
  }, [error, localError]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = token.trim();
    if (!value) {
      setLocalError('请输入 admin token');
      return;
    }
    setLocalError(null);
    await onLogin(value);
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 pb-24">
      <div className="mb-8 flex flex-col items-center gap-3">
        <BrandMark className="h-11 w-11 rounded-[14px]" />
        <div className="text-[20px] font-semibold tracking-tight">Duck Image</div>
      </div>
      <form className="surface w-full max-w-[360px] space-y-3 p-6" onSubmit={(event) => void submit(event)}>
        <Label htmlFor="login-token" className="sr-only">管理口令</Label>
        <div className="relative">
          <Input
            id="login-token"
            type={reveal ? 'text' : 'password'}
            value={token}
            autoFocus
            autoComplete="current-password"
            spellCheck={false}
            placeholder="管理口令"
            onChange={(event) => setToken(event.target.value)}
            className="h-10 pr-10"
          />
          <button
            type="button"
            aria-label={reveal ? '隐藏 token' : '显示 token'}
            onClick={() => setReveal((value) => !value)}
            className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
          >
            {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        <Button type="submit" className="h-10 w-full" disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {busy ? '验证中…' : '登录'}
        </Button>
      </form>
    </div>
  );
}
