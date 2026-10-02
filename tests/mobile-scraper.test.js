const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('../mobile/node_modules/typescript');
const moduleContext = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../mobile/src/core/ScraperScript.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText, moduleContext);
const { generateScraperScript } = moduleContext.exports;

test('development timing records scan work without changing request identity', () => {
  const p = page([{ name: 'Paneer', price: 100 }]);
  vm.runInContext(generateScraperScript('paneer', 'zepto', 9, true), p.context);
  p.advance(300);
  [...p.intervals].forEach(fn => fn());
  assert.equal(p.messages.length, 1);
  assert.equal(p.messages[0].searchId, 9);
  assert.ok(p.messages[0].debug.timing.scanCount > 0);
  assert.equal(p.messages[0].debug.timing.extractionWorkMs, 0);
  assert.equal(p.messages[0].debug.timing.responseEndMs, null);
});

function page(products = []) {
  const intervals = new Set(), timeouts = new Set(), observers = new Set(), listeners = new Set(), messages = [];
  let scans = 0;
  let clock = 10000;
  const document = {
    readyState: 'loading', body: {}, documentElement: {}, title: '',
    getElementById: () => products.length ? { textContent: JSON.stringify({ products }) } : null,
    querySelectorAll: () => { scans++; return []; }, querySelector: () => null,
    getElementsByTagName: () => [],
    addEventListener: (name, fn) => listeners.add(fn), removeEventListener: (name, fn) => listeners.delete(fn),
    createTreeWalker: () => ({ nextNode: () => null })
  };
  const context = vm.createContext({ document, console, Date: { now: () => clock }, URL,
    window: { location: { href: 'https://www.zepto.com/search?query=paneer' },
      ReactNativeWebView: { postMessage: value => messages.push(JSON.parse(value)) },
      addEventListener() {}, removeEventListener() {} },
    setInterval: fn => { intervals.add(fn); return fn; }, clearInterval: fn => intervals.delete(fn),
    setTimeout: fn => { timeouts.add(fn); return fn; }, clearTimeout: fn => timeouts.delete(fn),
    MutationObserver: class {
      constructor(fn) { this.fn = fn; }
      observe() { observers.add(this); }
      disconnect() { observers.delete(this); }
    }
  });
  return { context, intervals, timeouts, observers, listeners, messages, scans: () => scans, advance: ms => { clock += ms; } };
}

test('loading store shells do not crash; duplicate injections keep one extraction loop', () => {
  for (const store of ['zepto', 'instamart', 'blinkit', 'amazon_tez', 'amazon_main', 'flipkart']) {
    const p = page();
    const param = store === 'amazon_tez' ? 'searchKeyword' : store === 'amazon_main' ? 'k'
      : store === 'zepto' || store === 'instamart' ? 'query' : 'q';
    p.context.window.location.href = `https://store.example/search?${param}=paneer`;
    const script = generateScraperScript('paneer', store, 1);
    vm.runInContext(script, p.context);
    const scans = p.scans();
    for (let i = 0; i < 5; i++) vm.runInContext(script, p.context);
    assert.equal(p.scans(), scans);
    assert.equal(p.intervals.size, 1);
    assert.equal(p.observers.size, 1);
    vm.runInContext(generateScraperScript('butter', store, 2), p.context);
    assert.equal(p.intervals.size, 1);
    assert.equal(p.observers.size, 1);
    assert.equal(p.listeners.size, 1);
    p.context.window.__lowpScraper.dispose();
    assert.equal(p.intervals.size + p.observers.size + p.listeners.size, 0);
  }
});

