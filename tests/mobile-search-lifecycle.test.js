const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('../mobile/node_modules/typescript');
const titleContext={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../mobile/src/core/TitleText.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,titleContext);
const matchingContext = {exports:{},require:()=>titleContext.exports};

const sessionContext = {exports:{}, URL, Date};
const storeSearchContext = {exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../mobile/src/core/StoreSearch.ts'),'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText, storeSearchContext);
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../mobile/src/core/StoreSession.ts'),'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText, sessionContext);
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../mobile/src/core/MatchingEngine.ts'),'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText, matchingContext);

test('search ranking discounts description-only matches while retaining suffix quantities',()=>{
 const engine=matchingContext.exports.MatchingEngine;
 assert.ok(engine.scoreRelevance('Quaker Oats - wholesome daily breakfast','quaker oats') > engine.scoreRelevance('Daily Breakfast - made with Quaker Oats','quaker oats'));
 assert.ok(engine.scoreRelevance('Milk - 500 ml','milk 500 ml') > engine.scoreRelevance('Milk - 200 ml','milk 500 ml'));
 assert.ok(engine.scoreRelevance('Oats - wholesome breakfast','breakfast') > 0);
 assert.equal(engine.scoreRelevance('Sugar-free Oats','sugar free oats'),engine.scoreRelevance('Sugar free Oats','sugar free oats'));
});

// Exercise the component's actual effects and WebView callbacks without
// loading store websites. A small hook runtime lets each phase be committed.
function harness() {
  const hooks = [], timers = new Map(), timerDurations = new Map(), results = [], effects = [];
  const http = [];
  const injections = [];
  const reloads = [];
  const sessionResults = [];
  let cursor = 0, timerId = 0;
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useRef(initial) { const i = cursor++; return hooks[i] ||= { current: initial }; },
    useState(initial) { const i = cursor++; if (!hooks[i]) hooks[i] = { value: initial };
      return [hooks[i].value, value => { hooks[i].value = typeof value === 'function' ? value(hooks[i].value) : value; }]; },
    useEffect(fn, deps) { const i = cursor++, previous = hooks[i];
      if (!previous || deps.some((value, index) => value !== previous.deps[index])) {
        effects.push(() => { previous?.cleanup?.(); hooks[i] = { deps, cleanup: fn() }; });
      }
    }
  };
  const context = { exports: {}, console: { log() {} }, __DEV__: false, AbortController, Date,
    setTimeout: (fn, ms) => { timers.set(++timerId, fn); timerDurations.set(timerId, ms); return timerId; }, clearTimeout: id => {timers.delete(id);timerDurations.delete(id);},
    fetch: url => new Promise(resolve => http.push({ url, resolve })),
    require: name => name === 'react' ? react : name === 'react-native'
      ? { View: 'View', StyleSheet: { create: x => x } }
      : name === 'react-native-webview' ? { WebView: 'WebView' }
      : name.includes('ScraperScript') ? { generateScraperScript: () => 'script' }
      : name.includes('StoreSession') ? sessionContext.exports
      : name.includes('StoreSearch') ? storeSearchContext.exports
      : { MatchingEngine: { extractQuantity: matchingContext.exports.MatchingEngine.extractQuantity, extractCardQuantity: matchingContext.exports.MatchingEngine.extractCardQuantity.bind(matchingContext.exports.MatchingEngine), cleanSearchTerm: x => x, scoreRelevance: () => 70, applyTitleLengthBonus() {} } }
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../mobile/src/components/BackgroundScrapers.tsx'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true, target: ts.ScriptTarget.ES2020 }
  }).outputText, context);
  const props = { searchQuery: 'paneer', searchId: 1, enabled: true,
    maxConcurrentWebViews: 6,
    activeStoreIds: ['amazon_tez', 'instamart', 'zepto', 'blinkit', 'amazon_main', 'flipkart'],
    onStoreResult: (...args) => results.push(args) };
  function render() {
    cursor = 0;
    const root = context.exports.BackgroundScrapers(props);
    const views = root?.props.children.flat().filter(Boolean) || [];
    views.forEach(view => view.props.ref({ reload() {reloads.push(view.props.key);}, stopLoading() {},
      injectJavaScript(script) { injections.push({ store: view.props.key, script }); } }));
    effects.splice(0).forEach(fn => fn());
    return views;
  }
  const message = (view, id = props.searchId) => view.props.onMessage({ nativeEvent: { data: JSON.stringify({
    type: 'SCRAPE_RESULT', searchId: id, platformId: view.props.key, success: true,
    data: { title: 'Paneer', price: 100 }, candidates: [{ title: 'Paneer', price: 100 }]
  }) } });
  const sessionMessage = (view, token, status='signed_in', evidence='logout_control', url='https://www.zepto.com') => view.props.onMessage({nativeEvent:{data:JSON.stringify({type:'LOWP_SESSION',platformId:view.props.key,token,status,evidence,url})}});
  props.onSessionCheckResult = (...args) => sessionResults.push(args);
  return { props, results, timers, timerDurations, render, message, http, injections, reloads, sessionResults, sessionMessage };
}

