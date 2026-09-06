// Real Chrome/Python/ffmpeg with isolated browser and temporary render jobs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const puppeteer = require('puppeteer-core');
const port = Number(process.env.TEST_PORT || 18784);
const origin = `http://127.0.0.1:${port}`;
const jobs = fs.mkdtempSync(path.join(os.tmpdir(), 'dqw-lifecycle-'));
const server = spawn(process.env.PYTHON_PATH || 'python', ['-B', path.resolve(__dirname, '../server/render_server.py'),
  '--host', '127.0.0.1', '--port', String(port)], { env: { ...process.env, LOCALAPPDATA: jobs }, windowsHide: true });
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
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: false, defaultViewport: { width: 1100, height: 900 } });
  console.log(await browser.version());
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin);
  await page.evaluate(() => localStorage.setItem('dqw_memo_data', JSON.stringify([
    { id: 'a', title: 'A', content: '日本語\nメモA', updated: '2026-09-06' },
    { id: 'b', title: 'B', content: '日本語\nメモB', updated: '2026-09-06' }
  ])));
  await page.reload();
  await page.evaluate(() => {
    window.probe = { created: [], revoked: [], unsafe: [], renders: 0 };
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL), get = fetch.bind(window);
    URL.createObjectURL = blob => { const url = create(blob); probe.created.push(url); return url; };
    URL.revokeObjectURL = url => {
      const v = document.querySelector('#pip-video');
      if ((document.pictureInPictureElement === v || v.webkitPresentationMode === 'picture-in-picture') && v.src === url) probe.unsafe.push(url);
      probe.revoked.push(url); revoke(url);
    };
    window.fetch = (...args) => { if (args[0] === '/api/render') probe.renders++; return get(...args); };
  });
  const open = id => page.click(`[data-id="${id}"]`);
  const back = () => page.click('#btn-back');
  const ready = () => page.waitForFunction(() => document.querySelector('#btn-pip')?.textContent === 'PiPで表示');
  const prepare = async () => { await page.click('#btn-pip'); await ready(); };
  const src = () => page.$eval('#pip-video', v => v.src);
  const idle = async () => {
    assert.equal(await page.$eval('#btn-pip', el => el.textContent), '動画を準備');
    assert.equal(await page.$eval('#status', el => el.textContent), '動画を準備してください');
  };
  const pip = async () => {
    await page.click('#btn-pip');
    await page.waitForFunction(() => document.pictureInPictureElement === document.querySelector('#pip-video'));
    await ready();
  };
  const exit = () => page.evaluate(() => document.exitPictureInPicture());
  const revoked = url => page.waitForFunction(url => probe.revoked.includes(url), {}, url);
  await open('a'); await prepare(); const a1 = await src();
  await back(); await revoked(a1); await open('b'); await idle();
  await prepare(); const b1 = await src(); assert.notEqual(b1, a1); await pip(); await exit();
  console.log('PASS A ready -> list cleanup -> B idle -> distinct B MISS/PiP');
  await back(); await revoked(b1); await open('a');
  const count = await page.evaluate(() => probe.renders);
  await prepare(); assert.equal(await page.evaluate(() => probe.renders), count);
  await pip(); const a2 = await src();
  await back();
  assert.ok(await page.evaluate(url => document.pictureInPictureElement === document.querySelector('#pip-video') && !probe.revoked.includes(url), a2));
  const time = await page.$eval('#pip-video', v => v.currentTime);
  await page.waitForFunction(t => document.querySelector('#pip-video').currentTime !== t, {}, time);
  await exit(); await revoked(a2);
  assert.equal(await page.$eval('#pip-video', v => v.getAttribute('src')), null);
  console.log('PASS A HIT/PiP -> list preserves playback -> leave cleans retired URL/src');

  await open('a'); await prepare(); await pip(); const active = await src();
  await back(); await open('b'); await idle(); await page.click('#btn-pip');
  await page.waitForFunction(() => document.querySelector('#btn-pip').textContent === 'PiP終了待ち');
  assert.equal(await src(), active);
  assert.ok(!await page.evaluate(url => probe.revoked.includes(url), active));
  await exit(); await ready(); await revoked(active);
  const next = await src(); assert.notEqual(next, active); await pip(); await exit();
  console.log('PASS B prepare during A PiP waits without replacing src; resumes after exit');

  // Same memo still owns a ready URL after PiP exit; editing then releases it.
  assert.ok(!await page.evaluate(url => probe.revoked.includes(url), next));
  await page.$eval('#memo-content', el => { el.value += '変更'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await idle(); await revoked(next); await prepare(); const changed = await src();
  await back(); await revoked(changed);
  console.log('PASS ready URL retained for same Editor, released on edit/replacement/list');

  // Waiting request invalidates immediately even before PiP exits.
  await open('a'); await prepare(); await pip(); const held = await src();
  await back(); await open('b'); await page.click('#btn-pip');
  await page.waitForFunction(() => document.querySelector('#btn-pip').textContent === 'PiP終了待ち');
  await back(); await open('a'); await idle(); await exit(); await revoked(held);
  await sleep(200); await idle();
  console.log('PASS stale waiting request cannot restore ready after navigation');

  // Protect the attached URL even before the PiP controller reports completion.
  await prepare(); const startingUrl = await src();
  await page.evaluate(async () => {
    const { VideoPipController } = await import('/app/js/core/video_pip.js');
    const original = VideoPipController.prototype.startPip;
    VideoPipController.prototype.startPip = async function () {
      const result = await original.call(this);
      probe.startHeld = true;
      await new Promise(resolve => { probe.releaseStart = resolve; });
      VideoPipController.prototype.startPip = original;
      return result;
    };
  });
  await page.click('#btn-pip'); await page.waitForFunction(() => probe.startHeld);
  await back(); await exit();
  assert.ok(!await page.evaluate(url => probe.revoked.includes(url), startingUrl));
  await page.evaluate(() => probe.releaseStart()); await revoked(startingUrl);
  console.log('PASS PiP-start completion pending: retire safely after exit and completion');

  await open('b');
  await page.evaluate(() => {
    const original = fetch;
    window.fetch = (...args) => args[0] === '/api/render'
      ? Promise.resolve(new Response(JSON.stringify({ ok: false, message: 'test error' }), { status: 500 })) : original(...args);
    const el = document.querySelector('#memo-content'); el.value = '未生成エラー用'; el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.click('#btn-pip'); await page.waitForFunction(() => document.querySelector('#btn-pip').textContent === '再試行');
  await back(); await open('a'); await idle();
  console.log('PASS previous memo error/message cleared on navigation');

  await back();
  const stats = await page.evaluate(() => probe);
  assert.deepEqual(stats.unsafe, []);
  assert.equal(new Set(stats.revoked).size, stats.revoked.length);
  assert.deepEqual([...stats.created].sort(), [...stats.revoked].sort());
  assert.deepEqual(errors, []);
  console.log('ALL PASS', JSON.stringify({ created: stats.created.length, revoked: stats.revoked.length, unsafe: stats.unsafe, errors, jobs }));
})().catch(e => { console.error(e, serverError); process.exitCode = 1; })
  .finally(async () => { if (browser) await browser.close(); server.kill(); });
