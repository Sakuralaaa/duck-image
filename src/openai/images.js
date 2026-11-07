/**
 * 生图核心 + OpenAI Images API 兼容端点。
 *
 *   POST /v1/images/generations   — JSON：prompt / model / n / size / aspect_ratio / response_format
 *   POST /v1/images/edits         — multipart（OpenAI 官方形态：image / image[] 文件 + prompt）
 *                                    或 JSON（image / images: data URI | {image_url} | [..]）
 *   管理台 POST /admin/api/images/generate 复用 generateImages()。
 *
 * duck.ai 通过同一个 chat 端点的 GenerateImage 工具出图，不接受尺寸参数：
 * size / aspect_ratio 只会转换成一句画幅提示交给模型（尽力而为），参考图会被转成 PNG 并缩到 512px。
 * 每次成功出图默认保存到图库（config.images.saveGallery，可关）。
 *
 * 响应格式：
 *   - b64_json（默认）→ { b64_json, revised_prompt, format, mime_type, id? }
 *   - url → { url: "data:image/<fmt>;base64,..." }（无公网存储，用 data URL）
 */

import { resolveModel, modelSupportsTool, IMAGE_MODEL_ID, IMAGE_MODEL_BACKEND } from './models.js';
import { badRequest, genId, nowSec } from './errors.js';
import { detectImageFormat, normalizeFormat, imageDataUri, imageMimeType } from '../duck/image-format.js';

export const ASPECT_RATIOS = Object.freeze(['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9']);
const MAX_REFERENCE_IMAGES = 4;

function resolveImageModel(config, requestedModel) {
  // 生图默认走固定的 Luna 路由，不受对话默认模型的配置影响。
  const useImageModel = requestedModel === undefined || requestedModel === null || requestedModel === '' || requestedModel === IMAGE_MODEL_ID;
  const imageConfig = useImageModel
    ? { ...config, models: { ...config?.models, aliases: { ...config?.models?.aliases, [IMAGE_MODEL_BACKEND]: IMAGE_MODEL_BACKEND } } }
    : config;
  const resolved = resolveModel(imageConfig, useImageModel ? IMAGE_MODEL_BACKEND : requestedModel);
  if (!modelSupportsTool(resolved.model, 'image_generation')) {
    throw badRequest(`Model "${resolved.id}" does not support image generation`, 'model', 'model_not_supported');
  }
  return { ...resolved, publicId: useImageModel ? IMAGE_MODEL_ID : resolved.id };
}

function normalizeImages(result) {
  const list = Array.isArray(result?.images) ? result.images : [];
  const images = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const b64 =
      typeof raw.b64 === 'string'
        ? raw.b64
        : typeof raw.b64Image === 'string'
          ? raw.b64Image
          : typeof raw.b64_json === 'string'
            ? raw.b64_json
            : '';
    if (!b64) continue;
    // duck.ai 实际返回 JPEG，帧里的 format 可能缺失/错误 —— 用魔数探测真实格式
    const format = detectImageFormat(b64, normalizeFormat(raw.format) || 'png');
    images.push({
      b64,
      format,
      ...(Number.isFinite(raw.width) ? { width: raw.width } : {}),
      ...(Number.isFinite(raw.height) ? { height: raw.height } : {}),
      ...(typeof raw.modelDisplayName === 'string' && raw.modelDisplayName
        ? { modelDisplayName: raw.modelDisplayName }
        : typeof result?.modelDisplayName === 'string' && result.modelDisplayName
          ? { modelDisplayName: result.modelDisplayName }
          : {})
    });
  }
  return images;
}

/** "1792x1024" → "16:9"（近似到常用画幅）；"auto"/方图 → null。 */
export function sizeToAspect(size) {
  const match = /^(\d{2,5})x(\d{2,5})$/.exec(String(size || ''));
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!width || !height || width === height) return null;
  const ratio = width / height;
  let best = null;
  let bestDiff = Infinity;
  for (const candidate of ASPECT_RATIOS) {
    const [a, b] = candidate.split(':').map(Number);
    const diff = Math.abs(a / b - ratio);
    if (diff < bestDiff) {
      best = candidate;
      bestDiff = diff;
    }
  }
  return best;
}

function normalizeAspect(value) {
  if (value === undefined || value === null || value === '' || value === 'auto') return null;
  const text = String(value).trim();
  if (!ASPECT_RATIOS.includes(text)) {
    throw badRequest(`"aspect_ratio" must be one of ${ASPECT_RATIOS.join(', ')} or "auto"`, 'aspect_ratio', 'invalid_aspect_ratio');
  }
  return text === '1:1' ? '1:1' : text;
}

/**
 * 参考图归一化：接受 data URI、{ b64, mimeType }、{ image_url: { url } }、{ url }、multipart 文件对象。
 * 只接受 data/base64（网关不替客户端去拉外部 URL，避免 SSRF）。
 */
