// Run only against an open interactive store window. Captures product/search
// metadata, not request bodies, headers, cookies, or account data.
const fs=require('node:fs'),vm=require('node:vm'),ts=require('../node_modules/typescript');
const context={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('mobile/src/core/StoreSearch.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,context);
const [store,query]=process.argv.slice(2);
(async()=>{
 const pages=await(await fetch('http://127.0.0.1:9224/json')).json();
 const page=pages.find(p=>{try{const d=JSON.parse(p.description);return p.url.includes(store==='instamart'?'swiggy.com':store==='amazon_tez'?'amazon.in/tez':store+'.com')&&d.attached&&d.visible&&d.screenX>=0&&d.screenY>=0;}catch{return false;}});
 if(!page)throw Error('Open the interactive store window first');
 const ws=new WebSocket(page.webSocketDebuggerUrl);let id=0;const pending=new Map();
 await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id);}};
 const call=(method,params)=>new Promise(r=>{pending.set(++id,r);ws.send(JSON.stringify({id,method,params}));});
 try {
  const script=context.exports.storeSearchScript(store,query,987654,'window.__lowpInputProbe.ready = performance.now();');
  await call('Runtime.evaluate',{expression:`window.__lowpInputProbe={start:performance.now(),origin:performance.timeOrigin,messages:[],original:window.ReactNativeWebView.postMessage};window.ReactNativeWebView.postMessage=function(s){const p=JSON.parse(s);if(p.type.startsWith('LOWP_SEARCH_'))window.__lowpInputProbe.messages.push(p);else window.__lowpInputProbe.original(s);};${script}`});
  const samples=[];
  for(let i=0;i<24;i++){
   await new Promise(r=>setTimeout(r,250));
   const r=await call('Runtime.evaluate',{expression:`(()=>{const p=window.__lowpInputProbe;if(!p)return null;const cards=Array.from(document.querySelectorAll('[data-testid="item-collection-card-full"]'));return {ms:Math.round(performance.now()-p.start),query:new URL(location.href).searchParams.get('query'),value:document.querySelector('input[type=search]')?.value,sameDocument:p.origin===performance.timeOrigin,readyMs:p.ready?Math.round(p.ready-p.start):null,messages:p.messages,cards:cards.length,first:cards[0]?.textContent.slice(0,120),alt:cards[0]?.querySelector('img')?.alt}})()`,returnByValue:true});
   samples.push(r.result?.result?.value);
  }
  console.log(JSON.stringify({store,query,samples},null,2));
 }finally{
  await call('Runtime.evaluate',{expression:'window.__lowpWarmSearch?.dispose();if(window.__lowpInputProbe)window.ReactNativeWebView.postMessage=window.__lowpInputProbe.original;true;'});
  ws.close();
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
