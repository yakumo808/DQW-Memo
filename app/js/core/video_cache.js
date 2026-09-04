// @ts-check

const DB_NAME = 'DQW-Memo';
const STORE_NAME = 'videoCache';
const DB_VERSION = 1;

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
  constructor() {
    this._dbPromise = null;
  }

  async _db() {
    if (!this._dbPromise) {
      this._dbPromise = openDatabase();
    }
    return this._dbPromise;
  }

  async putVideo(key, record) {
    const db = await this._db();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const payload = {
      key,
      blob: record.blob,
      mimeType: record.mimeType || record.blob?.type || 'video/mp4',
      createdAt: record.createdAt || new Date().toISOString(),
      width: Number(record.width || 0),
      height: Number(record.height || 0),
      duration: Number(record.duration || 0),
      source: record.source || 'server',
      styleVersion: record.styleVersion || '',
    };
    store.put(payload);
    await txDone(tx);
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
    return value;
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
