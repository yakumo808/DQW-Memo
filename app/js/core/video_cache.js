// @ts-check

const DB_NAME = 'DQW-Memo';
const STORE_NAME = 'videoCache';
const DB_VERSION = 1;
export const MAX_CACHE_ENTRIES = 20;
export const MAX_CACHE_BYTES = 1024 * 1024;

function cacheError(phase, error) {
  const result = new Error(`${phase}: ${toErrorMessage(error)}`);
  result.name = 'VideoCacheError';
  return result;
}

function normalizeRecord(record) {
  if (!(record.blob instanceof Blob)) throw new Error('record has no Blob');
  const size = record.blob.size; // Never trust old or incorrect size metadata.
  if (!Number.isSafeInteger(size) || size < 0) throw new Error('invalid Blob size');
  const date = value => Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
  const createdAt = date(record.createdAt) || new Date(0).toISOString();
  return { ...record, size, createdAt, lastAccessedAt: date(record.lastAccessedAt) || createdAt };
}

// Keep enumeration, eviction and put atomic, including across tabs/instances.
function transaction(db, mode, work) {
  return new Promise((resolve, reject) => {
    const ctx = { phase: 'TRANSACTION', result: null, error: null };
    let tx;
    const fail = error => {
      ctx.error = cacheError(ctx.phase, error);
      if (tx) { try { tx.abort(); } catch (_) { reject(ctx.error); } }
      else reject(ctx.error);
    };
    try {
      tx = db.transaction(STORE_NAME, mode);
      tx.oncomplete = () => resolve(ctx.result);
      tx.onabort = () => reject(ctx.error || cacheError(ctx.phase, tx.error));
      tx.onerror = event => { ctx.error ||= cacheError(ctx.phase, event.target.error || tx.error); };
      work(tx.objectStore(STORE_NAME), ctx, fail);
    } catch (error) { fail(error); }
  });
}

function toErrorMessage(error) {
  if (!error) return 'unknown error';
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB is not available'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
    request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
    request.onsuccess = () => resolve(request.result);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
    tx.onerror = () => reject(tx.error || new Error('transaction error'));
  });
}

export class VideoCache {
  constructor({ maxEntries = MAX_CACHE_ENTRIES, maxBytes = MAX_CACHE_BYTES } = {}) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || !Number.isSafeInteger(maxBytes) || maxBytes < 1) {
      throw new Error('cache limits must be positive safe integers');
    }
    this._dbPromise = null;
    this.maxEntries = maxEntries;
    this.maxBytes = maxBytes;
  }

  async _db() {
    if (!this._dbPromise) {
      this._dbPromise = openDatabase();
    }
    return this._dbPromise;
  }

  async putVideo(key, record) {
    const db = await this._db();
    let payload;
    try { payload = normalizeRecord({
      key,
      blob: record.blob,
      mimeType: record.mimeType || record.blob?.type || 'video/mp4',
      createdAt: record.createdAt || new Date().toISOString(),
      width: Number(record.width || 0),
      height: Number(record.height || 0),
      duration: Number(record.duration || 0),
      source: record.source || 'server',
      styleVersion: record.styleVersion || '',
      lastAccessedAt: new Date().toISOString(),
    }); } catch (error) { throw cacheError('SIZE', error); }
    if (payload.size > this.maxBytes) throw cacheError('SIZE_LIMIT', 'Blob exceeds cache byte limit');
    await transaction(db, 'readwrite', (store, ctx, fail) => {
      ctx.phase = 'LRU_ENUMERATE';
      const request = store.getAll();
      request.onsuccess = () => {
        try {
          ctx.phase = 'SIZE';
          // Replacing a key does not count twice. Protect the incoming record.
          const records = request.result.filter(item => item.key !== key).map(normalizeRecord);
          let bytes = payload.size;
          for (const item of records) {
            bytes += item.size;
            if (!Number.isSafeInteger(bytes)) throw new Error('cache size overflow');
          }
          let count = records.length + 1;
          const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
          records.sort((a, b) => compare(a.lastAccessedAt, b.lastAccessedAt) ||
            compare(a.createdAt, b.createdAt) || indexedDB.cmp(a.key, b.key));
          for (const item of records) {
            if (count <= this.maxEntries && bytes <= this.maxBytes) break;
            ctx.phase = 'DELETE';
            const deletion = store.delete(item.key);
            deletion.onerror = () => { ctx.error ||= cacheError('DELETE', deletion.error); };
            count--; bytes -= item.size;
          }
          ctx.phase = 'PUT';
          const put = store.put(payload);
          put.onerror = () => { ctx.error ||= cacheError('PUT', put.error); };
        } catch (error) { fail(error); }
      };
    });
    return payload;
  }

  async getVideo(key) {
    const db = await this._db();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(key);
    const value = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error('IndexedDB get failed'));
    });
    await txDone(tx);
    if (!value) return null;
    let normalized;
    try { normalized = normalizeRecord(value); }
    catch (error) {
      console.warn(cacheError('SIZE', error));
      return value; // Blob acquisition must not depend on optional metadata.
    }
    try {
      await transaction(db, 'readwrite', (store, ctx, fail) => {
        ctx.phase = 'METADATA';
        const request = store.get(key);
        request.onsuccess = () => {
          try {
            // Re-read atomically: never resurrect an entry deleted since the HIT.
            if (!request.result) return;
            const current = normalizeRecord(request.result);
            current.lastAccessedAt = new Date(Math.max(Date.now(), Date.parse(current.lastAccessedAt))).toISOString();
            store.put(current);
            ctx.result = current.lastAccessedAt;
          } catch (error) { fail(error); }
        };
      }).then(accessed => { if (accessed) normalized.lastAccessedAt = accessed; });
    } catch (error) { console.warn(cacheError('METADATA', error)); }
    return normalized;
  }

  async getStats() {
    const db = await this._db();
    return transaction(db, 'readonly', (store, ctx, fail) => {
      ctx.phase = 'LRU_ENUMERATE';
      const request = store.getAll();
      request.onsuccess = () => {
        try {
          ctx.phase = 'SIZE';
          const records = request.result.map(normalizeRecord);
          const bytes = records.reduce((sum, record) => sum + record.size, 0);
          if (!Number.isSafeInteger(bytes)) throw new Error('cache size overflow');
          ctx.result = { entries: records.length, bytes };
        } catch (error) { fail(error); }
      };
    });
  }

  async deleteVideo(key) {
    const db = await this._db();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(key);
    await txDone(tx);
  }

  async clearCache() {
    const db = await this._db();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.clear();
    await txDone(tx);
  }
}

export function formatVideoCacheError(error) {
  return toErrorMessage(error);
}

export const VIDEO_CACHE_DB_NAME = DB_NAME;
export const VIDEO_CACHE_STORE_NAME = STORE_NAME;
