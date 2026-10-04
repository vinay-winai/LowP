const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('../mobile/node_modules/typescript');
const moduleContext={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('mobile/src/core/StoreSearch.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,moduleContext);
function page({missing=false,platform='zepto',form=true}={}) {
 let now=0, timer, cards, scanned=0;
 const messages=[], events=[], old={isConnected:true,identity:'Paneer',querySelector(){return {getAttribute:()=>this.identity};}}; cards=[old];
 class Input {get value(){return this.v || '';} set value(v){this.v=v;} focus(){} dispatchEvent(e){events.push(e.type);}}
 const urls={zepto:'https://www.zepto.com/search?query=paneer',instamart:'https://www.swiggy.com/instamart/search?query=paneer',amazon_tez:'https://www.amazon.in/tez/browse/search?searchKeyword=paneer',blinkit:'https://blinkit.com/s/?q=paneer'};
 const input=new Input(), location={href:urls[platform]};
 if(form)input.form={requestSubmit(){events.push('submit');}};
 const window={ReactNativeWebView:{postMessage:s=>messages.push(JSON.parse(s))}};
 const context={window,location,URL,HTMLInputElement:Input,Event:class{constructor(type){this.type=type;}},KeyboardEvent:class{constructor(type){this.type=type;}},
  Date:{now:()=>now},setTimeout:fn=>(timer=fn,1),clearTimeout:()=>timer=null,
  document:{querySelector:()=>missing?null:input,querySelectorAll:()=>cards},scan:()=>scanned++};
 vm.runInNewContext(moduleContext.exports.storeSearchScript(platform,'butter',2,'scan();'),context);
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
test('Swiggy and Amazon Now submit their search form after input state commits',()=>{
 for(const platform of ['instamart','amazon_tez']){
  const p=page({platform});assert.deepEqual(p.events,['input','change']);
  p.tick();assert.deepEqual(p.events,['input','change','submit']);
  p.location.href=p.location.href.replace('paneer','butter');p.replace();p.tick();p.tick(400);
  assert.equal(p.scanned,1);
 }
});
test('missing search forms fall back; cancellation before submit never submits',()=>{
 for(const platform of ['instamart','amazon_tez']){
  const p=page({platform,form:false});assert.equal(p.messages[0].type,'LOWP_SEARCH_FALLBACK');assert.deepEqual(p.events,[]);
  const cancelled=page({platform});cancelled.window.__lowpWarmSearch.dispose();cancelled.tick();assert.deepEqual(cancelled.events,['input','change']);
 }
});
test('Blinkit uses input and Enter events without submitting an unrelated form',()=>{
 const p=page({platform:'blinkit'});assert.deepEqual(p.events,['input','change','keydown','keyup']);
 p.location.href=p.location.href.replace('paneer','butter');p.replace();p.tick();p.tick(400);assert.equal(p.scanned,1);
});
test('Swiggy reused containers require changed product identity, not a price or badge update',()=>{
 const p=page({platform:'instamart'});p.tick();p.location.href=p.location.href.replace('paneer','butter');
 p.old.textContent='Paneer new price and delivery time';p.tick();p.tick(400);assert.equal(p.scanned,0);
 p.old.identity='Butter';p.tick();p.tick(400);assert.equal(p.scanned,1);
});
test('query verification tolerates store casing and spacing normalization',()=>{
 const p=page();p.location.href='https://www.zepto.com/search?query=%20BUTTER%20';p.replace();p.tick();p.tick(400);assert.equal(p.scanned,1);
});
test('Amazon form encoding is decoded once without accepting another query',()=>{
 const p=page({platform:'amazon_tez'});p.tick();p.replace();
 p.location.href='https://www.amazon.in/tez/browse/search?searchKeyword=%2562utter';p.tick();p.tick(400);assert.equal(p.scanned,1);
 const stale=page({platform:'amazon_tez'});stale.tick();stale.replace();
 stale.location.href='https://www.amazon.in/tez/browse/search?searchKeyword=%2570aneer';stale.tick(2800);assert.equal(stale.scanned,0);
});
