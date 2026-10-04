const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'), vm=require('node:vm'), ts=require('../mobile/node_modules/typescript');
const titleContext={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../mobile/src/core/TitleText.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,titleContext);
const context={exports:{},require:()=>titleContext.exports};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../mobile/src/core/ProductComparison.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,context);
const {matchScore,compareProduct,reshuffleMatches,refreshComparison,editComparisonCell,parseComparisonPrice}=context.exports;
const item=(title,price=100,quantity='',brand='')=>({id:title,title,price,quantity,brand,mrp:price,image:'',productUrl:`https://example.com/${encodeURIComponent(title)}`});
const store=(id,candidates)=>({platformId:id,platformName:id,candidates,item:candidates[0]||null,isAvailable:!!candidates.length,searchUrl:'https://example.com/search'});

test('effective prices preserve pack price and original anchor without compounding',()=>{
 const anchor=item('Amul Butter',100,'200g'), other=item('Amul Butter',240,'500g');
 const a=store('zepto',[anchor]), b=store('blinkit',[other, item('Amul Butter',110,'200g')]);const row=compareProduct(a,anchor,[a,b],'butter');
 const adjusted=editComparisonCell(row,'blinkit',{kind:'swap',index:0});
 assert.equal(adjusted.stores.blinkit.price,240);assert.equal(adjusted.stores.blinkit.item.price,240);
 assert.equal(adjusted.stores.blinkit.effectivePrice,96);assert.equal(adjusted.stores.blinkit.isComparable,true);assert.equal(adjusted.cheapestPrice,96);
 assert.equal(refreshComparison(refreshComparison(adjusted)).stores.blinkit.effectivePrice,96);
 const edited=editComparisonCell(adjusted,'blinkit',{kind:'price',price:250});
 assert.equal(edited.stores.blinkit.effectivePrice,100);assert.equal(edited.stores.blinkit.price,250);
 const swappedAnchor=editComparisonCell(adjusted,'zepto',{kind:'price',price:200});assert.equal(swappedAnchor.stores.blinkit.effectivePrice,96);
 const swapped=editComparisonCell(adjusted,'blinkit',{kind:'swap',index:1});assert.equal(swapped.stores.blinkit.effectivePrice,110);assert.equal(swapped.stores.blinkit.effectiveQuantity,undefined);
 const removed=editComparisonCell(adjusted,'blinkit',{kind:'remove'});assert.equal(removed.stores.blinkit.effectivePrice,0);assert.equal(removed.stores.blinkit.effectiveQuantity,undefined);
 const legacy={...adjusted,stores:{...adjusted.stores,blinkit:{...adjusted.stores.blinkit,price:96,item:{...other,price:96},sizeAdjustment:{sourcePrice:240,anchorQuantity:'200 g',storeQuantity:'500 g'}}}};
 const migrated=refreshComparison(legacy);assert.equal(migrated.stores.blinkit.price,240);assert.equal(migrated.stores.blinkit.effectivePrice,96);assert.equal(migrated.stores.blinkit.sizeAdjustment,undefined);
});
test('size suggestion converts compatible units and multipacks, rejects missing or incompatible sizes and 20 percent boundary',()=>{
 const make=(aq,bq,price=240)=>{const anchor=item('Milk',100,aq),a=store('zepto',[anchor]);const r=compareProduct(a,anchor,[a,store('blinkit',[item('Milk',price,bq)])],'milk');return context.exports.sizePriceSuggestion(r,r.stores.blinkit);};
 assert.equal(make('1 L','500 ml',60).price,120);
 assert.equal(make('1 kg','2 x 250g',240).price,480);
 for(const [a,b,p] of [['200g','500 ml',240],['','500g',240],['200g','',240],['0g','500g',240],['200g','500g',120],['200g','200g',240]])assert.equal(make(a,b,p),null);
});
test('already-totalled pack quantities are not multiplied twice',()=>{
 const anchor=item('Amul Butter',100,'200g'), a=store('zepto',[anchor]);
 for(const quantity of ['1 kg','500g']){
  const row=compareProduct(a,anchor,[a,store('blinkit',[item('Amul Butter 2 x 500g',450,quantity)])],'butter');
  assert.equal(context.exports.sizePriceSuggestion(row,row.stores.blinkit).price,90);
 }
 const ambiguous=compareProduct(a,anchor,[a,store('blinkit',[item('Amul Butter 2 x 500g',450,'750g')])],'butter');
 assert.equal(context.exports.sizePriceSuggestion(ambiguous,ambiguous.stores.blinkit),null);
});

