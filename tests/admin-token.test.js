/** POST /admin/api/admin-token：修改面板密码。 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { withServer, request, adminRequest, ADMIN_TOKEN } from './helpers/test-server.js';

test('POST /admin/api/admin-token：校验当前密码，修改后旧密码失效、新密码可用', async () => {
  const saved = process.env.DUCKAI_CPA_ADMIN_TOKEN;
  delete process.env.DUCKAI_CPA_ADMIN_TOKEN;
  try {
    await withServer({}, async ({ baseUrl }) => {
      const wrong = await adminRequest(baseUrl, '/admin/api/admin-token', {
        method: 'POST',
        body: { current: 'not-the-token', next: 'brand-new-token-123' }
      });
      assert.equal(wrong.status, 400);

      const short = await adminRequest(baseUrl, '/admin/api/admin-token', {
        method: 'POST',
        body: { current: ADMIN_TOKEN, next: 'short' }
      });
      assert.equal(short.status, 400);

      const ok = await adminRequest(baseUrl, '/admin/api/admin-token', {
        method: 'POST',
        body: { current: ADMIN_TOKEN, next: 'brand-new-token-123' }
      });
      assert.equal(ok.status, 200);

      const oldToken = await adminRequest(baseUrl, '/admin/api/overview');
      assert.equal(oldToken.status, 401);

      const newToken = await request(baseUrl, '/admin/api/overview', {
        headers: { authorization: 'Bearer brand-new-token-123' }
      });
      assert.equal(newToken.status, 200);
    });
  } finally {
    if (saved !== undefined) process.env.DUCKAI_CPA_ADMIN_TOKEN = saved;
  }
});