test('all six stores start together, reuse keys, and reject superseded results', () => {
  const h = harness();
  h.props.limitMode = 'extraction';
  let views = h.render();
  assert.equal(views.length, 6);
  assert.ok(views.every(view => view.props.javaScriptEnabled));
  views.forEach(view => h.message(view));
  views = h.render();
  assert.equal(views.length, 6);
  assert.ok(views.every(view => !view.props.javaScriptEnabled));
  assert.equal(h.results.length, 6);
  const keys = views.map(view => view.props.key);
  h.props.searchQuery = 'butter'; h.props.searchId = 2;
  views = h.render();
  assert.deepEqual(views.map(view => view.props.key), keys);
  assert.ok(views.every(view => view.props.source.uri.includes('butter')));
  assert.ok(views.every(view => view.props.javaScriptEnabled));
  views.forEach(view => h.message(view, 1));
  assert.equal(h.results.length, 6);
  views.slice(0, 4).forEach(view => h.message(view));
  views = h.render();
  assert.ok(views.slice(4).every(view => view.props.source.uri.includes('butter')));
  views.slice(4).forEach(view => h.message(view));
  assert.equal(h.results.length, 12);
  h.props.enabled = false; h.props.searchId = 3; h.props.searchQuery = 'cached rice';
  views = h.render();
  assert.ok(views.every(view => view.props.source.uri.includes('butter')));
  assert.equal(h.timers.size, 0);
});

test('warm search keeps the source, rejects premature results and stale readiness, then accepts new results',()=>{
 const h=harness();h.props.activeStoreIds=['zepto'];let view=h.render()[0];h.message(view);h.render();
 const uri=view.props.source.uri;
 h.props.searchId=2;h.props.searchQuery='butter';view=h.render()[0];
 assert.equal(view.props.source.uri,uri);assert.equal(view.props.injectedJavaScript.endsWith('true;'),true);
 h.message(view);assert.equal(h.results.length,1);
 const ready=id=>view.props.onMessage({nativeEvent:{data:JSON.stringify({type:'LOWP_SEARCH_READY',platformId:'zepto',searchId:id})}});
 ready(1);h.message(view);assert.equal(h.results.length,1);
 ready(2);h.message(view);assert.equal(h.results.length,2);
});

test('native warm-search watchdog restores navigation and disables repeated failed attempts',()=>{
 const h=harness();h.props.activeStoreIds=['zepto'];let view=h.render()[0];h.message(view);h.render();
 h.props.searchId=2;h.props.searchQuery='butter';view=h.render()[0];
 const fire=ms=>{const entry=[...h.timerDurations].find(([id,d])=>d===ms&&h.timers.has(id));assert.ok(entry);h.timers.get(entry[0])();};
 fire(100);fire(3200);view=h.render()[0];assert.ok(view.props.source.uri.includes('butter'));
 h.message(view);h.render();h.props.searchId=3;h.props.searchQuery='milk';view=h.render()[0];
 assert.ok(view.props.source.uri.includes('milk'));
});

