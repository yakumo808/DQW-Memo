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
  for (const width of [320,390,768,1280]) {
    await page.setViewport({width,height:844});
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.click('#btn-new');
    await page.type('#memo-title','モバイル確認');
    await page.type('#memo-content','攻略メモ\n回復を優先');
    assert.equal(await page.$eval('.debug-panel',e=>e.open),false);
    assert.equal(await page.$eval('#log-box',e=>e.checkVisibility()),false);
    assert.equal(await page.$eval('#status',e=>e.getAttribute('role')),'status');
    for (const id of ['btn-pip','btn-save','btn-back']) {
      const box=await page.$eval('#'+id,e=>({h:e.getBoundingClientRect().height,w:e.getBoundingClientRect().width}));
      assert.ok(box.h>=48 && box.w>=44);
    }
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:path.join(out,`editor-${width}.png`),fullPage:true});
    await page.click('.debug-panel summary');
    assert.equal(await page.$eval('.debug-panel',e=>e.open),true);
    await page.$eval('#log-box',e=>{e.textContent='diagnostic '.repeat(2000);});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.click('.debug-panel summary');
    await page.click('#btn-save');
    await page.waitForSelector('#btn-new');
    await page.click('.memo-item');
    assert.equal(await page.$eval('#memo-content',e=>e.value),'攻略メモ\n回復を優先');
    await page.click('#btn-back'); await page.waitForSelector('#btn-new');
    await page.evaluate(()=>localStorage.clear());
    console.log('PASS width',width,'collapsed/expanded logs, 48px buttons, no overflow, save/reopen/back');
  }
  assert.deepEqual(errors,[]); console.log('ALL PASS screenshots='+out);
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.close();});