test('descriptions after dashes contribute less than the primary product name',()=>{
 const anchor=item('Quaker Oats - delicious wholesome daily meal for the entire family');
 const plain=item('Quaker Oats');
 assert.ok(matchScore(anchor,plain)>0);
 assert.ok(matchScore(anchor,plain)>matchScore(anchor,item('Daily Meal - Quaker Oats delicious wholesome family')));
 assert.equal(matchScore(item('Amul Butter - Salted 500 g'),item('Amul Butter - Unsalted 500 g')),null);
 assert.ok(matchScore(item('Butter - 500 g'),item('Butter - 500 g'))>matchScore(item('Butter - 500 g'),item('Butter - 200 g')));
 assert.equal(titleContext.exports.titleParts('Sugar-free Oats').name,'Sugar-free Oats');
 assert.equal(titleContext.exports.titleParts('Oats — nutritious cereal').name,'Oats');
});
test('matches equivalent quantities across units',()=>assert.ok(matchScore(item('Amul Butter',100,'1kg','Amul'),item('Amul Butter',110,'1000g','Amul'))>0));
test('size differences lower rank without excluding scraped candidates',()=>{
 for(const quantity of ['500g','200g pack of 2','2 x 200g','200g x 2']) assert.ok(matchScore(item('Amul Butter',100,'200g','Amul'),item('Amul Butter',100,quantity,'Amul')) < matchScore(item('Amul Butter',100,'200g','Amul'),item('Amul Butter',100,'200g','Amul')));
});
test('rejects explicit brand and variant conflicts',()=>{
 assert.equal(matchScore(item('Butter',100,'200g','Amul'),item('Butter',100,'200g','Mother Dairy')),null);
 assert.equal(matchScore(item('Amul Salted Butter'),item('Amul Unsalted Butter')),null);
 assert.equal(matchScore(item('Paneer'),item('Paneer Masala')),null);
});
test('unrelated cheap item never wins over matching product',()=>{
 const a=store('zepto',[item('Amul Butter',100,'200g','Amul')]);
 const b=store('blinkit',[item('Oil',10,'1L'),item('Amul Butter',110,'200g','Amul')]);
 const row=compareProduct(a,a.item,[a,b],'butter');
 assert.equal(row.stores.blinkit.price,110);assert.equal(row.cheapestPrice,100);
});
test('price proximity breaks ties for the same product',()=>{
 const a=store('zepto',[item('Amul Butter',100,'200g','Amul')]);
 const b=store('blinkit',[item('Amul Butter',300,'200g','Amul'),item('Amul Butter',105,'200g','Amul')]);
 assert.equal(compareProduct(a,a.item,[a,b],'butter').stores.blinkit.price,105);
});
test('selection drives rematching and keeps chosen anchor intact',()=>{
 const a=store('zepto',[item('Amul Butter',100,'200g','Amul'),item('Mother Dairy Butter',95,'200g','Mother Dairy')]);
 const b=store('blinkit',[item('Amul Butter',110,'200g','Amul'),item('Mother Dairy Butter',90,'200g','Mother Dairy')]);
 const row=compareProduct(a,a.candidates[1],[a,b],'butter');
 assert.equal(row.query,'Mother Dairy Butter');assert.equal(row.searchQuery,'butter');assert.equal(row.stores.zepto.item,a.candidates[1]);assert.equal(row.stores.blinkit.price,90);
 assert.equal(a.item,a.candidates[0]);
});
test('missing match remains absent rather than claiming out of stock',()=>{
 const a=store('zepto',[item('Amul Butter',100,'200g','Amul')]),b=store('blinkit',[item('Rice',10,'1kg')]);
 const row=compareProduct(a,a.item,[a,b],'butter');
 assert.equal(row.stores.blinkit.isAvailable,false);assert.equal(row.stores.blinkit.item,null);assert.equal(row.stores.blinkit.price,0);
});
test('equal lowest product prices are both marked',()=>{
 const a=store('zepto',[item('Butter',100)]),b=store('blinkit',[item('Butter',100)]);
 const row=compareProduct(a,a.item,[a,b],'butter');assert.ok(row.stores.zepto.isCheapestInRow);assert.ok(row.stores.blinkit.isCheapestInRow);
});

