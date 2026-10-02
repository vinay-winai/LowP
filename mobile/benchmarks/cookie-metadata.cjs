// Prints only cookie metadata. Never print cookie values or complete CDP replies.
(async () => {
 const pages=await(await fetch('http://127.0.0.1:9224/json')).json();
 const page=pages.find(p=>/swiggy|zepto|flipkart/.test(p.url));
 if(!page) throw Error('No store WebView');
 const socket=new WebSocket(page.webSocketDebuggerUrl);
 const result=await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{socket.close();reject(Error('Timeout'));},4000);
  socket.onopen=()=>socket.send(JSON.stringify({id:1,method:'Network.getCookies',params:{urls:['https://www.swiggy.com/','https://www.swiggy.com/instamart','https://www.flipkart.com/','https://www.zepto.com/']}}));
  socket.onmessage=event=>{const reply=JSON.parse(event.data);if(reply.id===1){clearTimeout(timer);socket.close();resolve(reply.result?.cookies||[]);}};
  socket.onerror=reject;
 });
 console.log(JSON.stringify(result.map(({name,domain,path,httpOnly,secure})=>({name,domain,path,httpOnly,secure}))));
})();
