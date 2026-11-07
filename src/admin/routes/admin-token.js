/** POST /admin/api/admin-token — 修改管理面板密码（adminToken）。 */
import { isPlaceholderAdminToken } from '../../config.js';
import { timingSafeEqualString } from '../../store.js';
import { requireMethod } from './helpers.js';

const MIN_LENGTH = 8;
const MAX_LENGTH = 200;

function invalid(message, param) {
  return Object.assign(new Error(message), { status: 400, type: 'invalid_request_error', code: 'invalid_admin_token', param });
}

export async function handleAdminToken(ctx, { env = process.env } = {}) {
  requireMethod(ctx, ['POST']);
  if (env.DUCKAI_CPA_ADMIN_TOKEN) {
    throw Object.assign(new Error('面板密码由环境变量 DUCKAI_CPA_ADMIN_TOKEN 指定，请修改环境变量后重启'), {
      status: 409,
      type: 'invalid_request_error',
      code: 'admin_token_env_locked'
    });
  }
  const body = ctx.body && typeof ctx.body === 'object' && !Array.isArray(ctx.body) ? ctx.body : {};
  const current = typeof body.current === 'string' ? body.current : '';
  const next = typeof body.next === 'string' ? body.next.trim() : '';
  if (!timingSafeEqualString(ctx.config.auth?.adminToken || '', current)) throw invalid('当前密码不正确', 'current');
  if (next.length < MIN_LENGTH || next.length > MAX_LENGTH) throw invalid(`新密码长度需为 ${MIN_LENGTH}-${MAX_LENGTH} 位`, 'next');
  if (/\s/.test(next)) throw invalid('新密码不能包含空白字符', 'next');
  if (isPlaceholderAdminToken(next)) throw invalid('新密码过于简单', 'next');
  if (next === current) throw invalid('新密码不能与当前密码相同', 'next');
  ctx.config.auth.adminToken = next;
  await ctx.store.saveConfig(ctx.config);
  ctx.logger?.info?.('管理面板密码已修改');
  ctx.json(200, { ok: true });
}

export default { handleAdminToken };
