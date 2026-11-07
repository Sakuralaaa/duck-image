/**
 * 管理台「生图工作台」API（admin token 鉴权由上层完成）。
 *
 *   POST   /admin/api/images/generate        { prompt, model?, n?, aspect?, references?: dataURL[] }
 *   GET    /admin/api/images                 ?limit&before&q&source&favorite=1   → { items, hasMore, nextBefore, stats }
 *   DELETE /admin/api/images                 ?keepFavorites=0|1                  → 清空图库
 *   GET    /admin/api/images/stats
 *   GET    /admin/api/images/:id             → 元数据
 *   PATCH  /admin/api/images/:id             { favorite }
 *   DELETE /admin/api/images/:id
 *   GET    /admin/api/images/:id/file        → 图片二进制（?download=1 附件下载）
 */

import { badRequest, notFound, toOpenAIError } from '../../openai/errors.js';
import { generateImages, normalizeReferenceImages, ASPECT_RATIOS } from '../../openai/images.js';
import { imageDataUri, imageMimeType } from '../../duck/image-format.js';
import { methodNotAllowed, requireMethod } from './helpers.js';

function requireGallery(ctx) {
  if (!ctx.gallery) {
    const error = new Error('图库不可用（SQLite 未就绪）');
    error.status = 503;
    error.code = 'gallery_unavailable';
    throw error;
  }
  return ctx.gallery;
}

function bodyObject(ctx) {
  return ctx.body && typeof ctx.body === 'object' && !Array.isArray(ctx.body) ? ctx.body : {};
}

async function handleGenerate(ctx) {
  requireMethod(ctx, ['POST']);
  const body = bodyObject(ctx);
  const aspectRaw = body.aspect ?? body.aspect_ratio ?? null;
  const aspect = aspectRaw && aspectRaw !== 'auto' ? String(aspectRaw) : null;
  if (aspect && !ASPECT_RATIOS.includes(aspect)) {
    throw badRequest(`aspect 必须是 ${ASPECT_RATIOS.join(' / ')} 之一`, 'aspect', 'invalid_aspect_ratio');
  }
  const referenceImages = normalizeReferenceImages(body.references ?? body.images ?? []);
  const startedAt = Date.now();
  try {
    const outcome = await generateImages(ctx, {
      prompt: body.prompt,
      model: body.model,
      n: body.n,
      aspect,
      referenceImages,
      source: 'admin',
      keyLabel: '管理台'
    });
    try {
      ctx.recordUpstream?.({ endpoint: 'POST /admin/api/images/generate', model: outcome.resolved.id, status: 200, stream: false });
    } catch {
      // logging is best-effort
    }
    const images = outcome.images.map((image, index) => {
      const saved = outcome.saved[index] || null;
      return {
        ...(saved || {}),
        format: image.format,
        mimeType: imageMimeType(image.format),
        dataUrl: imageDataUri(image.b64, image.format),
        saved: Boolean(saved)
      };
    });
    ctx.json(200, {
      ok: true,
      model: outcome.resolved.publicId,
      modelDisplayName: outcome.images[0]?.modelDisplayName || null,
      aspect: outcome.aspect,
      elapsedMs: Date.now() - startedAt,
      identityId: ctx.identityRoute?.identityId || null,
      identityLabel: ctx.identityRoute?.label || null,
      images,
      ...(outcome.partialError ? { partialError: toOpenAIError(outcome.partialError).message } : {})
    });
  } catch (error) {
    try {
      const normalized = toOpenAIError(error);
      ctx.recordUpstream?.({
        endpoint: 'POST /admin/api/images/generate',
        status: normalized.status || 500,
        stream: false,
        error: normalized.message
      });
    } catch {
      // ignore
    }
    throw error;
  }
}

function handleList(ctx) {
  const gallery = requireGallery(ctx);
  if (ctx.method === 'DELETE') {
    const keepFavorites = ctx.query.get('keepFavorites') !== '0';
    const removed = gallery.clear({ keepFavorites });
    ctx.json(200, { ok: true, removed });
    return;
  }
  if (ctx.method !== 'GET' && ctx.method !== 'HEAD') throw methodNotAllowed(ctx, 'GET, DELETE');
  const result = gallery.list({
    limit: ctx.query.get('limit'),
    before: ctx.query.get('before'),
    q: ctx.query.get('q') || '',
    source: ctx.query.get('source') || '',
    favorite: ctx.query.get('favorite') === '1'
  });
  ctx.json(200, { ...result, stats: gallery.stats() });
}

function handleItem(ctx, id, action) {
  const gallery = requireGallery(ctx);
  if (action === 'file') {
    requireMethod(ctx, ['GET', 'HEAD']);
    const found = gallery.read(id);
    if (!found) throw notFound('图片不存在或已被清理');
    const ext = found.item.format === 'jpeg' ? 'jpg' : found.item.format;
    const headers = {
      'Cache-Control': 'private, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff'
    };
    if (ctx.query.get('download') === '1') headers['Content-Disposition'] = `attachment; filename="${found.item.id}.${ext}"`;
    ctx.text(200, found.buffer, found.item.mimeType, headers);
    return;
  }
  if (action) throw notFound(`Unknown admin endpoint: ${ctx.method} /images/${id}/${action}`);
  if (ctx.method === 'GET' || ctx.method === 'HEAD') {
    const item = gallery.get(id);
    if (!item) throw notFound('图片不存在或已被清理');
    ctx.json(200, item);
    return;
  }
  if (ctx.method === 'PATCH') {
    const body = bodyObject(ctx);
    const item = gallery.setFavorite(id, body.favorite === true);
    if (!item) throw notFound('图片不存在或已被清理');
    ctx.json(200, item);
    return;
  }
  if (ctx.method === 'DELETE') {
    if (!gallery.remove(id)) throw notFound('图片不存在或已被清理');
    ctx.json(200, { ok: true });
    return;
  }
  throw methodNotAllowed(ctx, 'GET, PATCH, DELETE');
}

export async function handleImages(ctx, parts) {
  const sub = parts[1] || '';
  if (!sub) return handleList(ctx);
  if (sub === 'generate' && parts.length === 2) return handleGenerate(ctx);
  if (sub === 'stats' && parts.length === 2) {
    requireMethod(ctx, ['GET', 'HEAD']);
    ctx.json(200, requireGallery(ctx).stats());
    return;
  }
  if (sub === 'meta' && parts.length === 2) {
    requireMethod(ctx, ['GET', 'HEAD']);
    ctx.json(200, { aspects: ASPECT_RATIOS, maxReferences: 4, maxN: 4, gallery: Boolean(ctx.gallery) });
    return;
  }
  if (parts.length <= 3) return handleItem(ctx, sub, parts[2] || '');
  throw notFound(`Unknown admin endpoint: ${ctx.method} /images/${parts.slice(1).join('/')}`);
}

export default { handleImages };
