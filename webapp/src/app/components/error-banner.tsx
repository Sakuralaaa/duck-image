import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

/**
 * v0.5：错误不再内嵌横幅，统一用 toast 弹出；组件本身不渲染内容。
 * （保留 onRetry 参数：toast 上提供「重试」按钮。）
 */
export function ErrorBanner({
  message,
  onRetry,
  actionLabel = '重试'
}: {
  message: string;
  onRetry?: () => void;
  actionLabel?: string;
}) {
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (!message || last.current === message) return;
    last.current = message;
    toast.error(message, onRetry ? { action: { label: actionLabel, onClick: onRetry } } : undefined);
  }, [message, onRetry, actionLabel]);
  return null;
}