test('persistent visible login gates finish early; transient or hidden login copy does not',()=>{
 for(const store of ['zepto','instamart']) for(const mode of ['persistent','transient','hidden','header']) {
  const p=page();const original=p.context.document.querySelectorAll;let shown=true;
  const element={textContent:mode==='header'?'Login':'Log in to continue shopping with a more personalised experience',closest:()=>null,getClientRects:()=>[{width:200,height:40}]};
  p.context.document.querySelectorAll=selector=>selector==='h1,h2,h3,p,span,div'&&shown?[element]:original(selector);
  p.context.getComputedStyle=()=>({display:mode==='hidden'?'none':'block',visibility:'visible',opacity:'1'});
  vm.runInContext(generateScraperScript('paneer',store,4),p.context);
  for(let i=0;i<7;i++){p.advance(150);[...p.intervals].forEach(fn=>fn());}
  assert.equal(p.messages.length,0);
  if(mode==='transient') shown=false;
  p.advance(650);[...p.intervals].forEach(fn=>fn());
  if(mode==='persistent') {
   assert.equal(p.messages.length,1);assert.equal(p.messages[0].debug.reason,'login_required');assert.equal(p.messages[0].success,false);
   assert.equal(p.intervals.size+p.observers.size,0);
  } else assert.equal(p.messages.length,0);
 }
});

test('valid products win over login promotional copy',()=>{
 const p=page([{name:'Paneer',price:100},{name:'Fresh Paneer',price:90},{name:'Malai Paneer',price:110}]);
 const original=p.context.document.querySelectorAll;
 p.context.document.querySelectorAll=selector=>selector==='h1,h2,h3,p,span,div'?[{textContent:'Log in to continue shopping',closest:()=>null,getClientRects:()=>[{width:100,height:40}]}]:original(selector);
 p.context.getComputedStyle=()=>({display:'block',visibility:'visible',opacity:'1'});
 vm.runInContext(generateScraperScript('paneer','zepto',5),p.context);
 assert.equal(p.messages[0].success,true);
});

test('reused documents with a different pack size cannot answer the next query', () => {
  const p = page([
    { name: 'Amul Paneer 500g', price: 190 },
    { name: 'Milky Mist Paneer 500g', price: 200 },
    { name: 'Heritage Paneer 500g', price: 210 }
  ]);
  p.context.window.location.href = 'https://www.zepto.com/search?query=paneer+200g';
  vm.runInContext(generateScraperScript('paneer 500g', 'zepto', 2), p.context);
  assert.equal(p.messages.length, 0);
  assert.equal(p.scans(), 0);
  p.context.window.location.href = 'https://www.zepto.com/search?query=paneer+500g';
  p.advance(200);
  [...p.intervals][0]();
  assert.equal(p.messages.length, 1);
  assert.equal(p.messages[0].searchId, 2);
  assert.equal(p.messages[0].success, true);
});

test('successful extraction carries request identity and leaves no background loop', () => {
  const p = page([
    { name: '4 4 out of 5 stars. (165)', price: 479 },
    { name: 'M.R.P:', price: 719 },
    { name: 'Amul Paneer 200g', price: 90 },
    { name: 'Milky Mist Paneer 200g', price: 100 },
    { name: 'Heritage Paneer 200g', price: 110 }
  ]);
  const script = generateScraperScript('paneer', 'zepto', 17);
  vm.runInContext(script, p.context);
  assert.equal(p.messages.length, 1);
  assert.equal(p.messages[0].success, true);
  assert.equal(p.messages[0].searchId, 17);
  assert.equal(p.messages[0].candidates.length, 3);
  assert.ok(p.messages[0].candidates.every(c => !c.title.includes('stars')));
  assert.ok(p.messages[0].candidates.every(c => c.title !== 'M.R.P:'));
  assert.equal(p.intervals.size + p.observers.size + p.listeners.size, 0);
  vm.runInContext(script, p.context);
  assert.equal(p.messages.length, 1);
});

test('continuous DOM mutations coalesce without postponing extraction indefinitely', () => {
  const p = page();
  vm.runInContext(generateScraperScript('paneer', 'zepto', 1), p.context);
  const observer = [...p.observers][0];
  observer.fn();
  const pending = [...p.timeouts][0];
  for (let i = 0; i < 20; i++) observer.fn();
  assert.equal(p.timeouts.size, 1);
  assert.equal([...p.timeouts][0], pending);
});