test('validated login-gated results release the slot and preserve the sign-in reason',()=>{
 const h=harness();h.props.maxConcurrentWebViews=3;const views=h.render();
 const view=views.find(v=>v.props.key==='instamart');
 const event=id=>({nativeEvent:{data:JSON.stringify({type:'SCRAPE_RESULT',searchId:id,platformId:'instamart',success:false,candidates:[],debug:{reason:'login_required'}})}});
 view.props.onMessage(event(h.props.searchId-1));assert.equal(h.results.length,0);
 view.props.onMessage(event(h.props.searchId));
 assert.equal(h.results.length,1);assert.equal(h.results[0][1],null);assert.equal(h.results[0][4],'login_required');
 view.props.onMessage(event(h.props.searchId));assert.equal(h.results.length,1);
});

test('quick-store timeout does not discard big-store results', () => {
  const h = harness();
  h.render();
  assert.equal(h.timers.size, 6);
  [...h.timers.values()].slice(0, 4).forEach(fn => fn());
  assert.equal(h.results.length, 4);
  const views = h.render();
  assert.equal(views.length, 6);
  views.slice(4).forEach(view => h.message(view));
  assert.equal(h.results.length, 6);
});

test('big-only packs start both stores immediately', () => {
  const h = harness();
  h.props.activeStoreIds = ['amazon_main', 'flipkart'];
  const views = h.render();
  assert.equal(views.length, 2);
  views.forEach(view => h.message(view));
  assert.equal(h.results.length, 2);
});

test('account checks use a separate bridge and reuse the view when search preempts', () => {
  const h=harness();h.props.enabled=false;h.props.searchQuery='';h.props.sessionJob={platformId:'zepto',token:'probe:1'};
  let views=h.render();assert.equal(views.length,1);assert.equal(views[0].props.source.uri,'https://www.zepto.com');assert.ok(views[0].props.javaScriptEnabled);
  views[0].props.onLoadStart({nativeEvent:{url:'https://www.zepto.com'}});views[0].props.onLoadEnd({nativeEvent:{url:'https://www.zepto.com'}});
  const script=h.injections.find(item=>item.script.includes('installSessionObserver')).script;
  const token=script.match(/\)\("zepto", "([^"]+)"/)[1];
  h.sessionMessage(views[0],'stale');assert.equal(h.sessionResults.length,0);
  h.sessionMessage(views[0],token);assert.equal(h.sessionResults.length,1);assert.equal(h.results.length,0);
  h.props.sessionJob=null;h.props.enabled=true;h.props.searchBusy=true;h.props.searchQuery='milk';h.props.searchId=2;h.props.activeStoreIds=['zepto'];
  views=h.render();assert.equal(views.length,1);assert.equal(views[0].props.key,'zepto');assert.ok(views[0].props.source.uri.includes('milk'));
  h.sessionMessage(views[0],token);assert.equal(h.sessionResults.length,1);
  h.message(views[0]);assert.equal(h.results.length,1);
});

test('account check timeout and network error finish unknown once', () => {
  for(const failure of ['timeout','error']) {
    const h=harness();h.props.enabled=false;h.props.searchQuery='';h.props.sessionJob={platformId:'blinkit',token:failure};
    const view=h.render()[0];assert.equal(h.timers.size,1);assert.equal([...h.timerDurations.values()][0],8000);
    if(failure==='timeout') [...h.timers.values()][0]();else view.props.onError({nativeEvent:{url:'https://blinkit.com'}});
    assert.equal(h.sessionResults.length,1);assert.equal(h.sessionResults[0][2].status,'unknown');
    view.props.onError({nativeEvent:{url:'https://blinkit.com'}});assert.equal(h.sessionResults.length,1);
  }
});

