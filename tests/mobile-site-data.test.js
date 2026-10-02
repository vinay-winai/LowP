const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('../mobile/node_modules/typescript');
const compile=file=>ts.transpileModule(fs.readFileSync(require.resolve(file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const session={exports:{},URL,Date};vm.runInNewContext(compile('../mobile/src/core/StoreSession.ts'),session);

test('Amazon.in location status and freshness mirror to Now, which cannot override it',()=>{
 const update=session.exports.updateStoreLocation,now=Date.now();
 let state=update({},'amazon_main',{status:'set',checkedAt:now});
 assert.equal(state.amazon_tez.status,'set');assert.equal(state.amazon_tez.checkedAt,now);
 state=update(state,'amazon_main',{status:'needed',checkedAt:now+1});assert.equal(state.amazon_tez.status,'needed');
 state=update({},'amazon_tez',{status:'needed',checkedAt:now});
 state=update(state,'amazon_main',{status:'set',checkedAt:now});assert.equal(state.amazon_tez.status,'set');
 state=update(state,'amazon_tez',{status:'needed',checkedAt:now});assert.equal(state.amazon_tez.status,'set');
 const expired={amazon_main:{status:'set',checkedAt:now-6*60*1000}};
 assert.equal(update(expired,'amazon_tez',{status:'unknown',checkedAt:now}).amazon_tez.checkedAt,expired.amazon_main.checkedAt);
 const unknown=update({},'amazon_main',{status:'unknown',checkedAt:now});assert.equal(unknown.amazon_tez.status,'unknown');
 const zepto={zepto:{status:'set',checkedAt:now}};
 assert.equal(update(zepto,'zepto',{status:'unknown',checkedAt:now}),zepto);
});
test('location bridge validates independently of account state and never trusts a filled address message',()=>{
 const p={type:'LOWP_LOCATION',platformId:'zepto',token:'current',url:'https://www.zepto.com/',status:'set'};
 const read=patch=>session.exports.readLocationMessage(JSON.stringify({...p,...patch}),'zepto','current','https://www.zepto.com/');
 assert.equal(read({}).status,'set');assert.equal(read({token:'old'}),null);assert.equal(read({status:'filled'}),null);
 assert.equal(read({url:'http://www.zepto.com/'}),null);
});

test('location detector recognizes selected addresses, empty controls and missing cues independently of login',()=>{
 function run(id,text) {
  const sent=[];const el={textContent:text,closest:()=>null,getClientRects:()=>[{width:120,height:40}]};
  vm.runInNewContext(session.exports.locationObserverScript(id,'token'),{
   window:{addEventListener(){},removeEventListener(){},ReactNativeWebView:{postMessage:raw=>sent.push(JSON.parse(raw))}},
   document:{querySelectorAll:()=>text?[el]:[]},location:{href:'https://www.zepto.com/'},
   getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1'}),clearInterval(){}});
  return sent[0].status;
 }
 assert.equal(run('zepto','Hydernagar - Hyderabad'),'set');assert.equal(run('zepto','Select Location'),'needed');
 assert.equal(run('zepto',''),'unknown');assert.equal(run('amazon_main','Deliver to'),'needed');
 assert.equal(run('amazon_main','Hyderabad 500085'),'set');assert.equal(run('amazon_main','Sign in'),'unknown');
 assert.equal(run('instamart','Hydernagar, Hyderabad'),'set');
 assert.equal(run('instamart','Select your address'),'needed');
 assert.equal(run('instamart',''),'unknown');
});
