/**
 * v2.44：图片上下文（JPEG → PNG 归一化 / 生成图回放）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

import { withServer, v1Request, collectSSE } from './helpers/test-server.js';
import { MockDuckClient } from './helpers/mock-duck.js';
import { toUpstreamPngDataUrl } from '../src/duck/image-convert.js';

function makeJpeg(width, height) {
  const data = Buffer.alloc(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    data[index * 4] = 200;
    data[index * 4 + 1] = 60;
    data[index * 4 + 2] = 40;
    data[index * 4 + 3] = 255;
  }
  return jpeg.encode({ width, height, data }, 80).data;
}

function decodePng(dataUrl) {
  const b64 = String(dataUrl).split(',')[1] || '';
  return PNG.sync.read(Buffer.from(b64, 'base64'));
}

test('image-convert：JPEG 600×300 → PNG 且缩到 ≤512', () => {
  const jpegBuffer = makeJpeg(600, 300);
  const converted = toUpstreamPngDataUrl({ b64: jpegBuffer.toString('base64') }, { maxDimension: 512 });
  assert.ok(converted);
  assert.equal(converted.mimeType, 'image/png');
  assert.ok(converted.dataUrl.startsWith('data:image/png;base64,'));
  const png = decodePng(converted.dataUrl);
  assert.equal(png.width, 512);
  assert.equal(png.height, 256);
});

test('image-convert：小 PNG 原样可解码；未知格式返回 null', () => {
  const png = new PNG({ width: 2, height: 2 });
  png.data = Buffer.from([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]);
  const encoded = PNG.sync.write(png).toString('base64');
  const converted = toUpstreamPngDataUrl({ b64: encoded });
  assert.ok(converted);
  assert.equal(decodePng(converted.dataUrl).width, 2);
  assert.equal(toUpstreamPngDataUrl({ b64: Buffer.from('GIF89a').toString('base64') }), null);
});

test('chat JPEG 图片输入：转发上游前转成 PNG（避免 400）', async () => {
  const duck = new MockDuckClient();
  const jpegB64 = makeJpeg(600, 300).toString('base64');
  await withServer({ duck }, async ({ baseUrl }) => {
    const res = await v1Request(baseUrl, '/v1/chat/completions', {
      method: 'POST',
      body: {
        model: 'gpt-6-luna',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: '这张图是什么颜色？' },
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${jpegB64}` } }
            ]
          }
        ]
      }
    });
    assert.equal(res.status, 200, res.text);
    const messages = duck.calls.chat[0].params.messages;
    const user = messages.find((message) => message.role === 'user');
    assert.ok(user.images?.length === 1);
    // 转换发生在 DuckClient 上传前（buildUpstreamMessages）
    const { buildUpstreamMessages } = await import('../src/duck/index.js');
    const upstream = buildUpstreamMessages(messages);
    const imagePart = upstream
      .flatMap((message) => (Array.isArray(message.content) ? message.content : []))
      .find((part) => part.type === 'image');
    assert.ok(imagePart);
    assert.equal(imagePart.mimeType, 'image/png');
    assert.ok(imagePart.image.startsWith('data:image/png;base64,'));
    const png = decodePng(imagePart.image);
    assert.ok(Math.max(png.width, png.height) <= 512);
  });
});

test('chat 续聊中上传图片：非流式和流式均真正转成上游 image part', async () => {
  for (const stream of [false, true]) {
    const duck = new MockDuckClient();
    duck.enqueueChat({ textDeltas: ['第一轮回答'] });
    duck.enqueueChat({ textDeltas: ['图片回答'] });
    const jpegB64 = makeJpeg(12, 8).toString('base64');
    await withServer({ duck }, async ({ baseUrl }) => {
      const headers = { 'x-session-id': `image-follow-up-${stream}` };
      const first = await v1Request(baseUrl, '/v1/chat/completions', {
        method: 'POST', headers, body: { model: 'gpt-6-luna', messages: [{ role: 'user', content: '你好' }] }
      });
      assert.equal(first.status, 200, first.text);
      const body = {
        model: 'gpt-6-luna', stream,
        messages: [
          { role: 'user', content: '你好' },
          { role: 'assistant', content: first.json.choices[0].message.content },
          { role: 'user', content: [
            { type: 'text', text: '这是什么图片？' },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${jpegB64}` } }
          ] }
        ]
      };
      const second = stream
        ? (await collectSSE(baseUrl, '/v1/chat/completions', { headers, body })).response
        : await v1Request(baseUrl, '/v1/chat/completions', { method: 'POST', headers, body });
      assert.equal(second.status, 200);
      const { buildUpstreamMessages } = await import('../src/duck/index.js');
      const upstream = buildUpstreamMessages(duck.calls.chat.at(-1).params.messages);
      const imagePart = upstream.at(-1).content.find((part) => part.type === 'image');
      assert.ok(imagePart, '上游必须收到真实图片，而不是原始 image_url 包装');
      assert.equal(decodePng(imagePart.image).width, 12);
    });
  }
});

test('chat 仅发送图片也可识别；不支持的远程图片不能静默丢弃', async () => {
  const duck = new MockDuckClient();
  const jpegB64 = makeJpeg(12, 8).toString('base64');
  await withServer({ duck }, async ({ baseUrl }) => {
    const imageOnly = await v1Request(baseUrl, '/v1/chat/completions', {
      method: 'POST', body: { model: 'gpt-6-luna', messages: [{ role: 'user', content: [
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${jpegB64}` } }
      ] }] }
    });
    assert.equal(imageOnly.status, 200, imageOnly.text);
    assert.equal(duck.calls.chat[0].params.messages.at(-1).images.length, 1);
    const remote = await v1Request(baseUrl, '/v1/chat/completions', {
      method: 'POST', body: { model: 'gpt-6-luna', messages: [{ role: 'user', content: [
        { type: 'text', text: '看图' }, { type: 'image_url', image_url: { url: 'https://example.com/image.png' } }
      ] }] }
    });
    assert.equal(remote.status, 400);
    assert.equal(remote.json.error.code, 'invalid_image');
  });
});

test('Responses 直接传入文本与图片 part 时保留二者', async () => {
  const duck = new MockDuckClient();
  const jpegB64 = makeJpeg(12, 8).toString('base64');
  await withServer({ duck }, async ({ baseUrl }) => {
    const res = await v1Request(baseUrl, '/v1/responses', {
      method: 'POST', body: { model: 'gpt-6-luna', input: [
        { type: 'input_text', text: '这是什么图片？' },
        { type: 'input_image', image_url: `data:image/jpeg;base64,${jpegB64}` }
      ] }
    });
    assert.equal(res.status, 200, res.text);
    const user = duck.calls.chat[0].params.messages.find((message) => message.role === 'user');
    assert.match(user.content, /这是什么图片/);
    const { buildUpstreamMessages } = await import('../src/duck/index.js');
    const upstream = buildUpstreamMessages(duck.calls.chat[0].params.messages);
    const imagePart = upstream.at(-1).content.find((part) => part.type === 'image');
    assert.ok(imagePart);
    assert.equal(decodePng(imagePart.image).width, 12);
  });
});

test('Responses 续聊上传图片：previous_response_id 下保留真实 image part', async () => {
  const duck = new MockDuckClient();
  duck.enqueueChat({ textDeltas: ['第一轮回答'] });
  duck.enqueueChat({ textDeltas: ['图片回答'] });
  const jpegB64 = makeJpeg(12, 8).toString('base64');
  await withServer({ duck }, async ({ baseUrl }) => {
    const headers = { 'x-session-id': 'responses-image-follow-up' };
    const first = await v1Request(baseUrl, '/v1/responses', {
      method: 'POST', headers, body: { model: 'gpt-6-luna', input: '你好' }
    });
    assert.equal(first.status, 200, first.text);
    const second = await v1Request(baseUrl, '/v1/responses', {
      method: 'POST', headers, body: { model: 'gpt-6-luna', previous_response_id: first.json.id, input: [
        { role: 'user', content: [
          { type: 'input_text', text: '看看图片' },
          { type: 'input_image', image_url: `data:image/jpeg;base64,${jpegB64}` }
        ] }
      ] }
    });
    assert.equal(second.status, 200, second.text);
    const { buildUpstreamMessages } = await import('../src/duck/index.js');
    const upstream = buildUpstreamMessages(duck.calls.chat.at(-1).params.messages);
    const imagePart = upstream.at(-1).content.find((part) => part.type === 'image');
    assert.ok(imagePart);
    assert.equal(decodePng(imagePart.image).width, 12);
  });
});

test('responses 生成图回放（JPEG）→ 上游 image part 为 PNG', async () => {
  const duck = new MockDuckClient();
  const jpegB64 = makeJpeg(600, 300).toString('base64');
  await withServer({ duck }, async ({ baseUrl }) => {
    const res = await v1Request(baseUrl, '/v1/responses', {
      method: 'POST',
      body: {
        model: 'gpt-6-luna',
        input: [
          { role: 'user', content: '画一张图' },
          { type: 'image_generation_call', id: 'ig_1', status: 'completed', output_format: 'jpeg', result: jpegB64 },
          { role: 'user', content: '把这张图改成水彩风格，并描述颜色。' }
        ]
      }
    });
    assert.equal(res.status, 200, res.text);
    const messages = duck.calls.chat[0].params.messages;
    const user = messages.find((message) => Array.isArray(message.images) && message.images.length);
    assert.ok(user, '应保留图片');
    const { buildUpstreamMessages } = await import('../src/duck/index.js');
    const upstream = buildUpstreamMessages(messages);
    const imagePart = upstream
      .flatMap((message) => (Array.isArray(message.content) ? message.content : []))
      .find((part) => part.type === 'image');
    assert.ok(imagePart);
    assert.equal(imagePart.mimeType, 'image/png');
    const png = decodePng(imagePart.image);
    assert.ok(Math.max(png.width, png.height) <= 512);
  });
});