test('store names in legacy brand metadata do not exclude valid matches',()=>{
 assert.ok(matchScore(item('Heritage Fresh Paneer',100,'200g','Zepto'),item('Heritage Fresh Paneer',110,'200g','Amazon.in'))>0);
 assert.ok(matchScore(item('Heritage Fresh Paneer',100,'200g','Zepto'),item('Heritage High Protein Paneer',110,'200g','Instamart')) < matchScore(item('Heritage Fresh Paneer',100,'200g','Zepto'),item('Heritage Fresh Paneer',110,'200g','Instamart')));
});
test('reshuffling promotes closest match without losing other choices or mutating candidates',()=>{
 const a=store('zepto',[item('Amul Butter',100,'200g','Amul')]);
 const other=item('Mother Dairy Butter',80,'200g','Mother Dairy'),match=item('Amul Butter',105,'200g','Amul');
 const b=store('blinkit',[other,match]);
 const row=compareProduct(a,a.item,[a,b],'butter'), shuffled=reshuffleMatches([a,b],row);
 assert.equal(shuffled[1].candidates[0],match);assert.equal(shuffled[1].candidates.length,2);assert.equal(b.candidates[0],other);assert.ok(shuffled[1].comparisonMatch);
});
test('missing size permits title and price matching and prefers the close priced box',()=>{
 const a=store('zepto',[item('Amul Unsalted Cooking Butter',320,'500g','Zepto')]);
 const b=store('instamart',[item('Amul Unsalted Butter',65,'','Swiggy Instamart'),item('Amul Butter Unsalted Box',320,'','Swiggy Instamart')]);
 assert.equal(compareProduct(a,a.item,[a,b],'butter').stores.instamart.price,320);
 assert.ok(matchScore(a.item,item('Amul Butter',320,'','Blinkit'))>0);
});

test('regional potato aliases match the primary product name',()=>{
 assert.ok(matchScore(item('Potato',26,'900 g','Zepto'),item('Potato (Bangala Dumpa)',29,'1 kg','Blinkit'))>0);
 assert.ok(matchScore(item('Potato (Aalugadda)',29,'1 kg','Swiggy Instamart'),item('Potato (Bangala Dumpa)',29,'1 kg','Blinkit'))>0);
});
test('plain potato chooses the ordinary potato ahead of baby potato and never potato chips',()=>{
 const a=store('zepto',[item('Potato',26,'900 g','Zepto')]);
 const b=store('blinkit',[item('Baby Potato (Chinna Bangala Dumpa)',30,'500 g','Blinkit'),item('Potato (Bangala Dumpa)',29,'1 kg','Blinkit'),item('Potato Chips',25,'900 g','Blinkit')]);
 assert.equal(compareProduct(a,a.item,[a,b],'potato').stores.blinkit.item.title,'Potato (Bangala Dumpa)');
 assert.equal(matchScore(a.item,b.candidates[2]),null);
});

test('live Quaker oats wording matches 1kg candidates despite marketing and cooking text',()=>{
 const anchor=item('Quaker Rolled Oats Cooks In 3 Minutes1 kg',164,'1 kg','Amazon Now (Tez)');
 const a=store('amazon_tez',[anchor]);
 const b=store('zepto',[item('Quaker Rolled Instant Oats | High Protein Breakfast Cereal',86,'400 g','Zepto'),item('Quaker Rolled Instant Oats | High Protein Breakfast Cereal',164,'1 kg','Zepto')]);
 const row=compareProduct(a,anchor,[a,b],'oats');assert.equal(row.stores.zepto.item.quantity,'1 kg');assert.equal(row.stores.zepto.price,164);
 assert.equal(matchScore(anchor,item('Saffola Rolled Oats',149,'1kg','Blinkit')),null);
});
test('400g oats remains visible as another pack but cannot win a 1kg comparison',()=>{
 const anchor=item('Quaker Rolled Oats Cooks In 3 Minutes1 kg',164,'1 kg','Amazon Now (Tez)');
 const a=store('amazon_tez',[anchor]),b=store('blinkit',[item('Quaker Rolled Instant Oats',86,'400 g','Blinkit')]);
 const row=compareProduct(a,anchor,[a,b],'oats');assert.equal(row.stores.blinkit.price,86);assert.equal(row.stores.blinkit.comparisonKind,'different_pack');assert.equal(row.stores.blinkit.isCheapestInRow,false);assert.equal(row.cheapestPrice,164);
});
test('late size details remain informational when prices are within 20 percent',()=>{
 const anchor=item('Quaker Oats',164,'1kg','Quaker');const a=store('zepto',[anchor]),b=store('flipkart',[item('Quaker Oats',150,'','Quaker')]);
 const row=compareProduct(a,anchor,[a,b],'oats');assert.equal(row.cheapestPrice,150);
 row.stores.flipkart.item={...row.stores.flipkart.item,quantity:'400g'};const refreshed=refreshComparison(row);assert.equal(refreshed.cheapestPrice,150);assert.equal(refreshed.stores.flipkart.comparisonKind,'different_pack');assert.ok(refreshed.stores.flipkart.isComparable);
});
test('only price differences strictly above 20 percent are excluded, with explicit inclusion',()=>{
 const a=store('zepto',[item('Butter',100,'1kg')]);
 for(const price of [80,120]) assert.ok(compareProduct(a,a.item,[a,store('blinkit',[item('Butter',price,'500g')])],'butter').stores.blinkit.isComparable);
 for(const price of [79.99,120.01]) {
  const row=compareProduct(a,a.item,[a,store('blinkit',[item('Butter',price,'1kg')])],'butter');assert.equal(row.stores.blinkit.isComparable,false);
  const included=editComparisonCell(row,'blinkit',{kind:'include'});assert.ok(included.stores.blinkit.isComparable);assert.ok(included.stores.blinkit.includeInTotals);
  assert.ok(refreshComparison(included).stores.blinkit.isComparable);
  assert.equal(editComparisonCell(included,'blinkit',{kind:'swap',index:0}).stores.blinkit.isComparable,false);
  assert.equal(editComparisonCell(included,'blinkit',{kind:'remove'}).stores.blinkit.isAvailable,false);
 }
});

