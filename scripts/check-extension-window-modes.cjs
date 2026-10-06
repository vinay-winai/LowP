// Live diagnostic in an isolated Chrome profile; does not access user cookies.
const {chromium} = require('playwright');
const fs = require('node:fs');
(async () => {
  const root = process.cwd();
  const context = await chromium.launchPersistentContext('', {channel:'chromium', headless:false,
    args:['--disable-extensions-except='+root,'--load-extension='+root]});
  const report = [];
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const page = await context.newPage();
    await page.goto(`chrome-extension://${worker.url().split('/')[2]}/src/popup/popup.html`);
    const windowId = await page.evaluate(async () => (await chrome.windows.getCurrent()).id);
    for (const state of ['normal','maximized','fullscreen']) {
      await worker.evaluate(async ({windowId,state}) => {
        await chrome.windows.update(windowId,{state,focused:true});
        SearchCache.memory = new Map();
      },{windowId,state});
      const outcome = await worker.evaluate(async windowId => {
        const before=await chrome.windows.get(windowId),start=Date.now();
        const results=await streamSearchResults('milk',null,()=>{},['amazon_tez','instamart','zepto','blinkit','amazon_main','flipkart']);
        const after=await chrome.windows.get(windowId);
        return {before:before.state,after:after.state,elapsedMs:Date.now()-start,
          diagnostics:DEBUG_LOGS.filter(entry=>/error|timeout|failed/i.test(entry.category+' '+entry.message)).slice(0,8).map(entry=>entry.message),
          stores:results.map(r=>({id:r.platformId,available:r.isAvailable,price:r.item?.price,candidates:r.candidates?.length||0,time:r.durationMs}))};
      },windowId);
      report.push(outcome);console.log(JSON.stringify(outcome));
    }
    fs.mkdirSync('output/playwright',{recursive:true});
    fs.writeFileSync('output/playwright/window-modes.json',JSON.stringify(report,null,2));
  } finally {await context.close();}
})().catch(error=>{console.error(error);process.exit(1);});
