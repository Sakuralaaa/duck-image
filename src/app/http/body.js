/** HTTP body parsing (Phase 1 split from src/http/server.js; behavior unchanged). */
import { badRequest, payloadTooLarge } from '../../openai/errors.js';

export const MAX_BODY_BYTES = 4 * 1024 * 1024;
/** multipart（图片上传）放宽到 16 MB。 */
export const MAX_MULTIPART_BYTES = 16 * 1024 * 1024;

export async function readJsonBody(req) {
  const isMultipart = /^multipart\/form-data/i.test(String(req.headers?.['content-type'] || ''));
  const limit = isMultipart ? MAX_MULTIPART_BYTES : MAX_BODY_BYTES;
  const contentLength = Number(req.headers?.['content-length']);
  if (Number.isFinite(contentLength) && contentLength > limit) {
    throw payloadTooLarge();
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limit) throw payloadTooLarge();
    chunks.push(chunk);
  }
  if (total === 0) return {};
  const contentType = String(req.headers?.['content-type'] || '');
  if (/^multipart\/form-data/i.test(contentType)) {
    return parseMultipart(Buffer.concat(chunks), contentType);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (error) {
    throw badRequest(`Invalid JSON body: ${error.message}`, null, 'invalid_json');
  }
}

/**
 * 最小 multipart/form-data 解析（OpenAI /v1/images/edits 等端点用）。
 * 文本字段 → 字符串；文件字段 → { filename, mimeType, b64 }；同名字段（含 `image[]`）合并为数组。
 */
export function parseMultipart(buffer, contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!match) throw badRequest('multipart body is missing a boundary', null, 'invalid_multipart');
  const boundary = Buffer.from(`--${(match[1] || match[2]).trim()}`);
  const result = {};
  const add = (name, value) => {
    const key = name.endsWith('[]') ? name.slice(0, -2) : name;
    if (key in result) {
      result[key] = Array.isArray(result[key]) ? [...result[key], value] : [result[key], value];
    } else {
      result[key] = name.endsWith('[]') ? [value] : value;
    }
  };
  let start = buffer.indexOf(boundary);
  while (start !== -1) {
    const partStart = start + boundary.length;
    if (buffer.slice(partStart, partStart + 2).toString() === '--') break;
    const next = buffer.indexOf(boundary, partStart);
    if (next === -1) break;
    // 去掉前导 CRLF 与尾随 CRLF
    const part = buffer.slice(partStart + 2, next - 2);
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd !== -1) {
      const headerText = part.slice(0, headerEnd).toString('utf8');
      const body = part.slice(headerEnd + 4);
      const disposition = /content-disposition:[^\r\n]*/i.exec(headerText)?.[0] || '';
      const name = /\bname="([^"]*)"/i.exec(disposition)?.[1];
      const filename = /\bfilename="([^"]*)"/i.exec(disposition)?.[1];
      const mimeType = /content-type:\s*([^\r\n;]+)/i.exec(headerText)?.[1]?.trim();
      if (name) {
        if (filename !== undefined) {
          add(name, { filename, mimeType: mimeType || 'application/octet-stream', b64: body.toString('base64') });
        } else {
          add(name, body.toString('utf8'));
        }
      }
    }
    start = next;
  }
  return result;
}

export default { MAX_BODY_BYTES, readJsonBody, parseMultipart };