test('swapping a stored comparison candidate changes product and totals without changing reference or source candidates',()=>{
 const anchor=item('Quaker Oats',164,'1kg','Quaker');const other=item('Quaker Oats',170,'1kg','Quaker');
 const a=store('zepto',[anchor]),b=store('blinkit',[item('Quaker Oats',86,'400g','Quaker'),other]);
 const original=compareProduct(a,anchor,[a,b],'oats');let row=editComparisonCell(original,'blinkit',{kind:'swap',index:1});
 assert.equal(row.stores.blinkit.price,170);assert.ok(row.stores.blinkit.manuallySelected);assert.equal(row.anchorItem,anchor);assert.equal(row.cheapestPrice,164);
 row=editComparisonCell(row,'blinkit',{kind:'price',price:150.25});assert.equal(row.cheapestPrice,150.25);assert.equal(row.stores.blinkit.originalPrice,170);assert.equal(other.price,170);
 row=editComparisonCell(row,'blinkit',{kind:'swap',index:0});assert.equal(row.stores.blinkit.price,86);assert.equal(row.stores.blinkit.originalPrice,undefined);assert.equal(row.stores.blinkit.comparisonKind,'different_pack');assert.equal(row.cheapestPrice,164);
 assert.equal(original.stores.blinkit.price,170);
});
test('removing the reference store keeps pack reference and remaining totals correct, and candidates can restore it',()=>{
 const anchor=item('Quaker Oats',164,'1kg','Quaker');const a=store('zepto',[anchor]),b=store('blinkit',[item('Quaker Oats',86,'400g','Quaker')]);
 const original=compareProduct(a,anchor,[a,b],'oats');let row=editComparisonCell(original,'zepto',{kind:'remove'});
 assert.equal(row.stores.zepto.item,null);assert.equal(row.stores.zepto.isAvailable,false);assert.equal(row.cheapestStoreId,null);assert.equal(row.cheapestPrice,0);assert.equal(row.stores.blinkit.comparisonKind,'different_pack');
 row=editComparisonCell(row,'zepto',{kind:'swap',index:0});assert.equal(row.cheapestPrice,164);assert.equal(row.stores.zepto.candidates.length,1);
});
test('comparison price validation rejects malformed prices and accepts currency and decimals',()=>{
 for(const value of ['', '0', '-10', 'Infinity', '12oops', '1.234', '500001']) assert.equal(parseComparisonPrice(value),null);
 assert.equal(parseComparisonPrice('₹1,234.50'),1234.5);assert.equal(parseComparisonPrice('99'),99);
 const a=store('zepto',[item('Butter')]);const row=compareProduct(a,a.item,[a],'butter');assert.equal(editComparisonCell(row,'zepto',{kind:'price',price:NaN}),row);assert.equal(editComparisonCell(row,'zepto',{kind:'swap',index:9}),row);
});
