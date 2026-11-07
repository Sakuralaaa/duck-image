/**
 * 生图图库（SQLite 元数据 + data/images/ 下的图片文件）。
 *
 * 所有经网关生成的图片（/v1/images/generations、/v1/images/edits、管理台生图工作台）
 * 都可以落到这里，管理台「生图」页按时间倒序浏览、下载、删除、再次生成。
 *
 * - 元数据表 `images`：id / created_at / source / prompt / model / format / bytes / width / height / ...
 * - 图片文件：`<dataDir>/images/<id>.<ext>`，不把大 blob 塞进 SQLite。
 * - 保留策略：`config.images.retentionDays`（0 = 永久）+ `config.images.maxItems` 上限，定期 prune。
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { openDatabase } from './db.js';
import { detectImageFormat, normalizeFormat, imageMimeType } from './duck/image-format.js';

const ID_RE = /^img_[a-f0-9]{24}$/;
const EXT = { png: 'png', jpeg: 'jpg', jpg: 'jpg', webp: 'webp', gif: 'gif' };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS images (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  source TEXT NOT NULL,
  prompt TEXT NOT NULL,
  model TEXT,
  model_display_name TEXT,
  format TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  aspect TEXT,
  batch_id TEXT,
  key_label TEXT,
  identity_id TEXT,
  reference_count INTEGER NOT NULL DEFAULT 0,
  favorite INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_images_created ON images(created_at DESC);
`;

function readDimensions(buffer, format) {
  try {
    if (format === 'png' && buffer.length >= 24 && buffer.readUInt32BE(12) === 0x49484452) {
      return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    }
    if (format === 'jpeg' || format === 'jpg') {
      let offset = 2;
      while (offset + 9 < buffer.length) {
        if (buffer[offset] !== 0xff) {
          offset += 1;
          continue;
        }
        const marker = buffer[offset + 1];
        const length = buffer.readUInt16BE(offset + 2);
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
        }
        offset += 2 + length;
      }
    }
    if (format === 'webp' && buffer.length >= 30 && buffer.toString('ascii', 12, 16) === 'VP8X') {
      return { width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) };
    }
  } catch {
    // ignore malformed headers
  }
  return { width: null, height: null };
}

function rowToItem(row) {
  if (!row) return null;
  return {
    id: row.id,
    createdAt: row.created_at,
    source: row.source,
    prompt: row.prompt,
    model: row.model || null,
    modelDisplayName: row.model_display_name || null,
    format: row.format,
    mimeType: imageMimeType(row.format),
    bytes: row.bytes,
    width: row.width ?? null,
    height: row.height ?? null,
    aspect: row.aspect || null,
    batchId: row.batch_id || null,
    keyLabel: row.key_label || null,
    identityId: row.identity_id || null,
    referenceCount: row.reference_count || 0,
    favorite: row.favorite === 1
  };
}

/**
 * @param {{ dataDir: string, config?: Record<string, any>, logger?: any }} options
 */