test('slow hydration gets the time budget even with many mutation attempts', () => {
  const products = [];
  const p = page(products);
  p.context.document.readyState = 'complete';
  vm.runInContext(generateScraperScript('paneer', 'zepto', 1), p.context);
  const poll = [...p.intervals][0];
  for (let i = 0; i < 45; i++) { p.advance(150); poll(); }
  assert.equal(p.messages.length, 0);
  products.push(...['Amul', 'Milky Mist', 'Heritage'].map(name => ({ name: name + ' Paneer 200g', price: 100 })));
  p.advance(150);
  poll();
  assert.equal(p.messages[0].success, true);
});

test('Amazon uses product title fields instead of delivery dates and accepts long image titles', () => {
  const p = page();
  const script = generateScraperScript('butter', 'amazon_main', 1);
  const helpers = script.slice(script.indexOf('  function titleKey'), script.indexOf('  // Reused WebViews'));
  const price = { nodeType: 3, nodeValue: '₹719', textContent: '₹719' };
  const card = { nodeType: 1, childNodes: [price], textContent: '₹719 M.R.P: Fri, 2 Oct',
    querySelector: selector => selector.startsWith('[data-slot-id="EdlpPrice"]') ? price : null,
    querySelectorAll: () => [{ textContent: 'Fri, 2 Oct' }, { textContent: 'M.R.P:' }],
    getAttribute: () => '', closest: () => null };
  p.context.card = card;
  vm.runInContext(`const searchQuery='butter', targetPlatformId='amazon_main'; ${helpers}`, p.context);
  assert.equal(vm.runInContext("extractFromCard(card, 'amazon_main')", p.context), null);
  const title = 'Amul Butter 500g with a detailed manufacturer description for cooking and baking, packaging information, storage instructions, ingredients and nutritional information printed on the product label';
  card.querySelector = selector => selector.startsWith('[data-slot-id="EdlpPrice"]') ? price
    : selector.startsWith('img.s-image') ? { alt: title, src: 'https://example.com/product.jpg' } : null;
  const item = vm.runInContext("extractFromCard(card, 'amazon_main')", p.context);
  assert.ok(item.title.length > 150);
  assert.equal(item.price, 719);
  assert.ok(item.title.startsWith('Amul Butter'));
});

test('pack extraction prefers weight over wrapper count and preserves multipacks', () => {
  const p = page();
  const script = generateScraperScript('butter', 'instamart', 1);
  const helpers = script.slice(script.indexOf('  function titleKey'), script.indexOf('  // Reused WebViews'));
  vm.runInContext(`const searchQuery='butter', targetPlatformId='instamart'; ${helpers}`, p.context);
  for (const [text, expected] of [['1 pack (500 g)','500 g'],['2 x 200 g','2 x 200 g'],['500 ml','500 ml'],['1 kg','1 kg'],['200 g pack of 2','200 g pack of 2'],['6 pieces','6 pieces'],['Delivery in 8 MINS ₹320','']]) {
    p.context.quantityText = text;
    assert.equal(vm.runInContext('extractQuantity(quantityText)', p.context), expected);
  }
});

test('card text extracts Swiggy and Blinkit weights even without a semantic quantity selector', () => {
  for (const platform of ['instamart', 'blinkit']) {
    const p = page();
    const script = generateScraperScript('butter', platform, 1);
    const helpers = script.slice(script.indexOf('  function titleKey'), script.indexOf('  // Reused WebViews'));
    const text = 'Amul Unsalted Butter 500 g ₹320 ADD';
    const card = { nodeType: 1, textContent: text, childNodes: [{nodeType:3,nodeValue:text,textContent:text}],
      closest: () => null, querySelectorAll: () => [], querySelector: selector => selector.startsWith('img.s-image') ? {alt:'Amul Unsalted Butter',src:'https://example.com/butter.png'} : null };
    p.context.card = card;
    vm.runInContext(`const searchQuery='butter', targetPlatformId='${platform}'; ${helpers}`, p.context);
    const result = vm.runInContext(`extractFromCard(card, '${platform}')`, p.context);
    assert.equal(result.quantity, '500 g');assert.equal(result.price,320);
  }
});
