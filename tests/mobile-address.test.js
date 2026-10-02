const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('../mobile/node_modules/typescript');
const compile=file=>ts.transpileModule(fs.readFileSync(require.resolve(file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const session={exports:{},URL,Date};vm.runInNewContext(compile('../mobile/src/core/StoreSession.ts'),session);
const context={exports:{},URL,require:()=>session.exports};vm.runInNewContext(compile('../mobile/src/core/StoreAddress.ts'),context);
const address=context.exports;

test('PIN input accepts only six digits and validates Indian PIN format',()=>{
 assert.equal(address.normalizePinInput('50a00-85'),'500085');
 assert.equal(address.normalizePinInput('500085123'),'500085');
 assert.equal(address.normalizePinInput('Hyderabad'),'');
 for(const value of ['', '50008', '5000850', '050085', 'abcdef', '500 85']) assert.equal(address.isValidPin(value),false);
 assert.equal(address.isValidPin('500085'),true);
 assert.equal(address.addressPin('Hyderabad 500085'),'500085');
});

test('fallback address normalization and PIN extraction do not invent a delivery address',()=>{
 assert.equal(address.normalizeAddress('  Hyderabad\n  500081 '),'Hyderabad 500081');
 assert.equal(address.addressPin('Hyderabad 500081'),'500081');
 assert.equal(address.addressPin('Area without PIN'),'');assert.equal(address.addressPin('050081'),'');
 assert.equal(address.normalizeAddress('a'.repeat(600)).length,500);
});

test('address helper bridge rejects stale tokens, foreign stores/domains and invalid results',()=>{
 const payload={type:'LOWP_ADDRESS_HELPER',platformId:'blinkit',token:'now',url:'https://blinkit.com/',result:'filled'};
 const read=(patch={},nativeUrl='https://blinkit.com/')=>address.readAddressHelpMessage(JSON.stringify({...payload,...patch}),'blinkit','now',nativeUrl);
 assert.equal(read(),'filled');assert.equal(read({token:'old'}),null);assert.equal(read({platformId:'zepto'}),null);
 assert.equal(read({url:'https://blinkit.com.attacker.test/'}),null);assert.equal(read({},'http://blinkit.com/'),null);
 assert.equal(read({result:'address_saved'}),null);assert.equal(read({result:'toString'}),null);
});

function input(placeholder,type='text') {
 let value='';const events=[];
 const element={type,placeholder,id:'',events,getAttribute:name=>name==='placeholder'?placeholder:null,closest:()=>null,
  getClientRects:()=>[{width:100,height:40}],scrollIntoView(){},focus(){this.focused=true;},dispatchEvent(event){events.push(event.type);}};
 Object.defineProperty(element,'value',{get:()=>value,set:next=>{value=next;}});
 return element;
}
function harness({id='blinkit',query='Hyderabad 500081',fields=[],control=null,specific=control,searchControl=null,heading=null,panel=null,status='unknown',path='/p/example'}={}) {
 let tick,now=0,cleared=false;const sent=[];
 class NativeInput {}Object.defineProperty(NativeInput.prototype,'value',{set(value){this.value=value;}});
 const window={__lowpSessionStatus:status,addEventListener(){},removeEventListener(){},ReactNativeWebView:{postMessage:raw=>sent.push(JSON.parse(raw))}};window.top=window;
 const document={querySelector:selector=>selector==='[data-testid="search-location"]'?searchControl:specific,querySelectorAll:selector=>selector==='input'?fields:selector==='[role="dialog"]'?[]:selector==='div'?(heading?[heading]:[]):selector==='h1,h2,h3,div,span'?(panel?[panel]:[]):control?[control]:[]};
 vm.runInNewContext(address.addressHelperScript(id,'token',query),{window,document,location:{href:'https://blinkit.com/',origin:'https://blinkit.com',pathname:path},URL,
  Date:{now:()=>now},HTMLInputElement:NativeInput,Event:class {constructor(type){this.type=type;}},
  getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1'}),
  setInterval:fn=>{tick=fn;return 1;},clearInterval:()=>{cleared=true;}});
 return {sent,tick:()=>tick(),advance(ms){now=ms;tick();},expire(){now=6001;tick();},get cleared(){return cleared;}};
}

test('guest-location search fills query and emits input changes without submitting or selecting',()=>{
 const phone=input('Enter mobile number','tel'),product=input('Search for products'),field=input('Search delivery location');
 const h=harness({fields:[phone,product,field]});
 assert.equal(field.value,'Hyderabad 500081');assert.deepEqual(field.events,['input','change']);assert.equal(phone.value,'');assert.equal(product.value,'');
 assert.equal(h.sent[0].result,'filled');assert.equal(h.cleared,true);h.tick();assert.equal(h.sent.length,1);assert.deepEqual(field.events,['input','change']);
});

test('Fill address leaves an already open location panel open instead of toggling it again',()=>{
 const control={clicks:0,closest:()=>null,getClientRects:()=>[{width:40,height:20}],getAttribute:()=>null,click(){this.clicks++;}};
 const panel={...control,children:[],textContent:'Saved addresses'};
 const h=harness({id:'flipkart',control,panel});assert.equal(control.clicks,0);
 h.expire();assert.equal(control.clicks,0);assert.equal(h.sent[0].result,'opened');
});

test('Flipkart home waits for its address row to settle, opens once and fills the store search',()=>{
 const control={clicks:0,closest:()=>null,getClientRects:()=>[{width:40,height:20}],getAttribute:()=>null,click(){this.clicks++;}};
 const fields=[],h=harness({id:'flipkart',path:'/',control,fields});assert.equal(control.clicks,0);
 h.advance(1499);assert.equal(control.clicks,0);h.advance(1500);assert.equal(control.clicks,1);
 h.advance(3500);assert.equal(control.clicks,1);
 const field=input('Search by area, street name, pin code');fields.push(field);h.tick();
 assert.equal(field.value,'Hyderabad 500081');assert.equal(h.sent[0].result,'filled');
});

test('postal fields use only the PIN and request a PIN when missing',()=>{
 const field=input('Enter Delivery Pincode');const h=harness({id:'flipkart',fields:[field]});
 assert.equal(field.value,'500081');assert.equal(h.sent[0].result,'filled');
 const missing=input('Enter Delivery Pincode');assert.equal(harness({query:'Hyderabad',fields:[missing]}).sent[0].result,'pin_required');assert.equal(missing.value,'');
 const search=input('Search by area, street name, pin code');harness({id:'flipkart',query:'Hydernagar Hyderabad 500085',fields:[search]});assert.equal(search.value,'Hydernagar Hyderabad 500085');
});

test('location helper opens only a safe location control and waits for the store field',()=>{
 const control={clicks:0,closest:()=>null,getClientRects:()=>[{width:40,height:20}],getAttribute:()=>null,click(){this.clicks++;}};
 const fields=[],h=harness({fields,control});assert.equal(control.clicks,1);assert.equal(h.sent.length,0);
 const field=input('Search for area, street name');fields.push(field);h.tick();assert.equal(field.value,'Hyderabad 500081');assert.equal(h.sent[0].result,'filled');
 const unsafe={...control,clicks:0,getAttribute:name=>name==='href'?'/logout':null};assert.equal(harness({control:unsafe}).sent[0].result,'manual');assert.equal(unsafe.clicks,0);
});

test('Swiggy home address bar opens the location search and fills without choosing a match',()=>{
 const bar={clicks:0,closest:()=>null,getClientRects:()=>[{width:200,height:40}],getAttribute:()=>null,click(){this.clicks++;}};
 const fields=[],h=harness({id:'instamart',path:'/instamart',control:bar,fields});
 assert.equal(bar.clicks,1);
 const field=input('Search for area, street name');fields.push(field);h.tick();
 assert.equal(field.value,'Hyderabad 500081');assert.equal(h.sent[0].result,'filled');assert.equal(bar.clicks,1);
});

test('Swiggy location summary opens its secondary search control only once',()=>{
 const fields=[],search={clicks:0,closest:()=>null,getClientRects:()=>[{width:200,height:40}],click(){this.clicks++;}};
 const h=harness({id:'instamart',searchControl:search,fields});h.tick();assert.equal(search.clicks,1);
 const field=input('Search for an area or address');fields.push(field);h.tick();
 assert.equal(field.value,'Hyderabad 500081');assert.equal(h.sent[0].result,'filled');assert.equal(search.clicks,1);
});

test('signed-in accounts can search for a replacement location without submitting login forms',()=>{
 const field=input('Search delivery location');assert.equal(harness({fields:[field],status:'signed_in'}).sent[0].result,'filled');assert.equal(field.value,'Hyderabad 500081');
 const phone=input('Enter Phone Number','tel');assert.equal(harness({fields:[phone]}).sent[0].result,'requires_login');assert.equal(phone.value,'');
 const h=harness();h.expire();assert.equal(h.sent[0].result,'manual');assert.equal(h.cleared,true);
 const otp=input('Enter PIN code');otp.closest=selector=>selector==='form'?{textContent:'Sign in Verify OTP'}:null;
 const protectedForm=harness({fields:[otp]});protectedForm.expire();assert.equal(otp.value,'');assert.equal(protectedForm.sent[0].result,'manual');
});

test('selected Zepto address targets its clickable ancestor and Flipkart Change remains delivery-scoped',()=>{
 const button={clicks:0,closest:()=>null,getClientRects:()=>[{width:40,height:20}],getAttribute:()=>null,click(){this.clicks++;}};
 const label={...button,closest:selector=>selector.includes('button')?button:null};
 harness({id:'zepto',control:label});assert.equal(button.clicks,1);assert.equal(label.clicks,0);
 const change={...button,clicks:0,textContent:'Change',parentElement:{textContent:'500085 Change',parentElement:{textContent:'Delivery to 500085 Change'}},getAttribute:()=>null};
 harness({id:'flipkart',control:change,specific:null});assert.equal(change.clicks,1);
 const account={...change,clicks:0,parentElement:{textContent:'Change account password'}};
 const denied=harness({id:'flipkart',control:account,specific:null});denied.expire();assert.equal(account.clicks,0);assert.equal(denied.sent[0].result,'manual');
 const mobile={...button,clicks:0};
 const heading={children:[],textContent:'Delivery details',parentElement:{parentElement:{textContent:'Delivery details Hyderabad',querySelector:()=>mobile}}};
 harness({id:'flipkart',specific:null,heading});assert.equal(mobile.clicks,1);
});
