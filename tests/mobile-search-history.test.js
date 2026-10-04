const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), ts = require('../mobile/node_modules/typescript');
const context = {exports: {}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../mobile/src/core/SearchHistory.ts'), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS}}).outputText, context);
const {normalizeSearchHistory, historyMatches} = context.exports;
test('history keeps the newest 1000 unique valid searches and promotes repeats', () => {
  const history = normalizeSearchHistory([' MILK ', 'toor   dal', 'milk', null, '', ...Array.from({length: 1005}, (_, i) => `query ${i}`)]);
  assert.equal(history.length, 1000);
  assert.equal(history[0], 'MILK');
  assert.equal(history[1], 'toor dal');
  const next = normalizeSearchHistory(['Toor Dal', ...history]);
  assert.equal(next[0], 'Toor Dal');
  assert.equal(next.length, 1000);
  assert.equal(next.filter(x => x.toLowerCase() === 'toor dal').length, 1);
  assert.equal(normalizeSearchHistory({}).length, 0);
});
test('empty input gives ten newest searches; matching is case insensitive and prefix ranked', () => {
  const history = ['Amul milk', 'milk powder', 'Milk', 'milky mist', 'oat milk', 'curd', 'milk 1L'];
  assert.deepEqual(Array.from(historyMatches(history, '  ')), history.slice(0, 10));
  assert.deepEqual(Array.from(historyMatches(history, 'MILK')), ['Milk', 'milk powder', 'milky mist', 'milk 1L', 'Amul milk', 'oat milk']);
  assert.equal(historyMatches(history, 'eggs').length, 0);
  assert.equal(history[0], 'Amul milk');
  const many = Array.from({length: 15}, (_, i) => 'milk ' + i);
  assert.equal(historyMatches(many, '').length, 10);
  assert.equal(historyMatches(many, 'milk').length, 10);
});

function historyHookHarness(saved) {
 const hooks=[], effects=[], timers=new Map();let cursor=0,id=0,now=0,dirty=false,output,query='';
 const react={
  useRef(initial){const i=cursor++;return hooks[i] ||= {current:initial};},
  useState(initial){const i=cursor++;hooks[i] ||= {value:initial};return [hooks[i].value,next=>{const value=typeof next==='function'?next(hooks[i].value):next;if(value!==hooks[i].value){hooks[i].value=value;dirty=true;}}];},
  useEffect(fn,deps){const i=cursor++,prev=hooks[i];if(!prev||deps.some((x,j)=>x!==prev.deps[j]))effects.push(()=>{prev?.cleanup?.();hooks[i]={deps,cleanup:fn()};});}
 };
 const c={exports:{},require:name=>name==='react'?react:name.includes('async-storage')?{getItem:()=>Promise.resolve(JSON.stringify(saved)),setItem:()=>Promise.resolve()}:context.exports,
  setTimeout:(fn,delay)=>{timers.set(++id,{fn,at:now+delay});return id;},clearTimeout:id=>timers.delete(id)};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../mobile/src/core/useSearchHistory.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,c);
 const h={render(value=query){query=value;do{dirty=false;cursor=0;output=c.exports.useSearchHistory(query);effects.splice(0).forEach(fn=>fn());}while(dirty);return Array.from(output.suggestions);},
  async load(){h.render();for(let i=0;i<6;i++)await Promise.resolve();return h.render();},
  advance(ms){now+=ms;for(const [id,timer] of timers)if(timer.at<=now){timers.delete(id);timer.fn();}return h.render();},
  unmount(){hooks.forEach(hook=>hook.cleanup?.());},timers};return h;
}
test('history suggestions update only after 180 ms idle and cancel stale queries',async()=>{
 const h=historyHookHarness(['milk','curd','milk powder','banana']);
 assert.deepEqual(await h.load(),['milk','curd','milk powder','banana']);
 assert.deepEqual(h.render('mi'),[]);assert.deepEqual(h.advance(179),[]);
 assert.deepEqual(h.advance(1),['milk','milk powder']);
 assert.deepEqual(h.render('cur'),[]);h.advance(100);
 assert.deepEqual(h.render('ban'),[]);assert.deepEqual(h.advance(100),[]);
 assert.deepEqual(h.advance(79),[]);assert.deepEqual(h.advance(1),['banana']);
 assert.deepEqual(h.render('banx'),[]);h.advance(100);
 assert.deepEqual(h.render('ban'),[]);assert.deepEqual(h.advance(179),[]);
 assert.deepEqual(h.advance(1),['banana']);
 assert.deepEqual(h.render(''),['milk','curd','milk powder','banana']);
 h.render('mi');h.unmount();assert.equal(h.timers.size,0);
});