test('SPA account navigation installs a new probe without load-end and rejects the old token', () => {
  const h=harness();h.props.enabled=false;h.props.searchQuery='';h.props.sessionJob={platformId:'blinkit',token:'spa'};
  const view=h.render()[0];
  const latestToken=()=>h.injections.filter(x=>x.script.includes('installSessionObserver')).at(-1).script.match(/\)\("blinkit", "([^"]+)"/)[1];
  view.props.onLoadStart({nativeEvent:{url:'https://blinkit.com'}});
  const oldToken=latestToken();
  view.props.onLoadStart({nativeEvent:{url:'https://blinkit.com/account'}});
  view.props.onNavigationStateChange({url:'https://blinkit.com/account',loading:false});
  const newToken=latestToken();assert.notEqual(newToken,oldToken);
  h.sessionMessage(view,oldToken,'signed_in','logout_control','https://blinkit.com/account');assert.equal(h.sessionResults.length,0);
  h.sessionMessage(view,newToken,'signed_in','logout_control','https://blinkit.com/account');assert.equal(h.sessionResults.length,1);
  assert.equal(view.props.style[1].height,640);
});

test('search cancels an active account deadline and stale probe callbacks cannot change results', () => {
  const h=harness();h.props.enabled=false;h.props.searchQuery='';h.props.sessionJob={platformId:'zepto',token:'interrupted'};
  const oldView=h.render()[0],deadline=[...h.timers.values()][0];
  h.props.searchBusy=true;h.props.enabled=true;h.props.searchQuery='milk';h.props.searchId=2;h.props.activeStoreIds=['zepto'];
  const view=h.render()[0];assert.equal(view.props.key,oldView.props.key);
  deadline();oldView.props.onError({nativeEvent:{url:'https://www.zepto.com'}});
  assert.equal(h.sessionResults.length,0);assert.equal(h.results.length,0);assert.equal(h.timers.size,1);
  h.message(view);assert.equal(h.results.length,1);
});

test('conflicting account evidence finishes Unknown rather than accepting a later signed-in message', () => {
  const h=harness();h.props.enabled=false;h.props.searchQuery='';h.props.sessionJob={platformId:'zepto',token:'conflict'};
  const view=h.render()[0];view.props.onLoadStart({nativeEvent:{url:'https://www.zepto.com'}});
  const token=h.injections.find(x=>x.script.includes('installSessionObserver')).script.match(/\)\("zepto", "([^"]+)"/)[1];
  view.props.onMessage({nativeEvent:{data:JSON.stringify({type:'LOWP_SESSION',platformId:'zepto',token,url:'https://www.zepto.com',status:'unknown',evidence:'none',conflicting:true})}});
  h.sessionMessage(view,token);assert.equal(h.sessionResults.length,1);assert.equal(h.sessionResults[0][2].status,'unknown');
});

test('passive product cues cannot overwrite an account observation after the login window opens', () => {
  const h=harness(),observations=[];h.props.onSessionObservation=(...args)=>observations.push(args);
  h.props.activeStoreIds=['zepto'];let view=h.render()[0];
  view.props.onLoadStart({nativeEvent:{url:view.props.source.uri}});view.props.onLoadEnd({nativeEvent:{url:view.props.source.uri}});
  h.sessionMessage(view,'search-session:1:zepto:0');assert.equal(observations.length,1);
  h.message(view);assert.equal(observations.length,1); // Products themselves are not session evidence.
  h.props.sessionObservationEnabled=false;h.render();h.props.sessionObservationEnabled=true;view=h.render()[0];
  h.sessionMessage(view,'search-session:1:zepto:0');assert.equal(observations.length,1);
});

test('a parked account page reloads on resume after a search in another store', () => {
  const h=harness();h.props.enabled=false;h.props.searchQuery='';h.props.sessionJob={platformId:'flipkart',token:'before'};
  h.render();h.props.searchBusy=true;h.props.enabled=true;h.props.searchQuery='milk';h.props.searchId=2;h.props.activeStoreIds=['zepto'];
  let views=h.render();h.message(views.find(v=>v.props.key==='zepto'));
  h.props.enabled=false;h.props.searchBusy=false;h.props.sessionJob={platformId:'flipkart',token:'after'};
  views=h.render();assert.equal(views.length,2);assert.equal(h.timers.size,2);
  [...h.timers.values()][0]();assert.deepEqual(h.reloads,['flipkart']);
});

