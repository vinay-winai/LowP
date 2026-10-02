const {execFileSync}=require('node:child_process');
const adb='X:\\platform-tools\\adb.exe';
const command=(...args)=>execFileSync(adb,args,{encoding:'utf8'}).trim();
(async()=>{
 command('shell','am','force-stop','host.exp.exponent');
 command('shell','am','start','-a','android.intent.action.VIEW','-d','exp://127.0.0.1:8082','-p','host.exp.exponent');
 let forwarded=false;
 for(let attempt=0;attempt<70;attempt++){
  if(!forwarded){
   const socket=command('shell','cat','/proc/net/unix').match(/@webview_devtools_remote_\d+/)?.[0];
   if(socket){command('forward','tcp:9224',`localabstract:${socket.slice(1)}`);forwarded=true;}
  }
  if(forwarded){
   try{
    const pages=(await (await fetch('http://127.0.0.1:9224/json')).json()).filter(p=>p.type==='page');
    if(pages.some(p=>p.url.includes('flipkart.com'))){
     console.log('Before interruption',JSON.stringify(pages.map(p=>({id:p.id,url:p.url}))));
     command('shell','input','tap','161','628');
     console.log('Submitted Paneer 200g while Flipkart check was loading');return;
    }
   }catch{}
  }
  await new Promise(resolve=>setTimeout(resolve,500));
 }
 throw Error('Flipkart check was not reached');
})();
