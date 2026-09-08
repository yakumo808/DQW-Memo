// Isolated browser storage and static server; no render or user data mutations.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const puppeteer = require('puppeteer-core');
const root = path.resolve(__dirname, '..');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'dqw-mobile-ui-'));
const server = http.createServer((req,res) => {
  const name = path.resolve(root, '.' + (req.url === '/' ? '/index.html' : req.url.split('?')[0]));
  if (!name.startsWith(root + path.sep)) {res.writeHead(403).end(); return;}
  fs.readFile(name, (err, data) => {
    if (err) {res.writeHead(404).end(); return;}
    res.setHeader('Content-Type', ({'.js':'text/javascript','.css':'text/css','.html':'text/html','.mp4':'video/mp4'})[path.extname(name)] || 'application/octet-stream');
    res.end(data);
  });
});
let browser;
(async () => {
  await new Promise(r => server.listen(0,'127.0.0.1',r));
  browser = await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:true});
  const page = await browser.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  const seed = async count => {
    await page.evaluate(n => localStorage.setItem('dqw_memo_data',JSON.stringify(Array.from({length:n},(_,i)=>({id:String(i),title:'メモ'+i,content:'本文'+i,updated:new Date(1700000000000-i*1000).toISOString()})))),count);
    await page.reload();
  };
  const drag = async (index, dx, dy=0) => {
    const box = await (await page.$$('.memo-front'))[index].boundingBox();
    await page.mouse.move(box.x+box.width-30,box.y+25);
    await page.mouse.down(); await page.mouse.move(box.x+box.width-30+dx,box.y+25+dy,{steps:8}); await page.mouse.up();
    await new Promise(r=>setTimeout(r,200));
  };
  for (const width of [320,390,1280]) {
    await page.setViewport({width,height:844});
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await seed(3);
    assert.equal(await page.$eval('.dev-version',e=>e.textContent),'v0.8.3.2-dev');
    assert.ok(await page.$eval('.dev-version',e=>e.getBoundingClientRect().right<=innerWidth));
    await drag(0,-100);
    assert.equal(await page.$$eval('.delete-open',a=>a.length),1);
    assert.equal(await page.$$eval('.memo-item',a=>a.length),3);
    await drag(0,100);
    assert.equal(await page.$$eval('.delete-open',a=>a.length),0);
    await drag(0,-100);
    await page.click('.memo-item:nth-child(2) .memo-front');
    await page.waitForSelector('#btn-back'); await page.click('#btn-back');
    assert.equal(await page.$$eval('.delete-open',a=>a.length),0);
    await drag(0,4,60);
    assert.equal(await page.$$eval('.delete-open',a=>a.length),0);
    for (const index of [0,1,2]) {
      await seed(3); await drag(index,-100);
      await page.click('.delete-open .memo-delete');
      assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('dqw_memo_data')).map(m=>m.id)),['0','1','2'].filter(id=>id!==String(index)));
      assert.equal(await page.$$eval('.memo-item',a=>a.length),2);
    }
    await seed(1); await drag(0,-100); await page.click('.memo-delete');
    assert.equal(await page.$$eval('.memo-item',a=>a.length),0);
    assert.equal(await page.evaluate(async()=> (await import('/app/js/core/app_state.js')).state.selectedMemo), null);
    await page.click('#btn-new'); await page.type('#memo-title','削除後作成'); await page.type('#memo-content','新本文');
    await page.click('#btn-save'); await page.click('.memo-front');
    assert.equal(await page.$eval('#memo-content',e=>e.value),'新本文');
    await page.click('#btn-back');
    await seed(3);
    await page.focus('.memo-front'); await page.keyboard.press('ArrowLeft');
    assert.equal(await page.$$eval('.delete-open',a=>a.length),1);
    await page.keyboard.press('Escape'); assert.equal(await page.$$eval('.delete-open',a=>a.length),0);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    console.log('PASS swipe, close, vertical gesture, first/middle/last/only deletion, create/edit, keyboard, width',width);
  }
  // Real touch input through Chrome DevTools, with a scrollable list.
  await page.setViewport({width:390,height:600,isMobile:true,hasTouch:true});
  await seed(30);
  const cdp = await page.createCDPSession();
  const touch = async (dx,dy) => {
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:260,y:230}]});
    for(let i=1;i<=8;i++) await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:260+dx*i/8,y:230+dy*i/8}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await new Promise(r=>setTimeout(r,250));
  };
  await touch(-110,0); assert.equal(await page.$$eval('.delete-open',a=>a.length),1);
  await page.reload(); await touch(0,-150);
  assert.ok(await page.evaluate(()=>scrollY>0));
  assert.equal(await page.$$eval('.delete-open',a=>a.length),0);
  console.log('PASS actual Chrome touch horizontal swipe and native vertical scroll');
  await page.reload();
  const cancellation = await page.evaluate(() => {
    const front = document.querySelector('.memo-front');
    const send = (type,x,y) => {
      const t = new Touch({identifier:7,target:front,clientX:x,clientY:y});
      const event = new TouchEvent(type,{bubbles:true,cancelable:true,touches:type==='touchend'?[]:[t],changedTouches:[t]});
      front.dispatchEvent(event); return event.defaultPrevented;
    };
    send('touchstart',200,200);
    front.dispatchEvent(new PointerEvent('pointercancel',{pointerType:'touch',bubbles:true}));
    const horizontal = send('touchmove',160,202);
    const opened = front.parentElement.classList.contains('delete-open');
    send('touchend',160,202);
    send('touchstart',160,200); send('touchmove',200,200); send('touchend',200,200);
    const closed = !front.parentElement.classList.contains('delete-open');
    send('touchstart',200,200);
    const vertical = send('touchmove',202,150);
    send('touchend',202,150);
    return {horizontal,vertical,opened,closed};
  });
  assert.deepEqual(cancellation,{horizontal:true,vertical:false,opened:true,closed:true});
  console.log('PASS touch path survives pointercancel; horizontal prevents default, vertical does not');

  assert.deepEqual(errors,[]); console.log('ALL PASS; pageErrors=0');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.close();});