test('single-store title search parks other views and returns to pack without remounting', () => {
  const h=harness();h.props.limitMode='extraction';let views=h.render();views.forEach(view=>h.message(view));views=h.render();
  const urls=Object.fromEntries(views.map(view=>[view.props.key,view.props.source.uri]));
  h.props.activeStoreIds=['blinkit'];h.props.searchQuery='butter';h.props.searchId=2;
  views=h.render();assert.equal(views.length,6);
  assert.equal(views.filter(view=>view.props.javaScriptEnabled).length,1);
  for(const view of views) if(view.props.key!=='blinkit') assert.equal(view.props.source.uri,urls[view.props.key]);
  h.message(views.find(view=>view.props.key==='zepto'));assert.equal(h.results.length,6);
  h.message(views.find(view=>view.props.key==='blinkit'));assert.equal(h.results.length,7);
  h.props.activeStoreIds=['amazon_tez','instamart','zepto','blinkit','amazon_main','flipkart'];h.props.searchQuery='Amul Butter 500g';h.props.searchId=3;
  views=h.render();assert.equal(views.length,6);assert.ok(views.every(view=>view.props.javaScriptEnabled));
  assert.ok(views.every(view=>view.props.source.uri.includes('Amul%20Butter%20500g')));
});

test('two active pages retain six mounted views and queued stores keep their deadline', () => {
  const h = harness();
  h.props.maxConcurrentWebViews = 2;
  let views = h.render();
  assert.equal(views.length, 6);
  assert.equal(views.filter(view => view.props.javaScriptEnabled).length, 2);
  assert.equal(views.filter(view => view.props.source.uri === 'about:blank').length, 4);
  assert.equal(h.timers.size, 2);
  h.message(views[2]); // A queued page cannot submit a native result.
  assert.equal(h.results.length, 0);
  const staleTimer = [...h.timers.values()][0];
  h.message(views[0]);
  views = h.render();
  assert.equal(h.timers.size, 2);
  assert.equal(views.filter(view => view.props.javaScriptEnabled).length, 2);
  assert.ok(views[2].props.source.uri.includes('paneer'));
  const keys = views.map(view => view.props.key);
  h.props.searchId = 2; h.props.searchQuery = 'butter';
  views = h.render();
  assert.deepEqual(views.map(view => view.props.key), keys);
  assert.ok(views[2].props.source.uri.includes('paneer')); // Waiting view keeps its previous document.
  assert.equal(views[2].props.javaScriptEnabled, false);
  staleTimer();
  assert.equal(h.results.length, 1);
  h.props.enabled = false;
  views = h.render();
  assert.equal(h.timers.size, 0);
  assert.ok(views.every(view => !view.props.javaScriptEnabled));
});

test('a page timeout releases a slot without timing out waiting pages', () => {
  const h = harness();
  h.props.maxConcurrentWebViews = 3;
  let views = h.render();
  [...h.timers.values()][0]();
  assert.equal(h.results.length, 1);
  views = h.render();
  assert.equal(views.filter(view => view.props.javaScriptEnabled).length, 3);
  assert.ok(views[3].props.source.uri.includes('paneer'));
  assert.equal(h.timers.size, 3);
});

test('successful queued HTTP result skips page navigation and old HTTP work cannot answer a replacement', async () => {
  const h = harness();
  h.props.maxConcurrentWebViews = 2;
  h.render();
  const html = '<div data-component-type="s-search-result" data-asin="B012345678"><h2 aria-label="Paneer 200g"></h2><span class="a-price-whole">100</span></div>';
  const respond = request => request.resolve({ ok: true, text: async () => html });
  const firstAmazon = h.http.find(request => request.url.includes('amazon.in'));
  respond(firstAmazon);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.results.length, 1);
  assert.equal(h.results[0][0], 'amazon_main');
  let views = h.render();
  assert.equal(views.find(view => view.props.key === 'amazon_main').props.source.uri, 'about:blank');
  assert.equal(h.timers.size, 2);
  h.props.searchId = 2; h.props.searchQuery = 'butter';
  h.render();
  const replacedAmazon = h.http.find(request => request.url.includes('amazon.in') && request.url.includes('butter'));
  h.props.enabled = false; h.props.searchId = 3;
  h.render();
  respond(replacedAmazon);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.results.length, 1);
});

