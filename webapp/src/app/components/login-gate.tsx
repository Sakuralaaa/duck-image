import { useState } from 'react';
import { Eye, EyeOff, Loader2, LogIn } from 'lucide-react';
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
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm rounded-2xl border bg-card p-7 shadow-lg">
        <div className="flex items-center gap-2.5">
          <BrandMark />
          <div className="text-base font-semibold tracking-tight">Duck Image</div>
        </div>

        <form className="mt-5 space-y-4" onSubmit={(event) => void submit(event)}>
          <div className="space-y-1.5">
            <Label htmlFor="login-token" className="sr-only">管理口令</Label>
            <div className="flex gap-2">
              <Input
                id="login-token"
                type={reveal ? 'text' : 'password'}
                value={token}
                autoFocus
                autoComplete="current-password"
                spellCheck={false}
                placeholder="管理口令"
                onChange={(event) => setToken(event.target.value)}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={reveal ? '隐藏 token' : '显示 token'}
                onClick={() => setReveal((value) => !value)}
              >
                {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
          </div>

          {error || localError ? (
            <p role="alert" className="text-sm font-medium text-destructive">
              {localError ?? error}
            </p>
          ) : null}

          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
            {busy ? '验证中…' : '登录'}
          </Button>
        </form>

      </div>
    </div>
  );
}
