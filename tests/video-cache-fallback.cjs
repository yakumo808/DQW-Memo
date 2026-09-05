// Real Chrome/Python/ffmpeg, isolated browser and job directory. See devlog for setup.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const puppeteer = require('puppeteer-core');
const port = Number(process.env.TEST_PORT || 18783);
const origin = `http://127.0.0.1:${port}`;
const jobs = fs.mkdtempSync(path.join(os.tmpdir(), 'dqw-fallback-'));
const server = spawn(process.env.PYTHON_PATH || 'python', ['-B',
  path.resolve(__dirname, '../server/render_server.py'), '--host', '127.0.0.1', '--port', String(port)
], { env: { ...process.env, LOCALAPPDATA: jobs }, windowsHide: true });
let serverError = '';
server.stderr.on('data', d => { serverError += d; });
server.on('error', e => { serverError += e.message; });
let browser;
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  for (let i = 0; ; i++) {
    if (server.exitCode !== null || i > 50) throw new Error(serverError);
    try { if ((await fetch(origin)).ok) break; } catch (_) {}
    await sleep(100);
  }
  browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: false, defaultViewport: { width: 1100, height: 900 }
  });
  console.log(await browser.version());
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin);
  await page.click('#btn-new');
  await page.evaluate(async () => {
    const { VideoCache } = await import('/app/js/core/video_cache.js');
    window.probe = { mode: '', renders: 0, gets: 0, deletes: 0, gate: null };
    const p = window.probe;
    const get = VideoCache.prototype.getVideo;
    const put = VideoCache.prototype.putVideo;
    const del = VideoCache.prototype.deleteVideo;
    VideoCache.prototype.getVideo = async function (...args) {
      p.gets++;
      if (['get', 'both', 'delete'].includes(p.mode) || (p.mode === 'readback' && p.gets === 2)) throw new Error('injected get failure');
      if (p.mode === 'empty' && p.gets === 2) return null;
      return get.apply(this, args);
    };
    VideoCache.prototype.putVideo = async function (...args) {
      if (p.mode === 'stale-put') {
        p.entered = true;
        await new Promise(resolve => { p.release = resolve; });
        throw new Error('delayed put failure');
      }
      if (['put', 'both'].includes(p.mode)) throw new DOMException('injected quota', 'QuotaExceededError');
      return put.apply(this, args);
    };
    VideoCache.prototype.deleteVideo = async function (...args) {
      p.deletes++;
      if (p.mode === 'delete') throw new Error('injected delete failure');
      return del.apply(this, args);
    };
    const originalFetch = fetch.bind(window);
    window.fetch = async (...args) => {
      if (args[0] === '/api/render') {
        p.renders++;
        if (p.mode === 'render') return new Response(JSON.stringify({ ok: false, message: 'injected render failure' }), { status: 500 });
      }
      return originalFetch(...args);
    };
  });
  const setup = async (mode, content) => {
    await page.evaluate(({ mode, content }) => {
      probe.mode = mode; probe.gets = 0; probe.deletes = 0;
      document.querySelector('#log-box').textContent = '';
      const el = document.querySelector('#memo-content');
      el.value = content; el.dispatchEvent(new Event('input', { bubbles: true }));
    }, { mode, content });
  };
  const ready = () => page.waitForFunction(() => document.querySelector('#btn-pip').textContent === 'PiPで表示');
  const pip = async () => {
    await page.click('#btn-pip');
    await page.waitForFunction(() => document.pictureInPictureElement === document.querySelector('#pip-video'));
    await ready();
    await page.evaluate(() => document.exitPictureInPicture());
  };
  for (const [mode, content, expected] of [
    ['', '正常', /キャッシュ保存成功/], ['', '正常', /キャッシュから/],
    ['put', '保存失敗', /キャッシュ保存失敗.*Blob直接/],
    ['get', '読込失敗', /キャッシュ再読込失敗.*Blob直接/],
    ['both', '両方失敗', /キャッシュ保存失敗.*Blob直接/],
    ['readback', '再取得だけ失敗', /キャッシュ再読込失敗.*Blob直接/],
    ['empty', '再取得null', /キャッシュ再読込失敗.*Blob直接/],
    ['delete', '削除も失敗', /キャッシュ再読込失敗.*Blob直接/],
  ]) {
    await setup(mode, content);
    const before = await page.evaluate(() => probe.renders);
    await page.click('#btn-pip'); await ready();
    assert.match(await page.$eval('#status', el => el.textContent), expected);
    const hit = expected.source === 'キャッシュから';
    assert.equal(await page.evaluate(() => probe.renders), before + (hit ? 0 : 1));
    if (['get', 'both', 'delete'].includes(mode)) {
      assert.ok(await page.evaluate(() => probe.deletes > 0));
      assert.match(await page.$eval('#log-box', el => el.textContent), /CACHE READ FAILED \/ REGENERATE/);
    }
    await pip();
    console.log('PASS ready + actual standard PiP:', mode || (hit ? 'HIT' : 'MISS'));
  }
  await setup('render', '生成失敗'); await page.click('#btn-pip');
  await page.waitForFunction(() => document.querySelector('#btn-pip').textContent === '再試行');
  assert.match(await page.$eval('#status', el => el.textContent), /動画生成失敗/);
  await page.evaluate(() => { probe.mode = ''; });
  await page.click('#btn-pip'); await ready(); await pip();
  console.log('PASS render failure -> retry -> ready + PiP');
  await setup('stale-put', '旧本文'); await page.click('#btn-pip');
  await page.waitForFunction(() => probe.entered);
  await setup('', '新本文'); await page.click('#btn-pip'); await ready();
  const url = await page.$eval('#pip-video', v => v.src);
  await page.evaluate(() => probe.release()); await sleep(250);
  assert.equal(await page.$eval('#pip-video', v => v.src), url);
  assert.match(await page.$eval('#status', el => el.textContent), /キャッシュ保存成功/);
  await pip();
  console.log('PASS stale put failure cannot overwrite newer ready');
  assert.deepEqual(errors, []);
  console.log('ALL PASS; pageErrors=0; jobs=' + jobs);
})().catch(e => { console.error(e, serverError); process.exitCode = 1; })
  .finally(async () => { if (browser) await browser.close(); server.kill(); });