test('extraction-only limit loads all pages and starts queued extraction without navigation', () => {
  const h = harness();
  h.props.maxConcurrentWebViews = 1;
  h.props.limitMode = 'extraction';
  let views = h.render();
  assert.equal(views.length, 6);
  assert.ok(views.every(view => view.props.source.uri.includes('paneer')));
  assert.ok(views.every(view => view.props.javaScriptEnabled));
  assert.equal(views.filter(view => view.props.injectedJavaScript.endsWith('script')).length, 1);
  assert.equal(h.timers.size, 1);
  h.message(views[1]);
  assert.equal(h.results.length, 0);
  h.message(views[0]);
  views = h.render();
  assert.equal(h.timers.size, 1);
  assert.ok(h.injections.some(injection => injection.store === views[1].props.key && injection.script.includes('script') &&
    injection.script.includes('__lowpDocumentRequestId === 1')));
  assert.ok(views.every(view => view.props.source.uri.includes('paneer')));
  assert.equal(views.filter(view => view.props.javaScriptEnabled).length, 5);
  h.props.enabled = false;
  views = h.render();
  assert.ok(views.every(view => !view.props.javaScriptEnabled));
  assert.equal(h.timers.size, 0);
});

test('queued page errors resolve only the current document and release no unrelated store', () => {
  const h = harness();
  h.props.maxConcurrentWebViews = 1;
  h.props.limitMode = 'extraction';
  const views = h.render();
  views[3].props.onError({ nativeEvent: { url: views[3].props.source.uri } });
  assert.equal(h.results.length, 1);
  assert.equal(h.results[0][0], views[3].props.key);
  assert.equal(h.timers.size, 1);
  h.props.searchId = 2; h.props.searchQuery = 'butter';
  const replacement = h.render();
  replacement[3].props.onError({ nativeEvent: { url: views[3].props.source.uri } });
  assert.equal(h.results.length, 1);
});

test('a changed concurrency preference applies to the next request', () => {
  const h = harness();
  h.props.maxConcurrentWebViews = 3;
  h.render();
  h.props.maxConcurrentWebViews = 1;
  h.props.limitMode = 'extraction';
  let views = h.render();
  assert.equal(views.filter(view => view.props.javaScriptEnabled).length, 3);
  h.props.searchId = 2; h.props.searchQuery = 'butter';
  views = h.render();
  assert.ok(views.every(view => view.props.javaScriptEnabled));
  assert.equal(h.timers.size, 1);
});

test('HTTP store titles expose pack size without inventing a default unit', () => {
 const extract = matchingContext.exports.MatchingEngine.extractQuantity;
 assert.equal(extract('Amul Butter Unsalted, 500g'),'500g');
 assert.equal(extract('Milk 1 Ltr'),'1 Ltr');
 assert.equal(extract('Paneer 2 x 200 g'),'2 x 200 g');
 assert.equal(extract('Product delivery in 8 mins ₹320'),'');
});

test('Flipkart quantity reads subtitle and title including multipacks',()=>{
 const engine=matchingContext.exports.MatchingEngine;
 assert.equal(engine.extractCardQuantity('Potato Chips','<div>₹100</div><div>500&nbsp;g</div>'),'500 g');
 assert.equal(engine.extractCardQuantity('Potato Chips 200g pack of 2','<div>400 g</div>'),'200g pack of 2');
 assert.equal(engine.extractCardQuantity('Potato Chips','<script>500 g</script><div>₹0.50/g</div><div>Delivery in 8 mins</div>'),'');
});

test('Flipkart HTTP results carry size from a separate card subtitle', async()=>{
 const h=harness();h.render();
 h.http.find(request=>request.url.includes('flipkart.com')).resolve({ok:true,text:async()=>'<div data-id="POTATO123"><a title="Potato Chips" href="/chips/p/POTATO123">Potato Chips</a><span>500&nbsp;g</span><div class="hZ3P6w">₹100</div></div>'});
 await new Promise(resolve=>setImmediate(resolve));
 const result=h.results.find(result=>result[0]==='flipkart');
 assert.ok(result);assert.equal(result[1].quantity,'500 g');assert.equal(result[1].price,100);
});
