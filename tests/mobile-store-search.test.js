const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('../mobile/node_modules/typescript');
const moduleContext={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('mobile/src/core/StoreSearch.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,moduleContext);
function page({missing=false}={}) {
 let now=0, timer, cards, scanned=0;
 const messages=[], events=[], old={isConnected:true}; cards=[old];
 class Input {get value(){return this.v || '';} set value(v){this.v=v;} focus(){} dispatchEvent(e){events.push(e.type);}}
 const input=new Input(), location={href:'https://www.zepto.com/search?query=paneer'};
 const window={ReactNativeWebView:{postMessage:s=>messages.push(JSON.parse(s))}};
 const context={window,location,URL,HTMLInputElement:Input,Event:class{constructor(type){this.type=type;}},KeyboardEvent:class{constructor(type){this.type=type;}},
  Date:{now:()=>now},setTimeout:fn=>(timer=fn,1),clearTimeout:()=>timer=null,
  document:{querySelector:()=>missing?null:input,querySelectorAll:()=>cards},scan:()=>scanned++};
 vm.runInNewContext(moduleContext.exports.storeSearchScript('zepto','butter',2,'scan();'),context);
 return {messages,events,window,old,location,get scanned(){return scanned;},replace(){old.isConnected=false;cards=[{isConnected:true}];},tick(ms=100){now+=ms;const fn=timer;timer=null;fn?.();}};
}
test('warm search waits for old cards to detach and the requested URL before scraping',()=>{
 const p=page();assert.deepEqual(p.events,['input','change','keydown','keyup']);
 p.location.href='https://www.zepto.com/search?query=butter';p.tick(500);assert.equal(p.scanned,0);
 p.replace();p.tick();p.tick(400);assert.equal(p.scanned,1);
 assert.equal(p.messages[0].type,'LOWP_SEARCH_READY');assert.equal(p.window.__lowpSkipInitialSearchData,true);
});
test('old URL, missing controls, and unchanged cards fall back without returning old products',()=>{
 for(const mode of ['missing','old-url','unchanged']) {
  const p=page({missing:mode==='missing'});
  if(mode==='old-url')p.replace();
  if(mode==='unchanged')p.location.href='https://www.zepto.com/search?query=butter';
  p.tick(2800);assert.equal(p.scanned,0);assert.equal(p.messages[0].type,'LOWP_SEARCH_FALLBACK');
 }
});
test('disposing a superseded warm search prevents callbacks and extraction',()=>{
 const p=page();p.window.__lowpWarmSearch.dispose();p.replace();p.tick(2000);
 assert.equal(p.messages.length,0);assert.equal(p.scanned,0);
});
