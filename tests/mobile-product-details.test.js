const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('../mobile/node_modules/typescript');
const compile=file=>ts.transpileModule(fs.readFileSync(require.resolve(file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const titleContext={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../mobile/src/core/TitleText.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,titleContext);
const matching={exports:{},require:()=>titleContext.exports};vm.runInNewContext(compile('../mobile/src/core/MatchingEngine.ts'),matching);const engine=matching.exports.MatchingEngine;
function harness(fetch){const context={exports:{},require:()=>({MatchingEngine:engine}),fetch,URL,AbortController,setTimeout,clearTimeout,Date};vm.runInNewContext(compile('../mobile/src/core/ProductDetails.ts'),context);return context.exports.enrichFlipkartQuantities;}
const item=(id,quantity='')=>({id,title:'Potato',quantity,productUrl:`https://www.flipkart.com/potato/p/${id}?pid=${id}&amp;lid=tracking`});
test('quantity comes from labelled product highlights rather than recommendations',()=>{
 assert.equal(engine.extractDetailQuantity('<div>Recommended 500 g</div><div>Quantity</div><div>2 kg</div>'),'2 kg');
 assert.equal(engine.extractDetailQuantity('<script>Quantity 5 kg</script><div>Recently viewed Potato 500g</div>'),'');
 const live=JSON.parse(fs.readFileSync('mobile/benchmarks/flipkart-potato-highlights.json','utf8'));
 assert.equal(engine.extractDetailQuantity(live.quantityNodes[0].html),'2 kg');
});
test('missing Flipkart size enriches from details, canonicalizes URL and caches the result',async()=>{
 const requests=[],updates=[];const enrich=harness(async url=>{requests.push(url);return{ok:true,text:async()=>'<div>Product highlights</div><div>Quantity</div><div>2 kg</div>'}});
 const signal=new AbortController().signal;
 await enrich([item('LIVE1')],signal,(i,q)=>updates.push(q));
 await enrich([item('LIVE1')],signal,(i,q)=>updates.push(q));
 assert.equal(requests.length,1);assert.equal(requests[0],'https://www.flipkart.com/potato/p/LIVE1?pid=LIVE1');assert.deepEqual(updates,['2 kg','2 kg']);
});
test('known quantities and non Flipkart pages never trigger detail requests',async()=>{
 const enrich=harness(()=>{throw new Error('unexpected fetch')});
 await enrich([item('KNOWN','1 kg'),{...item('WRONG'),productUrl:'https://example.com/p/test'}],new AbortController().signal,()=>assert.fail('unexpected update'));
});
test('aborting a replaced search prevents late metadata updates',async()=>{
 let respond;const enrich=harness(()=>new Promise(resolve=>respond=resolve));const controller=new AbortController();let updates=0;
 const pending=enrich([item('STALE')],controller.signal,()=>updates++);controller.abort();respond({ok:true,text:async()=>'<div>Quantity</div><div>2 kg</div>'});await pending;assert.equal(updates,0);
});
