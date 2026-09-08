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
      const record = await get.apply(this, args);
      if(p.mode==='legacy-broken' && record && !record.bytes) record.blob.arrayBuffer=async()=>{throw new DOMException('legacy missing','NotFoundError');};
      if(p.gets===2 && record && p.mode!=='legacy-broken') {
        if(p.mode==='verify-stale'){p.entered=true;await new Promise(r=>p.release=r);}
        if(p.mode==='verify-fail') record.bytes=null;
        else {
          const original=new Uint8Array(await p.generated.arrayBuffer()), restored=new Uint8Array(record.bytes);
          if(p.generated.type!==record.blob.type || original.length!==restored.length || original.some((v,i)=>v!==restored[i])) throw new Error('post-save byte mismatch');
          p.verified=true;
        }
      }
      return record;
    };
    VideoCache.prototype.putVideo = async function (...args) {
      if (p.mode === 'stale-put') {
        p.entered = true;
        await new Promise(resolve => { p.release = resolve; });
        throw new Error('delayed put failure');
      }
      if (['put', 'both'].includes(p.mode)) throw new DOMException('injected quota', 'QuotaExceededError');
      if (!(args[1].bytes instanceof ArrayBuffer) || args[1].blob) throw new Error('save must contain bytes only');
      p.generated=new Blob([args[1].bytes],{type:args[1].type});
      if(p.networkBlob) {
        const a=new Uint8Array(await p.networkRead()),b=new Uint8Array(await p.generated.arrayBuffer());
        if(p.networkBlob===p.generated || p.networkBlob.size!==p.generated.size || p.networkBlob.type!==p.generated.type || a.length!==b.length || a.some((v,i)=>v!==b[i])) throw new Error('pre-save copy mismatch');
        p.copyVerified=true;
      }
      return put.apply(this, args);
    };
    VideoCache.prototype.deleteVideo = async function (...args) {
      p.deletes++;
      if (p.mode === 'delete') throw new Error('injected delete failure');
      return del.apply(this, args);
    };
    const responseBlob=Response.prototype.blob;
    Response.prototype.blob=async function(){
      const blob=await responseBlob.call(this);
      p.networkBlob=blob;p.networkRead=blob.arrayBuffer.bind(blob);
      if(p.mode==='copy-fail') blob.arrayBuffer=async()=>{throw new DOMException('copy failed','NotFoundError');};
      if(p.mode==='copy-stale') blob.arrayBuffer=async()=>{p.entered=true;await new Promise(r=>p.release=r);return p.networkRead();};
      return blob;
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
    ['copy-fail', 'コピー失敗', /キャッシュ保存失敗.*Blob直接/],
    ['put', '保存失敗', /キャッシュ保存失敗.*Blob直接/],
    ['get', '読込失敗', /キャッシュ再読込失敗.*Blob直接/],
    ['both', '両方失敗', /キャッシュ保存失敗.*Blob直接/],
    ['readback', '再取得だけ失敗', /キャッシュ再読込失敗.*Blob直接/],
    ['verify-fail', '保存後読込失敗', /キャッシュ再読込失敗.*Blob直接/],
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
    if(['verify-fail','readback','empty'].includes(mode)) {
      assert.equal(await page.evaluate(()=>probe.deletes),0);
      assert.equal(await page.evaluate(()=>probe.gets),2);
      assert.match(await page.$eval('#log-box',e=>e.textContent),/CACHE BYTES POST-SAVE VERIFY READ FAILED/);
    }
    if(!mode && !hit) {
      assert.equal(await page.evaluate(()=>probe.verified && probe.copyVerified),true);
    }
    if(mode==='copy-fail') {
      assert.equal(await page.evaluate(()=>probe.gets),1);
      assert.match(await page.$eval('#log-box',e=>e.textContent),/CACHE BYTES SAVE FAILED/);
    }
    await pip();
    console.log('PASS ready + actual standard PiP:', mode || (hit ? 'HIT' : 'MISS'));
  }
  // Repeated bytes HITs exercise the actual stored ArrayBuffer, not a mocked record.
  for(let i=0;i<3;i++) {
    await setup('', '正常');
    const renders=await page.evaluate(()=>probe.renders);
    await page.click('#btn-pip');await ready();await pip();
    assert.equal(await page.evaluate(()=>probe.renders),renders);
    assert.match(await page.$eval('#log-box',e=>e.textContent),/CACHE HIT FORMAT=bytes/);
  }
  await page.evaluate(async()=>{
    const {VideoCache}=await import('/app/js/core/video_cache.js');
    const db=await new VideoCache()._db();
    const rows=await new Promise((resolve,reject)=>{const r=db.transaction('videoCache').objectStore('videoCache').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    if(!rows.length || rows.some(r=>!(r.bytes instanceof ArrayBuffer)||'blob' in r||r.size!==r.bytes.byteLength||r.type!=='video/mp4'))throw new Error('raw record not bytes-only');
  });
  console.log('PASS raw DB bytes-only, size/type, repeated bytes HIT/PiP render 0');
  await setup('', '正常');
  await page.evaluate(async()=>{
    const {VideoCache}=await import('/app/js/core/video_cache.js');
    const db=await new VideoCache()._db();
    const rows=await new Promise((resolve,reject)=>{const r=db.transaction('videoCache').objectStore('videoCache').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    const existing=rows.find(r=>r.key.includes('正常'));
    if(!existing) throw new Error('missing legacy fixture key');
    const blob=await (await fetch('/spikes/002-ios-video-pip/sample.mp4')).blob();
    // Pre-copy-era shape: directly fetched Blob and no added metadata.
    await new Promise((resolve,reject)=>{const tx=db.transaction('videoCache','readwrite');tx.objectStore('videoCache').put({key:existing.key,blob});tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});
  });
  const legacyRenders=await page.evaluate(()=>probe.renders);
  await page.click('#btn-pip');await ready();await pip();
  assert.equal(await page.evaluate(()=>probe.renders),legacyRenders);
  console.log('PASS legacy directly stored Blob HIT -> PiP without render');
  await setup('legacy-broken','正常');
  const beforeFallback=await page.evaluate(()=>probe.renders);
  await page.click('#btn-pip');await ready();await pip();
  assert.equal(await page.evaluate(()=>probe.renders),beforeFallback+1);
  await page.evaluate(async()=>{
    const {VideoCache}=await import('/app/js/core/video_cache.js');
    const db=await new VideoCache()._db();
    const rows=await new Promise((resolve,reject)=>{const r=db.transaction('videoCache').objectStore('videoCache').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    const r=rows.find(r=>r.key.includes('正常'));
    if(!(r.bytes instanceof ArrayBuffer)||'blob' in r) throw new Error('legacy not replaced with bytes');
  });
  console.log('PASS legacy NotFoundError/refetch failure -> render -> bytes replacement/PiP');

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
  await setup('verify-stale','保存確認中の旧本文');
  await page.evaluate(()=>{probe.entered=false;});
  await page.click('#btn-pip'); await page.waitForFunction(()=>probe.entered);
  await setup('', '保存確認後の新本文'); await page.click('#btn-pip'); await ready();
  const latest=await page.$eval('#pip-video',v=>v.src);
  await page.evaluate(()=>probe.release()); await sleep(250);
  assert.equal(await page.$eval('#pip-video',v=>v.src),latest);
  assert.equal(await page.evaluate(()=>probe.deletes),0);
  await pip();
  console.log('PASS stale post-save read cannot replace newer ready/PiP');
  await setup('copy-stale','コピー中の旧本文'); await page.evaluate(()=>{probe.entered=false;});
  await page.click('#btn-pip'); await page.waitForFunction(()=>probe.entered);
  await page.click('#btn-back'); await page.evaluate(()=>probe.release()); await sleep(250);
  assert.equal(await page.evaluate(()=>probe.gets),1);
  assert.equal(await page.evaluate(()=>probe.deletes),0);
  assert.match(await page.$eval('#log-box',e=>e.textContent),/CACHE BYTES SAVE STALE/);
  console.log('PASS stale pre-save copy -> no save/readback');
  assert.deepEqual(errors, []);
  console.log('ALL PASS; pageErrors=0; jobs=' + jobs);
})().catch(e => { console.error(e, serverError); process.exitCode = 1; })
  .finally(async () => { if (browser) await browser.close(); server.kill(); });
