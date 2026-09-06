// Real Chrome IndexedDB capacity tests plus real render/Blob/PiP failure paths.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const puppeteer = require('puppeteer-core');
const port = Number(process.env.TEST_PORT || 18785), origin = `http://127.0.0.1:${port}`;
const jobs = fs.mkdtempSync(path.join(os.tmpdir(), 'dqw-lru-'));
const server = spawn(process.env.PYTHON_PATH || 'python', ['-B', path.resolve(__dirname, '../server/render_server.py'),
  '--host', '127.0.0.1', '--port', String(port)], { env: { ...process.env, LOCALAPPDATA: jobs }, windowsHide: true });
let failure = '', browser;
server.stderr.on('data', d => { failure += d; });
server.on('error', e => { failure += e.message; });
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  for (let i = 0; ; i++) {
    if (server.exitCode !== null || i > 50) throw new Error(failure);
    try { if ((await fetch(origin)).ok) break; } catch (_) {}
    await sleep(100);
  }
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: false });
  console.log(await browser.version());
  const page = await browser.newPage(); const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin);
  const results = await page.evaluate(async () => {
    const { VideoCache, MAX_CACHE_ENTRIES, MAX_CACHE_BYTES } = await import('/app/js/core/video_cache.js');
    const results = [];
    const ok = (value, label) => { if (!value) throw new Error(label); results.push(label); };
    const cache = new VideoCache({ maxEntries: 3, maxBytes: 12 });
    const blob = n => new Blob([new Uint8Array(n)], { type: 'video/mp4' });
    const put = (key, n = 3) => cache.putVideo(key, { blob: blob(n) });
    const db = await cache._db();
    const raw = async () => new Promise((resolve, reject) => {
      const r = db.transaction('videoCache').objectStore('videoCache').getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
    const write = records => new Promise((resolve, reject) => {
      const tx = db.transaction('videoCache', 'readwrite');
      for (const r of records) tx.objectStore('videoCache').put(r);
      tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
    });
    const reset = () => cache.clearCache();
    ok(MAX_CACHE_ENTRIES === 20 && MAX_CACHE_BYTES === 1048576, 'defaults 20 / 1MiB');
    await reset(); ok(JSON.stringify(await cache.getStats()) === '{"entries":0,"bytes":0}', 'empty');
    await put('a'); ok((await cache.getStats()).bytes === 3, 'one record / Blob bytes');
    let rows = await raw(); rows[0].lastAccessedAt = '2000-01-01T00:00:00.000Z'; await write(rows);
    await cache.getVideo('a'); ok((await raw())[0].lastAccessedAt > rows[0].lastAccessedAt, 'HIT persists access timestamp');
    await put('b'); ok((await raw()).length === 2, 'below entry limit no eviction');
    await put('c'); rows = await raw();
    for (let i = 0; i < rows.length; i++) rows[i].lastAccessedAt = `200${i}-01-01T00:00:00.000Z`;
    await write(rows); await put('d');
    ok((await raw()).map(r => r.key).join() === 'b,c,d', 'entry overflow evicts oldest one');
    await reset(); await put('a'); await put('b'); await put('c');
    rows = await raw(); for (const r of rows) r.lastAccessedAt = '2000-01-01T00:00:00.000Z'; await write(rows);
    await cache.getVideo('a'); await put('d'); ok((await raw()).some(r => r.key === 'a'), 'recent HIT survives');
    await reset(); await put('a', 4); await put('b', 4); await put('c', 4);
    rows = await raw(); for (let i = 0; i < rows.length; i++) rows[i].lastAccessedAt = `200${i}-01-01T00:00:00.000Z`; await write(rows);
    await put('d', 8); ok((await raw()).map(r => r.key).join() === 'c,d' && (await cache.getStats()).bytes === 12, 'byte overflow evicts oldest in order');
    await reset(); await write(['a','b','c'].map(key => ({ key, blob: blob(3), createdAt: key === 'c' ? '1999-01-01' : '2000-01-01', lastAccessedAt: '2001-01-01' })));
    await put('d'); ok(!(await raw()).some(r => r.key === 'c'), 'tie uses createdAt');
    await reset(); await write(['c','b','a'].map(key => ({ key, blob: blob(3), createdAt: '2000-01-01', lastAccessedAt: '2001-01-01' })));
    await put('d'); ok(!(await raw()).some(r => r.key === 'a'), 'tie uses stable key');
    await reset(); await write([{ key: 'legacy', blob: blob(4), size: 999 }]);
    const legacy = await cache.getVideo('legacy');
    ok(legacy.size === 4 && legacy.createdAt === '1970-01-01T00:00:00.000Z' && !!legacy.lastAccessedAt, 'legacy metadata fallback and repair');
    await put('legacy', 5); ok((await cache.getStats()).entries === 1 && (await cache.getStats()).bytes === 5, 'replacement counted once');
    try { await put('large', 13); throw new Error('accepted oversize'); } catch (e) { ok(e.message.includes('SIZE_LIMIT'), 'oversized Blob rejected'); }
    ok((await cache.getStats()).entries === 1, 'oversize does not evict existing');
    await reset(); const other = new VideoCache({ maxEntries: 3, maxBytes: 12 });
    await Promise.all(Array.from({ length: 8 }, (_, i) => (i % 2 ? cache : other).putVideo('parallel' + i, { blob: blob(3) })));
    ok((await cache.getStats()).entries === 3 && (await cache.getStats()).bytes === 9, 'concurrent instances respect limits');
    await reset(); await put('a'); await put('b'); await put('c');
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function () { throw new Error('injected PUT'); };
    try { await put('d'); } catch (e) { ok(e.message.includes('PUT'), 'put failure classified'); }
    const hit = await cache.getVideo('a'); ok(hit.blob.size === 3, 'metadata update failure still returns HIT Blob');
    IDBObjectStore.prototype.put = originalPut;
    ok((await raw()).map(r => r.key).join() === 'a,b,c', 'failed put rolls back evictions');
    const originalAll = IDBObjectStore.prototype.getAll;
    IDBObjectStore.prototype.getAll = function () { throw new Error('injected enumerate'); };
    try { await put('d'); } catch (e) { ok(e.message.includes('LRU_ENUMERATE'), 'enumeration failure classified'); }
    IDBObjectStore.prototype.getAll = originalAll;
    await reset(); await write([{ key: 'broken', blob: null }]);
    try { await put('d'); } catch (e) { ok(e.message.includes('SIZE'), 'size failure classified'); }
    await reset();
    window.lru = { cache: new VideoCache(), blob, originalDelete: IDBObjectStore.prototype.delete, originalPut, renders: 0 };
    const originalFetch = fetch.bind(window);
    window.fetch = (...args) => { if (args[0] === '/api/render') lru.renders++; return originalFetch(...args); };
    return results;
  });
  results.forEach(r => console.log('PASS', r));
  await page.click('#btn-new');
  const prepare = async content => {
    await page.$eval('#memo-content', (el, content) => { el.value = content; el.dispatchEvent(new Event('input', { bubbles: true })); }, content);
    await page.click('#btn-pip'); await page.waitForFunction(() => document.querySelector('#btn-pip').textContent === 'PiPで表示');
  };
  const pip = async () => { await page.click('#btn-pip'); await page.waitForFunction(() => document.pictureInPictureElement === document.querySelector('#pip-video')); await page.waitForFunction(() => document.querySelector('#btn-pip').textContent === 'PiPで表示'); };
  await page.evaluate(async () => { for (let i = 0; i < 20; i++) await lru.cache.putVideo('fill' + i, { blob: lru.blob(1) }); IDBObjectStore.prototype.delete = function () { throw new Error('injected DELETE'); }; });
  await prepare('削除失敗でも動画'); await pip();
  assert.match(await page.$eval('#log-box', el => el.textContent), /DELETE/);
  assert.match(await page.$eval('#status', el => el.textContent), /Blob直接/);
  await page.evaluate(() => { IDBObjectStore.prototype.delete = lru.originalDelete; return document.exitPictureInPicture(); });
  console.log('PASS delete failure -> real render -> direct Blob -> PiP');
  await prepare('通常キャッシュ'); await pip(); await page.evaluate(() => document.exitPictureInPicture());
  const count = await page.evaluate(() => lru.renders);
  await page.evaluate(() => { IDBObjectStore.prototype.put = function () { throw new Error('metadata failure'); }; });
  await prepare('通常キャッシュ'); await pip();
  assert.equal(await page.evaluate(() => lru.renders), count);
  await page.evaluate(() => { IDBObjectStore.prototype.put = lru.originalPut; });
  const url = await page.$eval('#pip-video', v => v.src);
  await page.evaluate(async () => { for (let i = 0; i < 21; i++) await lru.cache.putVideo('evict' + i, { blob: lru.blob(1) }); });
  assert.ok(await page.evaluate(url => document.pictureInPictureElement === document.querySelector('#pip-video') && document.querySelector('#pip-video').src === url, url));
  await page.waitForFunction(() => !document.querySelector('#pip-video').paused && document.querySelector('#pip-video').currentTime > 0);
  await page.evaluate(() => document.exitPictureInPicture());
  console.log('PASS metadata failure HIT/PiP; IDB eviction leaves playing Object URL intact');
  assert.deepEqual(errors, []);
  console.log('ALL PASS', { jobs, errors });
})().catch(e => { console.error(e, failure); process.exitCode = 1; })
  .finally(async () => { if (browser) await browser.close(); server.kill(); });