export function normalizeReferenceImages(input) {
  const list = Array.isArray(input) ? input : input === undefined || input === null ? [] : [input];
  const images = [];
  for (const raw of list) {
    let dataUrl = '';
    let b64 = '';
    let mimeType = '';
    if (typeof raw === 'string') {
      dataUrl = raw.trim();
    } else if (raw && typeof raw === 'object') {
      if (typeof raw.b64 === 'string') {
        b64 = raw.b64;
        mimeType = typeof raw.mimeType === 'string' ? raw.mimeType : '';
      } else if (typeof raw.b64_json === 'string') {
        b64 = raw.b64_json;
      } else if (typeof raw.image_url === 'string') {
        dataUrl = raw.image_url;
      } else if (raw.image_url && typeof raw.image_url.url === 'string') {
        dataUrl = raw.image_url.url;
      } else if (typeof raw.url === 'string') {
        dataUrl = raw.url;
      }
    }
    if (dataUrl) {
      const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s.exec(dataUrl);
      if (!match) {
        throw badRequest('Reference images must be base64 data URLs or uploaded files (remote URLs are not fetched)', 'image', 'invalid_image');
      }
      mimeType = match[1];
      b64 = match[2];
    }
    if (!b64) throw badRequest('Reference image is empty or malformed', 'image', 'invalid_image');
    const format = detectImageFormat(b64, normalizeFormat(mimeType) || 'png');
    images.push({ b64, format, mimeType: imageMimeType(format) });
    if (images.length > MAX_REFERENCE_IMAGES) {
      throw badRequest(`At most ${MAX_REFERENCE_IMAGES} reference images are supported`, 'image', 'too_many_images');
    }
  }
  return images;
}

/**
 * 生图核心：校验 → 选身份 → 逐张调用上游 → （可选）存图库。
 * 部分成功时返回已生成的图片并带 `partialError`，不丢已出的图。
 *
 * @param {Record<string, any>} ctx
 * @param {{ prompt: string, model?: string, n?: number, aspect?: string|null, referenceImages?: any[], source?: string, keyLabel?: string|null, save?: boolean }} options
 */
export async function generateImages(ctx, options = {}) {
  if (ctx.config?.tools?.imageGeneration === false) {
    throw badRequest('image_generation is disabled in server configuration', 'tools', 'tool_disabled');
  }
  const prompt = typeof options.prompt === 'string' ? options.prompt.trim() : '';
  if (!prompt) throw badRequest('"prompt" is required and must be a non-empty string', 'prompt', 'prompt_required');
  if (prompt.length > 32000) throw badRequest('"prompt" is too long (max 32000 characters)', 'prompt');
  const n = options.n === undefined || options.n === null ? 1 : Number(options.n);
  if (!Number.isInteger(n) || n < 1 || n > 4) {
    throw badRequest('"n" must be an integer between 1 and 4', 'n', 'invalid_n');
  }
  const resolved = resolveImageModel(ctx.config, options.model);
  ctx.log.model = resolved.id;
  const aspect = options.aspect || null;
  const referenceImages = Array.isArray(options.referenceImages) ? options.referenceImages : [];

  const params = { prompt, model: resolved.id, signal: ctx.signal };
  if (aspect && aspect !== '1:1') params.aspect = aspect;
  if (referenceImages.length) params.images = referenceImages;

  if (typeof ctx.selectIdentity === 'function') {
    const paidModel =
      ctx.config?.duck?.allowPaidModels === true && (resolved.paid === true || resolved.model?.paid === true);
    await ctx.selectIdentity({ paidModel });
  }

  const images = [];
  let partialError = null;
  for (let index = 0; index < n; index += 1) {
    try {
      const result = await ctx.callUpstream(
        (runtime) => (runtime?.client || ctx.duck).imageGeneration(params),
        { model: resolved.id, ...(options.source === 'admin' ? { source: 'admin-test' } : {}) }
      );
      images.push(...normalizeImages(result).slice(0, 1));
    } catch (error) {
      // 第一张就失败：照常抛错；后续失败：保留已生成的图
      if (!images.length) throw error;
      partialError = error;
      break;
    }
  }
  if (images.length === 0) {
    throw badRequest('Upstream returned no image', 'prompt', 'no_image_returned');
  }

  let saved = [];
  const gallery = ctx.gallery;
  if (options.save !== false && gallery && gallery.enabled) {
    try {
      saved = gallery.save(images, {
        source: options.source || 'api',
        prompt,
        model: resolved.id,
        aspect,
        keyLabel: options.keyLabel || null,
        identityId: ctx.identityRoute?.identityId || null,
        referenceCount: referenceImages.length
      });
    } catch (error) {
      ctx.logger?.warn?.('[gallery] save failed', { error: error.message });
      saved = [];
    }
  }
  return { images, saved, resolved, prompt, aspect, partialError };
}

