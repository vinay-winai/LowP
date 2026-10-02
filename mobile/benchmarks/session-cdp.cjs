const [match, expression] = process.argv.slice(2);
(async () => {
 const pages = await (await fetch('http://127.0.0.1:9224/json')).json();
 const matching = pages.filter(p => p.url === match || p.url.includes(match));
 const page = matching.find(p => {try {const d=JSON.parse(p.description);return d.attached && d.visible && d.screenX >= 0 && d.screenY >= 0;} catch {return false;}}) ||
   matching.find(p => p.url === match) || matching[0];
 if (!page) throw Error('No matching WebView');
 const socket = new WebSocket(page.webSocketDebuggerUrl);
 const result = await new Promise((resolve,reject) => {
  const timer=setTimeout(()=>{socket.close();reject(Error('Timeout'));},4000);
  socket.onopen=()=>socket.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,returnByValue:true}}));
  socket.onmessage=e=>{const m=JSON.parse(e.data);if(m.id===1){clearTimeout(timer);socket.close();resolve(m.result||m.error);}};
  socket.onerror=reject;
 });
 console.log(page.id,page.url,JSON.stringify(result));
})();