export async function createGalleryStore({ dataDir, config = {}, logger = null } = {}) {
  if (!dataDir) throw new Error('createGalleryStore: dataDir is required');
  const handle = await openDatabase({ dataDir, logger });
  const { db } = handle;
  db.exec(SCHEMA);
  const dir = path.join(dataDir, 'images');
  fs.mkdirSync(dir, { recursive: true });

  const settings = () => {
    const source = config?.images && typeof config.images === 'object' ? config.images : {};
    return {
      saveGallery: source.saveGallery !== false,
      retentionDays: Number.isFinite(Number(source.retentionDays)) ? Math.max(0, Number(source.retentionDays)) : 0,
      maxItems: Number.isFinite(Number(source.maxItems)) ? Math.max(0, Math.trunc(Number(source.maxItems))) : 2000
    };
  };

  function fileFor(id, format) {
    return path.join(dir, `${id}.${EXT[format] || 'png'}`);
  }

  function removeFile(id, format) {
    try {
      fs.rmSync(fileFor(id, format), { force: true });
    } catch {
      // ignore
    }
  }

  const store = {
    dir,
    get enabled() {
      return settings().saveGallery;
    },

    /**
     * 保存一批图片。返回保存后的条目（含 id）。
     * @param {Array<{ b64: string, format?: string, width?: number, height?: number, modelDisplayName?: string }>} images
     * @param {{ source: string, prompt: string, model?: string, aspect?: string, keyLabel?: string, identityId?: string, referenceCount?: number }} meta
     */
    save(images, meta = {}) {
      const list = Array.isArray(images) ? images : [];
      const batchId = `batch_${crypto.randomBytes(8).toString('hex')}`;
      const saved = [];
      const insert = db.prepare(
        `INSERT INTO images (id, created_at, source, prompt, model, model_display_name, format, bytes, width, height, aspect, batch_id, key_label, identity_id, reference_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const image of list) {
        if (!image || typeof image.b64 !== 'string' || !image.b64) continue;
        const buffer = Buffer.from(image.b64, 'base64');
        if (!buffer.length) continue;
        const format = detectImageFormat(image.b64, normalizeFormat(image.format) || 'png');
        const dims = readDimensions(buffer, format);
        const id = `img_${crypto.randomBytes(12).toString('hex')}`;
        const createdAt = Date.now();
        fs.writeFileSync(fileFor(id, format), buffer, { mode: 0o600 });
        insert.run(
          id,
          createdAt,
          String(meta.source || 'api').slice(0, 32),
          String(meta.prompt || '').slice(0, 32000),
          meta.model ? String(meta.model) : null,
          image.modelDisplayName ? String(image.modelDisplayName) : null,
          format,
          buffer.length,
          Number.isFinite(image.width) ? image.width : dims.width,
          Number.isFinite(image.height) ? image.height : dims.height,
          meta.aspect ? String(meta.aspect).slice(0, 16) : null,
          batchId,
          meta.keyLabel ? String(meta.keyLabel).slice(0, 120) : null,
          meta.identityId ? String(meta.identityId) : null,
          Number.isFinite(meta.referenceCount) ? meta.referenceCount : 0
        );
        saved.push(store.get(id));
      }
      try {
        store.prune();
      } catch (error) {
        logger?.warn?.('[gallery] prune failed', { error: error.message });
      }
      return saved.filter(Boolean);
    },

    get(id) {
      if (!ID_RE.test(String(id || ''))) return null;
      return rowToItem(db.prepare('SELECT * FROM images WHERE id = ?').get(id));
    },

    /** 读取图片字节；不存在返回 null。 */
    read(id) {
      const item = store.get(id);
      if (!item) return null;
      try {
        return { item, buffer: fs.readFileSync(fileFor(item.id, item.format)) };
      } catch {
        return null;
      }
    },

    /**
     * @param {{ limit?: number, before?: number, q?: string, source?: string, favorite?: boolean }} [options]
     */
    list(options = {}) {
      const limit = Math.min(200, Math.max(1, Math.trunc(Number(options.limit) || 48)));
      const where = [];
      const args = [];
      if (Number.isFinite(Number(options.before)) && Number(options.before) > 0) {
        where.push('created_at < ?');
        args.push(Number(options.before));
      }
      if (typeof options.q === 'string' && options.q.trim()) {
        where.push("prompt LIKE ? ESCAPE '\\'");
        args.push(`%${options.q.trim().replace(/[%_]/g, (m) => `\\${m}`)}%`);
      }
      if (typeof options.source === 'string' && options.source) {
        where.push('source = ?');
        args.push(options.source);
      }
      if (options.favorite === true) where.push('favorite = 1');
      const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const sql = `SELECT * FROM images ${clause} ORDER BY created_at DESC LIMIT ?`;
      const rows = db.prepare(sql).all(...args, limit + 1);
      const items = rows.slice(0, limit).map(rowToItem);
      return { items, hasMore: rows.length > limit, nextBefore: items.length ? items[items.length - 1].createdAt : null };
    },

    stats() {
      const row = db.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(bytes), 0) AS bytes, MAX(created_at) AS last FROM images').get();
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayRow = db.prepare('SELECT COUNT(*) AS count FROM images WHERE created_at >= ?').get(today.getTime());
      return {
        count: Number(row?.count || 0),
        bytes: Number(row?.bytes || 0),
        lastAt: row?.last ? Number(row.last) : null,
        today: Number(todayRow?.count || 0),
        ...settings()
      };
    },

    setFavorite(id, favorite) {
      const item = store.get(id);
      if (!item) return null;
      db.prepare('UPDATE images SET favorite = ? WHERE id = ?').run(favorite ? 1 : 0, id);
      return store.get(id);
    },

    remove(id) {
      const item = store.get(id);
      if (!item) return false;
      db.prepare('DELETE FROM images WHERE id = ?').run(id);
      removeFile(item.id, item.format);
      return true;
    },

    /** 清空（保留收藏可选）。 */
    clear({ keepFavorites = true } = {}) {
      const rows = db
        .prepare(keepFavorites ? 'SELECT id, format FROM images WHERE favorite = 0' : 'SELECT id, format FROM images')
        .all();
      db.prepare(keepFavorites ? 'DELETE FROM images WHERE favorite = 0' : 'DELETE FROM images').run();
      for (const row of rows) removeFile(row.id, row.format);
      return rows.length;
    },

    /** 按保留天数与最大数量清理（收藏不受影响）。 */
    prune() {
      const { retentionDays, maxItems } = settings();
      const doomed = [];
      if (retentionDays > 0) {
        const cutoff = Date.now() - retentionDays * 24 * 3600 * 1000;
        doomed.push(...db.prepare('SELECT id, format FROM images WHERE favorite = 0 AND created_at < ?').all(cutoff));
      }
      if (maxItems > 0) {
        doomed.push(
          ...db
            .prepare('SELECT id, format FROM images WHERE favorite = 0 ORDER BY created_at DESC LIMIT -1 OFFSET ?')
            .all(maxItems)
        );
      }
      const seen = new Set();
      const del = db.prepare('DELETE FROM images WHERE id = ?');
      for (const row of doomed) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        del.run(row.id);
        removeFile(row.id, row.format);
      }
      return seen.size;
    }
  };
  return store;
}

export default { createGalleryStore };
