import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { apiPost, ApiError } from '@/app/lib/api';
import { storeToken } from '@/app/lib/token';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SettingRow, SettingsCard } from './setting-row';

/** 设置页「面板密码」：校验当前密码后改为新密码，并更新本地保存的登录凭据。 */
export function AdminTokenSection() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!current || !next) {
      toast.error('请填写当前密码和新密码');
      return;
    }
    if (next.trim().length < 8) {
      toast.error('新密码至少 8 位');
      return;
    }
    if (next !== confirm) {
      toast.error('两次输入的新密码不一致');
      return;
    }
    setSaving(true);
    try {
      await apiPost<{ ok: boolean }>('/admin-token', { current, next: next.trim() });
      storeToken(next.trim());
      setCurrent('');
      setNext('');
      setConfirm('');
      toast.success('面板密码已修改');
    } catch (error) {
      if (!(error as ApiError)?.handled) toast.error((error as Error)?.message || '修改失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsCard title="面板密码" data-testid="settings-admin-token">
      <SettingRow label="当前密码" htmlFor="admin-token-current">
        <Input id="admin-token-current" type="password" autoComplete="current-password" value={current} onChange={(event) => setCurrent(event.target.value)} className="h-9 w-64" />
      </SettingRow>
      <SettingRow label="新密码" htmlFor="admin-token-next">
        <Input id="admin-token-next" type="password" autoComplete="new-password" placeholder="至少 8 位" value={next} onChange={(event) => setNext(event.target.value)} className="h-9 w-64" />
      </SettingRow>
      <SettingRow label="确认新密码" htmlFor="admin-token-confirm">
        <div className="flex items-center gap-2">
          <Input
            id="admin-token-confirm"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void submit();
            }}
            className="h-9 w-64"
          />
          <Button size="sm" onClick={() => void submit()} disabled={saving}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            修改
          </Button>
        </div>
      </SettingRow>
    </SettingsCard>
  );
}
