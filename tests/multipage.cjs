// Real Chrome/Python/ffmpeg, isolated browser and job directory. See devlog for setup.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const puppeteer = require('puppeteer-core');
const port = Number(process.env.TEST_PORT || 18787);
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
  await page.evaluate(()=>{window.renders=0;const original=fetch;window.fetch=(...args)=>{if(args[0]==='/api/render')renders++;return original(...args);};});
  const prepare=async()=>{await page.click('#btn-pip');await page.waitForFunction(()=>document.querySelector('#btn-pip').textContent==='PiPで表示');};
  const edit=async content=>page.$eval('#memo-content',(e,c)=>{e.value=c;e.dispatchEvent(new Event('input',{bubbles:true}));},content);
  assert.equal(await page.$eval('#page-seconds',e=>e.value),'3');
  await edit('1T：防御\n--- page ---\n2T：攻撃');await prepare();
  assert.ok(Math.abs(await page.$eval('#pip-video',v=>v.duration)-6)<.2);
  await page.click('#btn-pip');await page.waitForFunction(()=>!!document.pictureInPictureElement);
  assert.equal(await page.$eval('#pip-video',v=>v.loop),true);
  await page.$eval('#pip-video',v=>v.pause());const paused=await page.$eval('#pip-video',v=>v.currentTime);await sleep(350);
  assert.equal(await page.$eval('#pip-video',v=>v.currentTime),paused);
  await page.$eval('#pip-video',v=>v.play());await sleep(350);assert.ok(await page.$eval('#pip-video',v=>v.currentTime)>paused);
  await page.$eval('#pip-video',v=>{v.currentTime=v.duration-.15;});await sleep(450);assert.ok(await page.$eval('#pip-video',v=>v.currentTime)<1);
  await page.evaluate(()=>document.exitPictureInPicture());
  await edit('1T：防御\n--- page ---\n2T：攻撃');await prepare();assert.equal(await page.evaluate(()=>renders),1);
  for(const seconds of ['2','4','5']){await page.select('#page-seconds',seconds);await prepare();assert.ok(Math.abs(await page.$eval('#pip-video',v=>v.duration)-Number(seconds)*2)<.2);}
  await edit(Array(7).fill('本文').join('\n--- page ---\n'));const count=await page.evaluate(()=>renders);
  await page.click('#btn-pip');await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('6ページ'));assert.equal(await page.evaluate(()=>renders),count);
  await page.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.copied=text;}}});});
  await page.click('#copy-page');assert.equal(await page.evaluate(()=>copied),'--- page ---');
  await page.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined});document.execCommand=()=>{window.copied=document.querySelector('body > textarea').value;return true;};});
  await page.click('#copy-page');assert.equal(await page.evaluate(()=>copied),'--- page ---');
  const api=await page.evaluate(async()=>{const r=await fetch('/api/render',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:'',content:Array(7).fill('a').join('\n--- page ---\n'),pageSeconds:3})});return {status:r.status,body:await r.json()};});
  assert.equal(api.status,400);assert.ok(api.body.message.includes('6ページ'));
  await edit('秒数stale');
  await page.evaluate(async()=>{const {VideoCache}=await import('/app/js/core/video_cache.js');const get=VideoCache.prototype.getVideo;window.entered=false;VideoCache.prototype.getVideo=async function(...a){VideoCache.prototype.getVideo=get;window.entered=true;await new Promise(r=>window.release=r);return get.apply(this,a);};});
  await page.click('#btn-pip');await page.waitForFunction(()=>entered);const before=await page.evaluate(()=>renders);
  await page.select('#page-seconds','2');await page.evaluate(()=>release());await sleep(200);assert.equal(await page.evaluate(()=>renders),before);assert.equal(await page.$eval('#btn-pip',e=>e.textContent),'動画を準備');
  await page.click('#btn-save');await page.click('.memo-front');assert.equal(await page.$eval('#page-seconds',e=>e.value),'2');
  for(const width of [320,390,1280]){await page.setViewport({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
  assert.deepEqual(errors,[]);console.log('PASS pages duration/cache/seconds invalidation/PiP pause-resume/manual limit/copy/mobile widths');
})().catch(e=>{console.error(e,serverError);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.kill();});
