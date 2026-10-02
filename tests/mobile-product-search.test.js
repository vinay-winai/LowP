const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'), vm=require('node:vm'), ts=require('../mobile/node_modules/typescript');
const context={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../mobile/src/core/ProductSearch.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,context);
const {productSearchTitle}=context.exports;
test('title search appends available quantity, including pieces and multipacks',()=>{
 assert.equal(productSearchTitle({title:'Amul Butter',quantity:'500 g'}),'Amul Butter 500 g');
 assert.equal(productSearchTitle({title:'Milk',quantity:'2 x 500 ml'}),'Milk 2 x 500 ml');
 assert.equal(productSearchTitle({title:'Eggs',quantity:'6 pieces'}),'Eggs 6 pieces');
 assert.equal(productSearchTitle({title:' Butter ',quantity:''}),'Butter');
});
test('existing and equivalent units do not duplicate size in title searches',()=>{
 assert.equal(productSearchTitle({title:'Amul Butter500g',quantity:'500 g'}),'Amul Butter500g');
 assert.equal(productSearchTitle({title:'Oats 1 kg',quantity:'1000g'}),'Oats 1 kg');
 assert.equal(productSearchTitle({title:'Milk 1 L',quantity:'1000 ml'}),'Milk 1 L');
 assert.equal(productSearchTitle({title:'Butter 500g',quantity:'50g'}),'Butter 500g 50g');
});
test('title selection cards offer title actions only and search with size',()=>{
 const react={createElement:(type,props,...children)=>({type,props:{...props,children}})};
 const rendered={exports:{},require:name=>name==='react'?react:name==='react-native'?{View:'View',Text:'Text',Image:'Image',TouchableOpacity:'TouchableOpacity',ActivityIndicator:'ActivityIndicator',StyleSheet:{create:x=>x},Linking:{openURL:()=>{throw Error('unexpected store navigation')}}}:{productSearchTitle}};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../mobile/src/components/StoreCard.tsx'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true,target:ts.ScriptTarget.ES2020}}).outputText,rendered);
 const selected=[],searched=[];
 const root=rendered.exports.StoreCard({store:{platformName:'Blinkit',candidates:[{id:'1',title:'Amul Butter',quantity:'500g',price:300,image:''}],comparisonMatch:true},selectionMode:'title',onSelectCandidate:index=>selected.push(index),onSearchTitle:title=>searched.push(title)});
 const nodes=[];const walk=node=>{if(!node||typeof node!=='object')return;if(Array.isArray(node)){node.forEach(walk);return;}nodes.push(node);walk(node.props?.children);};walk(root);
 assert.ok(!nodes.some(node=>String(node.props?.accessibilityLabel||'').startsWith('Compare')));
 assert.ok(!nodes.some(node=>node.props?.children?.includes('In your comparison')));
 nodes.find(node=>node.props?.accessibilityLabel==='Use title Amul Butter, ₹300, from Blinkit').props.onPress();
 nodes.find(node=>node.props?.accessibilityLabel==='Search for Amul Butter 500g').props.onPress();
 assert.deepEqual(selected,[0]);assert.deepEqual(searched,['Amul Butter 500g']);
});
