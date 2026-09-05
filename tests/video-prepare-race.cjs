// Real Desktop Chrome + unmodified Python/ffmpeg server; isolated browser and job data.
// Requires puppeteer-core, PYTHON_PATH, FFMPEG, optional CHROME_PATH.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const puppeteer = require('puppeteer-core');

const root = path.resolve(__dirname, '..');
const port = Number(process.env.TEST_PORT || 18782);
const origin = `http://127.0.0.1:${port}`;
const jobs = fs.mkdtempSync(path.join(os.tmpdir(), 'dqw-race-'));
const server = spawn(process.env.PYTHON_PATH || 'python', [
  '-B', path.join(root, 'server/render_server.py'), '--host', '127.0.0.1', '--port', String(port),
], { env: { ...process.env, LOCALAPPDATA: jobs }, windowsHide: true });
let serverLog = '';
server.stderr.on('data', data => { serverLog += data; });
server.on('error', error => { serverLog += error.message; });
let browser;
const results = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  for (let i = 0; ; i++) {
    if (server.exitCode !== null) throw new Error(serverLog);
    try { if ((await fetch(origin)).ok) break; } catch (_) { /* starting */ }
    if (i === 50) throw new Error(`Server unavailable: ${serverLog}`);
    await pause(100);
  }
  browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: false,
    defaultViewport: { width: 1100, height: 900 },
  });
  console.log('CHROME', await browser.version());
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(20000);
  await page.goto(origin);
  await page.evaluate(() => localStorage.setItem('dqw_memo_data', JSON.stringify([
    { id: 'a', title: 'メモA', content: '本文A', updated: '2026-09-06T00:00:00Z' },
    { id: 'b', title: 'メモB', content: '本文B', updated: '2026-09-06T00:00:00Z' },
  ])));
  await page.reload();
  await page.waitForSelector('[data-id="a"]');
  await page.evaluate(async () => {
    const { VideoCache } = await import('/app/js/core/video_cache.js');
    const { VideoPipController } = await import('/app/js/core/video_pip.js');
    window.probe = { gate: null, renders: [], created: [], revoked: [], prepares: 0 };
    const p = window.probe;
    p.hold = async type => {
      const gate = p.gate;
      if (!gate || gate.type !== type || gate.entered) return;
      gate.entered = true;
      await new Promise(resolve => { gate.release = resolve; });
      if (gate.fail) throw new Error('injected stale failure');
    };
    for (const [method, type] of [['getVideo', 'get'], ['putVideo', 'put']]) {
      const original = VideoCache.prototype[method];
      VideoCache.prototype[method] = async function (...args) {
        const result = await original.apply(this, args);
        await p.hold(type);
        return result;
      };
    }
    const prepare = VideoPipController.prototype.prepare;
    VideoPipController.prototype.prepare = async function (...args) {
      p.prepares++;
      const result = await prepare.apply(this, args);
      await p.hold('prepare');
      return result;
    };
    const fetchOriginal = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const response = await fetchOriginal(...args);
      if (args[0] === '/api/render') {
        p.renders.push({ input: JSON.parse(args[1].body), result: await response.clone().json() });
        await p.hold('render');
      } else if (String(args[0]).startsWith('/videos/')) {
        await p.hold('fetch');
      }
      return response;
    };
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = blob => { const url = create(blob); p.created.push(url); return url; };
    URL.revokeObjectURL = url => { p.revoked.push(url); revoke(url); };
  });
  await page.click('[data-id="a"]');
  const edit = async content => page.$eval('#memo-content', (el, value) => {
    el.value = value; el.dispatchEvent(new Event('input', { bubbles: true }));
  }, content);
  const run = () => page.click('#btn-pip');
  const ready = () => page.waitForFunction(() => document.querySelector('#btn-pip')?.textContent === 'PiPで表示');
  const idle = async () => assert.equal(await page.$eval('#btn-pip', el => el.textContent), '動画を準備');
  const count = () => page.evaluate(() => probe.renders.length);
  const arm = type => page.evaluate(type => { probe.gate = { type, entered: false }; }, type);
  const held = () => page.waitForFunction(() => probe.gate?.entered);
  const release = async (fail = false) => {
    await page.evaluate(fail => { probe.gate.fail = fail; probe.gate.release(); }, fail);
    await pause(250);
  };
  const pass = label => { results.push(label); console.log('PASS', label); };

  await run(); await ready();
  assert.equal(await count(), 1);
  assert.match(await page.$eval('#status', el => el.textContent), /新規生成/);
  assert.equal(await page.$eval('#pip-video', v => v.videoWidth), 640);
  pass('1 CACHE MISS: actual Python/ffmpeg generation and Blob video metadata');
  await edit('本文A'); await run(); await ready();
  assert.equal(await count(), 1);
  assert.match(await page.$eval('#status', el => el.textContent), /キャッシュから/);
  pass('2 CACHE HIT: zero additional render requests');

  for (const content of ['本文A', '検索MISS']) {
    await edit(content); await arm('get'); await run(); await held();
    const before = await count();
    await edit('検索中に変更'); await idle(); await release(); await idle();
    assert.equal(await count(), before);
  }
  pass('3 IndexedDB lookup: HIT and MISS results discarded after edit');

  await edit('render中の旧本文'); await arm('render'); await run(); await held();
  await edit('render中の新本文'); await release(); await idle();
  pass('4 render response discarded after edit');

  await edit('別メモ切替前'); await arm('render'); await run(); await held();
  await page.click('#btn-back'); await page.click('[data-id="b"]');
  await release(); await idle();
  assert.equal(await page.$eval('#memo-content', el => el.value), '本文B');
  pass('5 switching memo prevents old ready state');
  await page.click('#btn-back'); await page.click('[data-id="a"]');
  await run(); await ready();
  assert.match(await page.$eval('#status', el => el.textContent), /キャッシュから/);
  pass('6 returning to original memo prepares from cache');

  for (const type of ['fetch', 'put']) {
    await edit(`${type}旧本文`); await arm(type); await run(); await held();
    await edit(`${type}新本文`); await release(); await idle();
  }
  pass('Blob fetch and IndexedDB write completions discarded after edit');

  await edit('本文A'); await arm('prepare'); await run(); await held();
  const oldUrl = await page.$eval('#pip-video', v => v.src);
  const prepares = await page.evaluate(() => probe.prepares);
  await edit('prepare中の新本文'); await run();
  await page.waitForFunction(() => document.querySelector('#log-box').textContent.includes('CACHE STORED メモA\nprepare中の新本文'));
  assert.equal(await page.evaluate(() => probe.prepares), prepares);
  await release(); await ready();
  assert.notEqual(await page.$eval('#pip-video', v => v.src), oldUrl);
  assert.ok(await page.evaluate(url => probe.revoked.includes(url), oldUrl));
  pass('prepare serialized: stale URL revoked, newer request ready with its own URL');

  await edit('本文A'); await arm('get'); await run(); await held();
  await edit('一時変更'); await edit('本文A'); await release(); await idle();
  pass('ABA edit back to same text still invalidates token');

  await edit('古い要求'); await arm('render'); await run(); await held();
  await edit('本文A'); await run(); await ready();
  const latestUrl = await page.$eval('#pip-video', v => v.src);
  await release();
  assert.equal(await page.$eval('#btn-pip', el => el.textContent), 'PiPで表示');
  assert.equal(await page.$eval('#pip-video', v => v.src), latestUrl);
  assert.ok(!await page.evaluate(url => probe.revoked.includes(url), latestUrl));
  await page.$eval('#pip-video', async v => { await v.play(); });
  await page.waitForFunction(() => document.querySelector('#pip-video').currentTime > 0);
  pass('newer ready URL survives late stale render; actual Blob playback advances');

  await edit('本文A'); await arm('get'); await run(); await held();
  await page.$eval('#memo-title', el => {
    el.value = '変更タイトル'; el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await release(); await idle();
  pass('title change invalidates pending lookup');

  await edit('本文A'); await arm('prepare'); await run(); await held();
  await page.click('#btn-back'); await page.click('[data-id="b"]');
  await release(true); await idle();
  await run(); await ready();
  pass('stale prepare rejection cannot overwrite new memo or poison prepare queue');

  const records = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open('DQW-Memo', 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
    const values = await new Promise((resolve, reject) => {
      const r = db.transaction('videoCache').objectStore('videoCache').getAll();
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
    db.close();
    return Promise.all(values.map(async r => ({ key: r.key, sha: Array.from(new Uint8Array(
      await crypto.subtle.digest('SHA-256', await r.blob.arrayBuffer())
    )).map(x => x.toString(16).padStart(2, '0')).join('') })));
  });
  const renders = await page.evaluate(() => probe.renders);
  for (const record of records) {
    const matches = renders.filter(r => `${r.input.title}\n${r.input.content}\nv1` === record.key);
    assert.ok(matches.length, `unknown cache key ${record.key}`);
    assert.ok(matches.some(r => {
      assert.equal(fs.readFileSync(r.result.inputTxt, 'utf8'), `${r.input.title}\n\n${r.input.content}`);
      return crypto.createHash('sha256').update(fs.readFileSync(r.result.outputMp4)).digest('hex') === record.sha;
    }), `wrong video for key ${record.key}`);
  }
  assert.ok(records.some(r => r.key === 'メモA\nput旧本文\nv1'));
  assert.ok(!records.some(r => /検索中に変更|render中の新本文/.test(r.key)));
  pass(`7 cache key -> POST -> input.txt -> generated MP4 SHA256 matches all ${records.length} cached Blobs`);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ results, records, jobs, pageErrors: errors }, null, 2));
})().catch(error => { console.error(error, serverLog); process.exitCode = 1; })
  .finally(async () => { if (browser) await browser.close(); server.kill(); });