function keyLabelFor(ctx) {
  try {
    const header = ctx.req?.headers?.authorization;
    const token =
      typeof header === 'string' && /^Bearer\s+/i.test(header)
        ? header.replace(/^Bearer\s+/i, '').trim()
        : String(ctx.req?.headers?.['x-api-key'] || '').trim();
    if (!token) return null;
    const item = ctx.store?.findManagedKey?.(token);
    return item?.label || (item ? item.preview || null : 'config key');
  } catch {
    return null;
  }
}

function sendImagesResponse(ctx, outcome, responseFormat) {
  const { images, saved, resolved, prompt } = outcome;
  const data = images.map((image, index) => {
    const format = detectImageFormat(image.b64, normalizeFormat(image.format) || 'png');
    const id = saved[index]?.id;
    if (responseFormat === 'url') {
      return { url: imageDataUri(image.b64, format), ...(id ? { id } : {}) };
    }
    return {
      b64_json: image.b64,
      // OpenAI 的 Images API 会带 revised_prompt（模型改写后的提示词）；这里回显原始 prompt。
      revised_prompt: prompt,
      format,
      mime_type: imageMimeType(format),
      ...(id ? { id } : {})
    };
  });
  ctx.json(200, {
    created: nowSec(),
    data,
    // Extensions useful for dashboards / debugging; ignored by OpenAI clients.
    model: resolved.publicId,
    ...(images[0]?.modelDisplayName ? { model_display_name: images[0].modelDisplayName } : {}),
    ...(outcome.aspect ? { aspect_ratio: outcome.aspect } : {}),
    ...(outcome.partialError ? { partial: true, partial_error: String(outcome.partialError.message || outcome.partialError) } : {}),
    response_id: genId('img_')
  });
}

function readCommonOptions(body) {
  const responseFormat =
    body.response_format === undefined || body.response_format === null ? 'b64_json' : String(body.response_format);
  if (responseFormat !== 'b64_json' && responseFormat !== 'url') {
    throw badRequest('"response_format" must be "b64_json" or "url"', 'response_format', 'invalid_response_format');
  }
  let aspect = normalizeAspect(body.aspect_ratio ?? body.aspectRatio);
  if (body.size !== undefined && body.size !== null && body.size !== '') {
    const size = String(body.size);
    if (size !== 'auto' && !/^\d{2,5}x\d{2,5}$/.test(size)) {
      throw badRequest('"size" must look like "1024x1024" or "auto"', 'size', 'invalid_size');
    }
    if (!aspect) aspect = sizeToAspect(size);
  }
  let n = body.n;
  if (typeof n === 'string' && n.trim()) n = Number(n);
  return { responseFormat, aspect, n };
}

function requireObjectBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest('Request body must be a JSON object');
  return body;
}

/** POST /v1/images/generations */
export async function handleImagesGenerations(req, res, ctx) {
  ctx.log.endpoint = 'POST /v1/images/generations';
  const body = requireObjectBody(ctx.body);
  if (ctx.config?.tools?.imageGeneration === false) {
    throw badRequest('image_generation is disabled in server configuration', 'tools', 'tool_disabled');
  }
  if (typeof body.prompt !== 'string' || !body.prompt.trim()) {
    throw badRequest('"prompt" is required and must be a non-empty string', 'prompt', 'prompt_required');
  }
  const { responseFormat, aspect, n } = readCommonOptions(body);
  const outcome = await generateImages(ctx, {
    prompt: body.prompt,
    model: body.model,
    n,
    aspect,
    source: 'api',
    keyLabel: keyLabelFor(ctx)
  });
  sendImagesResponse(ctx, outcome, responseFormat);
}

/** POST /v1/images/edits（参考图 + 提示词） */
export async function handleImagesEdits(req, res, ctx) {
  ctx.log.endpoint = 'POST /v1/images/edits';
  const body = requireObjectBody(ctx.body);
  if (typeof body.prompt !== 'string' || !body.prompt.trim()) {
    throw badRequest('"prompt" is required and must be a non-empty string', 'prompt', 'prompt_required');
  }
  const rawImages = body.image ?? body.images;
  const referenceImages = normalizeReferenceImages(rawImages);
  if (!referenceImages.length) throw badRequest('"image" is required for /v1/images/edits', 'image', 'image_required');
  const { responseFormat, aspect, n } = readCommonOptions(body);
  const outcome = await generateImages(ctx, {
    prompt: body.prompt,
    model: body.model,
    n,
    aspect,
    referenceImages,
    source: 'api-edit',
    keyLabel: keyLabelFor(ctx)
  });
  sendImagesResponse(ctx, outcome, responseFormat);
}
