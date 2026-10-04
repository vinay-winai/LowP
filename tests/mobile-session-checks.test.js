const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),ts=require('../mobile/node_modules/typescript');
const compile=path=>ts.transpileModule(fs.readFileSync(require.resolve(path),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText;
const sessionContext={exports:{},Date,URL};vm.runInNewContext(compile('../mobile/src/core/StoreSession.ts'),sessionContext);
function harness(saved=null) {
 const hooks=[],effects=[],timers=new Map();let cursor=0,key=0,listener,output;
 const writes=[];
 const react={useRef(initial){const i=cursor++;return hooks[i]||=( {current:initial});},
  useState(initial){const i=cursor++;hooks[i]||={value:typeof initial==='function'?initial():initial};return [hooks[i].value,value=>{hooks[i].value=typeof value==='function'?value(hooks[i].value):value;}];},
  useEffect(fn,deps){const i=cursor++,previous=hooks[i];if(!previous||deps.some((v,j)=>v!==previous.deps[j]))effects.push(()=>{previous?.cleanup?.();hooks[i]={deps,cleanup:fn()};});}};
 const context={exports:{},Date,Math,setTimeout:fn=>{timers.set(++key,fn);return key;},clearTimeout:id=>timers.delete(id),
  require:name=>name==='react'?react:name==='react-native'?{AppState:{currentState:'active',addEventListener:(_,fn)=>{listener=fn;return {remove(){listener=null;}};}}}:name.includes('async-storage')?{getItem:()=>Promise.resolve(saved),setItem:(_,value)=>{writes.push(JSON.parse(value));return Promise.resolve();}}:sessionContext.exports};
 vm.runInNewContext(compile('../mobile/src/core/useSessionChecks.ts'),context);
 const h={blocked:false,launchReady:true,timers,writes,
  render(){cursor=0;output=context.exports.useSessionChecks(h.blocked,h.launchReady);effects.splice(0).forEach(fn=>fn());return output;},
  async flush(){await Promise.resolve();await Promise.resolve();await Promise.resolve();h.render();},
  dispatch(){assert.equal(timers.size,1);const [id,fn]=[...timers][0];timers.delete(id);fn();return h.render();},
  app(state){listener(state);return h.render();},get output(){return output;}};
 return h;
}
test('manual sync checks all five canonical accounts sequentially, with stale-token rejection',async()=>{
 const h=harness();h.render();await h.flush();h.output.refresh();h.render();
 for(const id of ['amazon_main','instamart','zepto','blinkit','flipkart']){
  const current=h.dispatch();assert.equal(current.job.platformId,id);assert.equal(h.timers.size,0);
  current.finish('stale',id,{status:'signed_in',evidence:'logout_control',checkedAt:Date.now()});assert.equal(h.render().job.platformId,id);
  current.finish(current.job.token,id,{status:'unknown',evidence:'none',checkedAt:Date.now()});h.render();
 }
 assert.equal(h.output.job,null);assert.equal(h.timers.size,0);
});
test('search and login-window blocking cancels dispatch and resumes the unfinished store',async()=>{
 const h=harness();h.render();await h.flush();h.output.refresh();h.render();const active=h.dispatch();
 h.blocked=true;assert.equal(h.render().job,null);
 active.finish(active.job.token,'amazon_main',{status:'signed_in',evidence:'logout_control',checkedAt:Date.now()});h.render();
 h.blocked=false;h.render();const resumed=h.dispatch();assert.equal(resumed.job.platformId,'amazon_main');assert.notEqual(resumed.job.token,active.job.token);
});
test('backgrounding pauses checks and foregrounding resumes them',async()=>{
 const h=harness();h.render();await h.flush();h.output.refresh();h.render();const first=h.dispatch();
 assert.equal(h.app('background').job,null);h.render();assert.equal(h.timers.size,0);
 h.app('active');const next=h.dispatch();assert.equal(next.job.platformId,first.job.platformId);
});
test('fresh saved evidence restores without launch checks, and manual/interactive evidence mirrors Amazon',async()=>{
 const h=harness(JSON.stringify({amazon_main:{status:'signed_in',evidence:'logout_control',checkedAt:Date.now()}}));
 h.render();await h.flush();assert.equal(h.output.sessions.amazon_tez.status,'signed_in');assert.equal(h.timers.size,0);assert.equal(h.output.pendingCount,0);h.output.refresh();h.render();
 const active=h.dispatch();assert.equal(active.job.platformId,'amazon_main');
 active.observe('amazon_tez',{status:'signed_out',evidence:'login_control',checkedAt:Date.now()});h.render();await h.flush();h.output.refresh();h.render();
 assert.equal(h.output.sessions.amazon_main.status,'signed_out');assert.equal(h.writes.at(-1).sessions.amazon_tez.status,'signed_out');
 assert.equal(h.dispatch().job.platformId,'instamart');
});

test('foreground return does not automatically queue expired account checks',async()=>{
 const h=harness();h.render();await h.flush();h.output.refresh();h.render();
 for(const id of ['amazon_main','instamart','zepto','blinkit','flipkart']){
  const current=h.dispatch();current.finish(current.job.token,id,{status:'unknown',evidence:'none',checkedAt:Date.now()});h.render();
 }
 h.app('background');h.app('active');assert.equal(h.timers.size,0);
 h.output.setSessions(previous=>({...previous,blinkit:{status:'signed_out',evidence:'login_form',checkedAt:Date.now()-sessionContext.exports.SESSION_TTL_MS}}));h.render();
 h.app('background');h.app('active');assert.equal(h.timers.size,0);assert.equal(h.output.pendingCount,0);
});

test('render and storage readiness gate manual dispatch and a search cancels a queued dispatch',async()=>{
 const h=harness();h.launchReady=false;h.render();await h.flush();h.output.refresh();h.render();assert.equal(h.timers.size,0);
 h.launchReady=true;h.render();assert.equal(h.timers.size,1);
 h.blocked=true;h.render();assert.equal(h.timers.size,0);
 h.blocked=false;h.render();assert.equal(h.dispatch().job.platformId,'amazon_main');
});

test('saved status survives pending checks and passive observations; date advances only when manual sync completes',async()=>{
 const old=Date.now()-14*24*60*60*1000;
 const h=harness(JSON.stringify({lastSyncedAt:old,sessions:{amazon_main:{status:'signed_in',evidence:'logout_control',checkedAt:old}}}));
 h.render();await h.flush();assert.equal(h.output.lastSyncedAt,old);
 h.output.observe('amazon_main',{status:'signed_out',evidence:'login_control',checkedAt:Date.now()});h.render();assert.equal(h.output.sessions.amazon_main.status,'signed_in');
 h.output.refresh();h.render();
 for(const id of ['amazon_main','instamart','zepto','blinkit','flipkart']){
  const current=h.dispatch();assert.equal(current.lastSyncedAt,old);
  if(id==='amazon_main')assert.equal(h.writes.at(-1).sessions.amazon_main.status,'signed_in');
  current.finish(current.job.token,id,{status:'signed_out',evidence:'login_form',checkedAt:Date.now()});h.render();
 }
 h.render();assert.ok(h.output.lastSyncedAt>old);assert.equal(h.writes.at(-1).lastSyncedAt,h.output.lastSyncedAt);
 const restored=harness(JSON.stringify(h.writes.at(-1)));restored.render();await restored.flush();assert.equal(restored.output.lastSyncedAt,h.output.lastSyncedAt);assert.equal(restored.output.sessions.amazon_tez.status,'signed_out');
});

test('manual sync rechecks all accounts, reports progress, and waits for an active search',async()=>{
 const h=harness();h.render();await h.flush();h.output.refresh();h.render();
 for(const id of ['amazon_main','instamart','zepto','blinkit','flipkart']){
  const current=h.dispatch();current.finish(current.job.token,id,{status:'unknown',evidence:'none',checkedAt:Date.now()});h.render();
 }
 assert.equal(h.output.syncing,false);assert.equal(h.output.pendingCount,0);
 h.blocked=true;h.output.refresh();h.render();assert.equal(h.output.syncing,false);assert.equal(h.output.paused,true);assert.equal(h.output.pendingCount,5);assert.equal(h.timers.size,0);
 h.output.refresh();h.render();assert.equal(h.output.pendingCount,5);
 h.blocked=false;h.render();assert.equal(h.output.syncing,true);const first=h.dispatch();assert.equal(first.job.platformId,'amazon_main');
 first.finish(first.job.token,'amazon_main',{status:'signed_in',evidence:'logout_control',checkedAt:Date.now()});h.render();assert.equal(h.output.pendingCount,4);
});
