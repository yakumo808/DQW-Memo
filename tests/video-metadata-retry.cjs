// Real Chrome/Python/ffmpeg, isolated browser and job directory. See devlog for setup.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const puppeteer = require('puppeteer-core');
const port = Number(process.env.TEST_PORT || 18786);
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
  assert.match(await page.$eval('#log-box',e=>e.textContent), /ENV browser=Chrome.*ENV app=v0.8.3.2-dev.*ENV userAgent=/s);
  const envPage=await browser.newPage();
  for (const [browserName,ua] of [
    ['Safari','Mozilla/5.0 (iPhone; CPU iPhone OS 26_6_1 like Mac OS X) AppleWebKit/605.1.15 Version/26.6 Mobile/15E148 Safari/604.1'],
    ['Chrome','Mozilla/5.0 (iPhone; CPU iPhone OS 26_6_1 like Mac OS X) AppleWebKit/605.1.15 CriOS/152.0 Mobile/15E148 Safari/604.1'],
    ['その他','Mozilla/5.0 Firefox/150.0']
  ]) {
    await envPage.setUserAgent(ua); await envPage.goto(origin);
    await envPage.waitForSelector('.dev-version');
    const logs=await envPage.$eval('#log-box',e=>e.textContent);
    assert.ok(logs.includes('ENV browser='+browserName));
    assert.ok(logs.includes('ENV app=v0.8.3.2-dev'));
    assert.ok(logs.includes('ENV userAgent='+ua));
    if(browserName!=='その他') assert.ok(logs.includes('iOS=26_6_1'));
  }
  await envPage.close();
  console.log('PASS ENV Chrome plus simulated Safari/CriOS/other UA, app version and iOS');
  await page.click('#btn-new');
  await page.evaluate(async () => {
    const {VideoPipController} = await import('/app/js/core/video_pip.js');
    const {VideoCache} = await import('/app/js/core/video_cache.js');
    const p = window.probe = {fail:0,renders:0,deletes:0,urls:[],created:[],revoked:[],unsafe:[],gate:false};
    p.recordPuts=0;
    const recordPut=IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put=function(...args){if(this.name==='videoCache')p.recordPuts++;return recordPut.apply(this,args);};
    const original = VideoPipController.prototype._doPrepare;
    VideoPipController.prototype._doPrepare = async function(url) {
      p.urls.push(url);
      if (p.urls.length === 3) {
        if(p.revoked.includes(p.urls[0])) throw new Error('old URL revoked before refresh attempt');
        if(p.urlBlobs.get(p.urls[0])!==p.urlBlobs.get(url)) throw new Error('refresh changed Blob');
      }
      if(p.urls.length===4 && p.fail===0 && !p.rebuildReadFail) {
        const old=p.urlBlobs.get(p.urls[0]), rebuilt=p.urlBlobs.get(url);
        if(old===rebuilt || old.size!==rebuilt.size || old.type!==rebuilt.type) throw new Error('invalid Blob reconstruction');
        const a=new Uint8Array(await old.arrayBuffer()),b=new Uint8Array(await rebuilt.arrayBuffer());
        if(a.length!==b.length || a.some((v,i)=>v!==b[i])) throw new Error('rebuilt bytes mismatch');
      }
      if(p.gateAt===p.urls.length) {p.entered=true; await new Promise(r=>p.release=r);}
      if(p.fail > 0) {
        p.fail--;
        if(p.gate) {p.entered=true; await new Promise(r=>p.release=r);}
        if(p.mode==='exception') throw new Error('injected prepare exception');
        if(p.mode==='unspecified') return {ok:false,message:'legacy failure without reason'};
        if(p.mode==='event') {
          const v=this.video;
          // Exercise the actual metadata wait listener with an error event/code 4.
          Object.defineProperty(v,'readyState',{configurable:true,value:0});
          const pending=this._waitForMetadata(12000);
          Object.defineProperty(v,'error',{configurable:true,value:{code:4,message:'injected media error'}});
          v.dispatchEvent(new Event('error'));
          const result=await pending;
          delete v.error; delete v.readyState;
          return result;
        }
        return {ok:false,reason:'metadata-timeout',message:'injected metadata timeout'};
      }
      return original.call(this,url);
    };
    const del=VideoCache.prototype.deleteVideo;
    VideoCache.prototype.deleteVideo=function(...args){p.deletes++;return del.apply(this,args);};
    const put=VideoCache.prototype.putVideo;
    const get=VideoCache.prototype.getVideo;
    VideoCache.prototype.getVideo=async function(...args){
      const record=await get.apply(this,args);
      if(record) delete record.bytes; // Exercise retained legacy Blob diagnostics with a Blob-only result.
      if(p.refetchMode) {
        p.gets=(p.gets||0)+1;
        if(p.gets===1 && record) record.blob.arrayBuffer=async()=>{throw new DOMException('first reference unavailable','NotFoundError');};
        if(p.gets===2) {
          if(p.refetchMode==='missing') return null;
          if(p.refetchMode==='get-gate'){p.entered=true;await new Promise(r=>p.release=r);}
          if(p.refetchMode==='read-gate' && record) {
            const read=record.blob.arrayBuffer.bind(record.blob);
            record.blob.arrayBuffer=async()=>{p.entered=true;await new Promise(r=>p.release=r);return read();};
          }
        }
      }
      if(record && (p.earlyFail || p.earlyGate)) {
        const read=record.blob.arrayBuffer.bind(record.blob);
        record.blob.arrayBuffer=async()=>{
          if(p.earlyGate){p.entered=true;await new Promise(r=>p.release=r);}
          if(p.earlyFail) throw new DOMException('injected early read failure','NotFoundError');
          return read();
        };
      }
      return record;
    };
    VideoCache.prototype.putVideo=async function(key,record){
      const before = new Uint8Array((record.bytes || await record.blob.arrayBuffer()));
      const result=await put.call(this,key,record);
      const after=await get.call(this,key);
      const bytes=new Uint8Array(await after.blob.arrayBuffer());
      if((record.type || record.blob.type)!==after.blob.type || before.length!==bytes.length || before.some((v,i)=>v!==bytes[i])) throw new Error('Blob roundtrip mismatch');
      p.compared=true; return result;
    };
    const fetchOriginal=fetch;
    window.fetch=(...args)=>{if(args[0]==='/api/render')p.renders++;return fetchOriginal(...args);};
    const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);
    p.urlBlobs=new Map();
    p.gatedBlobs=new WeakSet();
    URL.createObjectURL=blob=>{
      if(p.rebuildReadFail) blob.arrayBuffer=async()=>{throw new Error('injected arrayBuffer failure');};
      else if(p.readGate && !p.gatedBlobs.has(blob)) {
        p.gatedBlobs.add(blob);
        const read=blob.arrayBuffer.bind(blob);
        blob.arrayBuffer=async()=>{p.entered=true;await new Promise(r=>p.release=r);return read();};
      }
      const url=create(blob);p.created.push(url);p.urlBlobs.set(url,blob);return url;
    };
    URL.revokeObjectURL=url=>{const v=document.querySelector('#pip-video');if(v.getAttribute('src')===url || document.pictureInPictureElement===v && v.currentSrc===url)p.unsafe.push(url);p.revoked.push(url);revoke(url);};
  });
  const ready=()=>page.waitForFunction(()=>document.querySelector('#btn-pip').textContent==='PiPで表示');
  const edit=()=>page.evaluate(()=>{const e=document.querySelector('#memo-content');e.value='same cached body';e.dispatchEvent(new Event('input',{bubbles:true}));});
  await edit(); await page.click('#btn-pip'); await ready();
  assert.equal(await page.evaluate(()=>probe.compared),true);
  const run = async failures => {
    await edit();
    await page.evaluate(n=>{probe.fail=n;probe.urls=[];probe.renders=0;probe.deletes=0;probe.recordPuts=0;},failures);
    await page.click('#btn-pip'); await ready();
    const p=await page.evaluate(()=>probe);
    if (!p.renders) assert.equal(p.recordPuts,0, 'HIT must not put Blob record');
    assert.match(await page.$eval('#log-box',e=>e.textContent), /CACHE HIT ACCESS TOUCH=metadata-only/);
    assert.equal(p.urls[0],p.urls[1]);
    if(failures>=2) assert.notEqual(p.urls[0],p.urls[2]);
    assert.equal(p.renders, failures<4 && !p.rebuildReadFail?0:1);
    assert.equal(p.deletes, failures<4 && !p.rebuildReadFail?0:1);
    await page.click('#btn-pip');
    await page.waitForFunction(()=>document.pictureInPictureElement===document.querySelector('#pip-video'));
    await ready(); await page.evaluate(()=>document.exitPictureInPicture());
  };
  await edit(); await page.evaluate(()=>{probe.urls=[];probe.renders=0;probe.recordPuts=0;});
  await page.click('#btn-pip'); await ready();
  assert.equal(await page.evaluate(()=>probe.renders),0);
  assert.equal(await page.evaluate(()=>probe.recordPuts),0);
  assert.match(await page.$eval('#log-box',e=>e.textContent),/CACHE BLOB EARLY READ OK/);
  console.log('PASS early read success -> normal HIT prepare, render 0 / Blob put 0 (metadata-only touch)');
  await edit(); await page.evaluate(()=>{probe.earlyFail=true;probe.urls=[];probe.renders=0;probe.deletes=0;});
  await page.click('#btn-pip'); await ready();
  assert.equal(await page.evaluate(()=>probe.renders),1);
  assert.equal(await page.evaluate(()=>probe.deletes),1);
  assert.equal(await page.evaluate(()=>probe.urls.length),1); // Only regenerated video prepared.
  assert.match(await page.$eval('#log-box',e=>e.textContent),/CACHE BLOB EARLY READ FAILED.*NotFoundError/);
  await page.evaluate(()=>{probe.earlyFail=false;});
  console.log('PASS early NotFoundError -> no cached URL/prepare -> render fallback');
  for(const mode of ['success','missing']) {
    await edit(); await page.evaluate(mode=>{Object.assign(probe,{refetchMode:mode,gets:0,urls:[],renders:0,deletes:0,recordPuts:0});},mode);
    await page.click('#btn-pip'); await ready();
    assert.equal(await page.evaluate(()=>probe.renders),mode==='success'?0:1);
    assert.equal(await page.evaluate(()=>probe.deletes),mode==='success'?0:1);
    if(mode==='success') {
      assert.equal(await page.evaluate(()=>probe.gets),2);
      assert.equal(await page.evaluate(()=>probe.recordPuts),0);
      assert.match(await page.$eval('#log-box',e=>e.textContent),/CACHE BLOB REFETCH READ OK/);
    }
    console.log('PASS refetch '+mode);
    await page.evaluate(()=>{probe.refetchMode='';});
  }
  for(const mode of ['get-gate','read-gate']) {
    await edit(); await page.evaluate(mode=>{Object.assign(probe,{refetchMode:mode,gets:0,entered:false,urls:[],renders:0,deletes:0});},mode);
    await page.click('#btn-pip'); await page.waitForFunction(()=>probe.entered);
    const created=await page.evaluate(()=>probe.created.length);
    await page.click('#btn-back'); await page.evaluate(()=>probe.release()); await sleep(200);
    assert.equal(await page.evaluate(()=>probe.renders+probe.deletes+probe.urls.length),0);
    assert.equal(await page.evaluate(()=>probe.created.length),created);
    await page.evaluate(()=>{probe.refetchMode='';});
    await page.click('#btn-new');
    console.log('PASS refetch stale '+mode);
  }
  await run(1); console.log('PASS first timeout -> same URL retry -> ready/PiP, render/delete 0');
  await run(2); console.log('PASS two failures -> refreshed URL -> ready/PiP, render/delete 0');
  await run(3); console.log('PASS third failure -> rebuilt Blob -> ready/PiP, render/delete 0');
  await run(4); console.log('PASS rebuilt Blob prepare fails -> fallback');
  await page.evaluate(()=>{probe.rebuildReadFail=true;});
  await run(3); console.log('PASS arrayBuffer rejection -> fallback');
  await page.evaluate(()=>{probe.rebuildReadFail=false;});
  await page.evaluate(()=>{probe.mode='event';});
  await run(1); console.log('PASS actual error listener/code 4 -> retry success/render 0');
  await run(4); console.log('PASS error listener/code 4 four times -> fallback');
  await page.evaluate(()=>{probe.mode='exception';});
  await run(1); console.log('PASS thrown prepare exception -> retry success');
  await page.evaluate(()=>{probe.mode='unspecified';});
  await run(1); console.log('PASS failure without reason -> retry success');
  await page.evaluate(()=>{probe.mode='';});
  await page.click('#btn-pip');
  await page.waitForFunction(()=>document.pictureInPictureElement===document.querySelector('#pip-video'));
  await ready();
  const protectedUrl=await page.$eval('#pip-video',v=>v.src);
  await edit();
  await page.evaluate(()=>{probe.fail=3;probe.urls=[];probe.renders=0;probe.deletes=0;probe.refetchMode='success';probe.gets=0;});
  await page.click('#btn-pip');
  await page.waitForFunction(()=>document.querySelector('#btn-pip').textContent==='PiP終了待ち');
  assert.equal(await page.$eval('#pip-video',v=>v.src),protectedUrl);
  assert.equal(await page.evaluate(()=>probe.urls.length),0);
  assert.equal(await page.evaluate(url=>probe.revoked.includes(url),protectedUrl),false);
  await page.evaluate(()=>document.exitPictureInPicture()); await ready();
  assert.equal(await page.evaluate(()=>probe.renders),0);
  assert.equal(await page.evaluate(()=>probe.deletes),0);
  assert.match(await page.$eval('#log-box',e=>e.textContent),/BLOB REBUILD RECOVERED/);
  await page.evaluate(()=>{probe.refetchMode='';});
  console.log('PASS active PiP protected; refetch recovered;  refresh waits for exit then recovers without render/delete');
  await edit();
  await page.evaluate(()=>{probe.fail=3;probe.readGate=true;probe.entered=false;probe.urls=[];probe.renders=0;probe.deletes=0;});
  await page.click('#btn-pip'); await page.waitForFunction(()=>probe.entered);
  await page.click('#btn-back'); await page.evaluate(()=>probe.release()); await sleep(200);
  const p=await page.evaluate(()=>probe);
  assert.equal(p.urls.length,3); assert.equal(p.renders,0); assert.equal(p.deletes,0);
  assert.deepEqual(p.unsafe,[]); assert.equal(new Set(p.revoked).size,p.revoked.length);
  assert.deepEqual([...p.created].sort(),[...p.revoked].sort());
  await page.click('#btn-new'); await edit();
  await page.evaluate(()=>{probe.readGate=false;probe.fail=0;probe.earlyGate=true;probe.entered=false;probe.urls=[];probe.renders=0;probe.deletes=0;});
  await page.click('#btn-pip'); await page.waitForFunction(()=>probe.entered);
  const createdBefore=await page.evaluate(()=>probe.created.length);
  await page.click('#btn-back'); await page.evaluate(()=>probe.release()); await sleep(200);
  assert.equal(await page.evaluate(()=>probe.created.length),createdBefore);
  assert.equal(await page.evaluate(()=>probe.renders+probe.deletes+probe.urls.length),0);
  console.log('PASS stale during early read -> no URL, prepare, render or delete');
  assert.deepEqual(errors,[]);
  console.log('PASS stale discard, no retry/delete/render, URL create/revoke balanced; Blob bytes/type/size identical');
})().catch(e => { console.error(e, serverError); process.exitCode = 1; })
  .finally(async () => { if (browser) await browser.close(); server.kill(); });
