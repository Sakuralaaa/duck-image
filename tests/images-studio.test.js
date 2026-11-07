/**
 * 生图工作台：/v1/images/edits（JSON + multipart）、画幅提示、图库保存、管理台 /admin/api/images/*。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { withServer, makeConfig, v1Request, adminRequest, request, apiHeaders } from './helpers/test-server.js';
import { MockDuckClient, PNG_1X1_B64 } from './helpers/mock-duck.js';
import { DuckError } from '../src/duck/index.js';
import { sizeToAspect } from '../src/openai/images.js';

const PNG_DATA_URL = `data:image/png;base64,${PNG_1X1_B64}`;

test('sizeToAspect：常见尺寸近似到画幅，方图/auto 不加提示', () => {
  assert.equal(sizeToAspect('1792x1024'), '16:9');
  assert.equal(sizeToAspect('1024x1792'), '9:16');
  assert.equal(sizeToAspect('1024x1024'), null);
  assert.equal(sizeToAspect('auto'), null);
});

test('/v1/images/generations：size 转成 aspect 透传给上游，图片自动进图库并带 id', async () => {
  const duck = new MockDuckClient();
  await withServer({ duck, config: makeConfig({}) }, async ({ baseUrl, gallery }) => {
    const res = await v1Request(baseUrl, '/v1/images/generations', {
      method: 'POST',
      body: { prompt: '海边的灯塔', size: '1792x1024' }
    });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.aspect_ratio, '16:9');
    assert.equal(duck.calls.imageGeneration[0].params.prompt, '海边的灯塔');
    assert.equal(duck.calls.imageGeneration[0].params.aspect, '16:9');
    assert.match(res.json.data[0].id, /^img_[a-f0-9]{24}$/);
    const listed = gallery.list();
    assert.equal(listed.items.length, 1);
    assert.equal(listed.items[0].prompt, '海边的灯塔');
    assert.equal(listed.items[0].source, 'api');
    assert.equal(listed.items[0].aspect, '16:9');
  });
});

test('/v1/images/edits：JSON data URL 参考图透传为 images，拒绝远程 URL', async () => {
  const duck = new MockDuckClient();
  await withServer({ duck, config: makeConfig({}) }, async ({ baseUrl }) => {
    const ok = await v1Request(baseUrl, '/v1/images/edits', {
      method: 'POST',
      body: { model: 'image2.5', prompt: '把背景换成星空', image: PNG_DATA_URL }
    });
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.json.model, 'image2.5');
    const params = duck.calls.imageGeneration[0].params;
    assert.equal(params.model, 'gpt-6-luna');
    assert.equal(params.images.length, 1);
    assert.equal(params.images[0].format, 'png');

    const remote = await v1Request(baseUrl, '/v1/images/edits', {
      method: 'POST',
      body: { prompt: 'x', image: 'https://example.com/a.png' }
    });
    assert.equal(remote.status, 400);
    assert.equal(remote.json.error.code, 'invalid_image');

    const missing = await v1Request(baseUrl, '/v1/images/edits', { method: 'POST', body: { prompt: 'x' } });
    assert.equal(missing.status, 400);
    assert.equal(missing.json.error.code, 'image_required');
  });
});

test('/v1/images/edits：OpenAI 官方 multipart 形态（image[] 文件 + prompt + n）', async () => {
  const duck = new MockDuckClient();
  await withServer({ duck, config: makeConfig({}) }, async ({ baseUrl }) => {
    const form = new FormData();
    form.append('prompt', '加一顶帽子');
    form.append('n', '2');
    form.append('image[]', new Blob([Buffer.from(PNG_1X1_B64, 'base64')], { type: 'image/png' }), 'a.png');
    const response = await fetch(`${baseUrl}/v1/images/edits`, { method: 'POST', headers: apiHeaders({}), body: form });
    const json = await response.json();
    assert.equal(response.status, 200, JSON.stringify(json));
    assert.equal(json.data.length, 2);
    assert.equal(duck.calls.imageGeneration.length, 2);
    assert.equal(duck.calls.imageGeneration[0].params.prompt, '加一顶帽子');
    assert.equal(duck.calls.imageGeneration[0].params.images.length, 1);
  });
});

test('n=3 第二张失败：返回已生成的图片并标记 partial', async () => {
  const duck = new MockDuckClient();
  let calls = 0;
  const original = duck.imageGeneration.bind(duck);
  duck.imageGeneration = async (params) => {
    calls += 1;
    if (calls === 2) throw new DuckError('rate limited', { status: 429, type: 'rate_limit_exceeded', retriable: true });
    return original(params);
  };
  await withServer({ duck, config: makeConfig({}) }, async ({ baseUrl }) => {
    const res = await v1Request(baseUrl, '/v1/images/generations', { method: 'POST', body: { prompt: '三只猫', n: 3 } });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.data.length, 1);
    assert.equal(res.json.partial, true);
  });
});

test('管理台：生成 → 列表 → 取文件 → 收藏 → 删除 → 清空', async () => {
  const duck = new MockDuckClient();
  await withServer({ duck, config: makeConfig({}) }, async ({ baseUrl }) => {
    const unauth = await request(baseUrl, '/admin/api/images');
    assert.equal(unauth.status, 401);

    const gen = await adminRequest(baseUrl, '/admin/api/images/generate', {
      method: 'POST',
      body: { prompt: '赛博朋克风的鸭子', n: 2, aspect: '3:4', references: [PNG_DATA_URL] }
    });
    assert.equal(gen.status, 200, gen.text);
    assert.equal(gen.json.model, 'image2.5');
    assert.equal(duck.calls.imageGeneration[0].params.model, 'gpt-6-luna');
    assert.equal(gen.json.images.length, 2);
    assert.ok(gen.json.images[0].dataUrl.startsWith('data:image/png;base64,'));
    assert.equal(gen.json.images[0].saved, true);
    assert.equal(duck.calls.imageGeneration[0].params.aspect, '3:4');
    assert.equal(duck.calls.imageGeneration[0].params.images.length, 1);

    const bad = await adminRequest(baseUrl, '/admin/api/images/generate', {
      method: 'POST',
      body: { prompt: 'x', aspect: '5:1' }
    });
    assert.equal(bad.status, 400);

    const list = await adminRequest(baseUrl, '/admin/api/images?limit=1');
    assert.equal(list.status, 200);
    assert.equal(list.json.items.length, 1);
    assert.equal(list.json.hasMore, true);
    assert.equal(list.json.stats.count, 2);
    const id = list.json.items[0].id;
    assert.equal(list.json.items[0].source, 'admin');
    assert.equal(list.json.items[0].referenceCount, 1);

    const search = await adminRequest(baseUrl, `/admin/api/images?q=${encodeURIComponent('赛博')}`);
    assert.equal(search.json.items.length, 2);
    const none = await adminRequest(baseUrl, `/admin/api/images?q=${encodeURIComponent('100%')}`);
    assert.equal(none.json.items.length, 0);

    const file = await adminRequest(baseUrl, `/admin/api/images/${id}/file`);
    assert.equal(file.status, 200);
    assert.equal(file.headers.get('content-type'), 'image/png');

    const fav = await adminRequest(baseUrl, `/admin/api/images/${id}`, { method: 'PATCH', body: { favorite: true } });
    assert.equal(fav.json.favorite, true);

    const cleared = await adminRequest(baseUrl, '/admin/api/images', { method: 'DELETE' });
    assert.equal(cleared.json.removed, 1, 'favorites survive clear');

    const del = await adminRequest(baseUrl, `/admin/api/images/${id}`, { method: 'DELETE' });
    assert.equal(del.status, 200);
    const gone = await adminRequest(baseUrl, `/admin/api/images/${id}/file`);
    assert.equal(gone.status, 404);
    const traversal = await adminRequest(baseUrl, '/admin/api/images/..%2F..%2Fconfig/file');
    assert.equal(traversal.status, 404);
  });
});

test('images.saveGallery=false：照常出图但不入库', async () => {
  const duck = new MockDuckClient();
  await withServer({ duck, config: makeConfig({ images: { saveGallery: false } }) }, async ({ baseUrl, gallery }) => {
    const res = await v1Request(baseUrl, '/v1/images/generations', { method: 'POST', body: { prompt: '一朵花' } });
    assert.equal(res.status, 200);
    assert.equal(res.json.data[0].id, undefined);
    assert.equal(gallery.list().items.length, 0);
  });
});
