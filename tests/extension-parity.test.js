const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const shared = {};
vm.runInNewContext(fs.readFileSync('src/shared/mobile-core.js','utf8'), shared);
test('extension uses mobile matching, quantity and effective basket calculations', () => {
  const C=shared.LowPCore;
  const item=(title,price,quantity)=>({id:title,title,price,mrp:price,quantity,productUrl:'https://example.com',brand:'Amul'});
  const a={platformId:'zepto',platformName:'Zepto',candidates:[item('Amul Butter',320,'500 g')]};
  const b={platformId:'blinkit',platformName:'Blinkit',candidates:[item('Amul Butter',65,'100 g')]};
  const row=C.compareProduct(a,a.candidates[0],[a,b],'butter');
  assert.equal(row.stores.blinkit.effectivePrice,325);
  assert.equal(C.comparisonBaskets([row],{}).complete[1].subtotal,325);
  assert.equal(C.productSearchTitle(a.candidates[0]),'Amul Butter 500 g');
  assert.equal(C.MatchingEngine.extractCardQuantity('Potato 1 kg',''),'1 kg');
  assert.equal(C.historyMatches(Array.from({length:20},(_,i)=>`milk ${i}`),'milk').length,10);
});
for (const filename of ['src/background/service-worker.js','src/content/content-script.js']) {
  test(`${filename}: price never comes from Boosters quantity; sizes survive`, () => {
    const source=fs.readFileSync(filename,'utf8');
    const start=source.indexOf('  function titleKey('), extract=source.indexOf('  function extractFromCard(');
    const end=source.indexOf('\n  function ',extract+1);
    const context={window:{location:{href:'https://www.amazon.in/tez/browse/search'}},document:{body:{}},searchQuery:'abhi eggs',URL};
    vm.createContext(context);vm.runInContext(source.slice(start,end),context);
    for (const quantity of [6,24]) {
      const price=quantity===6?86:300,text=`Abhi Eggs With Immunity Boosters ${quantity} Pcs ₹${price}`;
      context.card={nodeType:1,childNodes:[{nodeType:3,nodeValue:text}],textContent:text,closest:()=>null,querySelectorAll:()=>[],querySelector:s=>s.startsWith('img.s-image')?{alt:'Abhi Eggs',src:'https://example.com/image'}:null};
      const result=vm.runInContext("extractFromCard(card,'amazon_tez')",context);
      assert.equal(result.price,price);assert.equal(result.quantity,`${quantity} Pcs`);
    }
  });
}
