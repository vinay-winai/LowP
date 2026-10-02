const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'), vm=require('node:vm'), ts=require('../mobile/node_modules/typescript');
const context={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../mobile/src/core/StoreOffers.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,context);
const {calculateOffer,comparisonBaskets}=context.exports;
const offer={cardPercent:5,tiers:[{threshold:499,cashback:50},{threshold:899,cashback:100}]};
test('card savings and milestone gap before first level',()=>{
 const result=calculateOffer(162,offer);
 assert.equal(result.discount,8.1);assert.equal(result.payable,153.9);assert.equal(result.cashback,0);
 assert.equal(result.next.remaining,337);assert.equal(result.next.additional,50);
});
test('cashback activates exactly at subtotal threshold before card offer',()=>{
 const result=calculateOffer(499,offer);
 assert.equal(result.discount,24.95);assert.equal(result.payable,474.05);assert.equal(result.cashback,50);
 assert.equal(result.effectiveTotal,424.05);assert.equal(result.reachedThreshold,499);
 assert.equal(result.next.remaining,400);assert.equal(result.next.additional,50);
});
test('highest reached level applies without stacking',()=>{
 const result=calculateOffer(899,{...offer,tiers:offer.tiers.slice().reverse()});
 assert.equal(result.cashback,100);assert.equal(result.next,null);assert.equal(result.effectiveTotal,754.05);
});
test('effective cost stays nonnegative and cents are rounded',()=>{
 assert.equal(calculateOffer(100,{cardPercent:100,tiers:[{threshold:100,cashback:150}]}).effectiveTotal,0);
 assert.equal(calculateOffer(0.3,{cardPercent:5,tiers:[]}).discount,0.02);
});
const cell=(id,price,available=true,comparable=true)=>({platformId:id,platformName:id,price,isAvailable:available,isComparable:comparable});
test('each complete store applies offers to its own basket subtotal',()=>{
 const rows=[{stores:{zepto:cell('zepto',300),blinkit:cell('blinkit',320)},cheapestStoreId:'zepto'},{stores:{zepto:cell('zepto',310),blinkit:cell('blinkit',300)},cheapestStoreId:'blinkit'}];
 const result=comparisonBaskets(rows,{zepto:offer,blinkit:offer});
 assert.equal(result.complete.find(store=>store.id==='zepto').cashback,50);
 assert.equal(result.complete.find(store=>store.id==='blinkit').subtotal,620);assert.equal(result.incomplete.length,0);
});
test('incomplete stores report partial totals and distinguish missing from excluded items',()=>{
 const rows=[{query:'Butter',stores:{zepto:cell('zepto',100),blinkit:cell('blinkit',80,true,false)}},{query:'Milk',stores:{zepto:cell('zepto',200),blinkit:cell('blinkit',0,false)}}];
 const result=comparisonBaskets(rows,{});assert.equal(result.complete.length,1);assert.equal(result.incomplete.length,1);
 const basket=result.incomplete[0];assert.equal(basket.count,0);assert.equal(basket.effectiveTotal,0);assert.equal(basket.missing[0].title,'Butter');assert.equal(basket.missing[0].excluded,true);assert.equal(basket.missing[1].title,'Milk');assert.equal(basket.missing[1].excluded,false);
 rows[0].stores.blinkit.isComparable=true;assert.equal(comparisonBaskets(rows,{}).incomplete[0].subtotal,80);
});
test('complete baskets rank after offers and exclude missing or different packs',()=>{
 const rows=[{stores:{zepto:cell('zepto',500),blinkit:cell('blinkit',490),flipkart:cell('flipkart',100,true,false)},cheapestStoreId:'blinkit'}];
 const result=comparisonBaskets(rows,{zepto:offer});
 assert.equal(result.complete[0].id,'zepto');assert.equal(result.complete[0].effectiveTotal,425);
 assert.equal(result.complete.length,2);
 rows.push({stores:{zepto:cell('zepto',200,false),blinkit:cell('blinkit',200)},cheapestStoreId:'blinkit'});
 assert.equal(comparisonBaskets(rows,{}).complete.length,1);
});
