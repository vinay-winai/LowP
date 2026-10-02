// Development-only image A/B experiment. Never changes cookies or website data.
// Commands on stdin: block, allow, report, exit. Only WebView Image requests
// are blocked; product thumbnails loaded by React Native are unaffected.
const readline = require('node:readline');
const clients = [];
let blocked = false;
async function attach(page) {
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  const pending = new Map(); let sequence = 0, imagesBlocked = 0;
  await new Promise((resolve, reject) => {socket.onopen = resolve; socket.onerror = reject;});
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => {pending.delete(id); reject(Error(method + ' timeout'));}, 5000);
    pending.set(id, {resolve, reject, timer}); socket.send(JSON.stringify({id, method, params}));
  });
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if(message.method === 'Fetch.requestPaused') {
      imagesBlocked++;
      send('Fetch.failRequest', {requestId: message.params.requestId, errorReason:'BlockedByClient'}).catch(()=>{});
    }
    const request = pending.get(message.id);
    if(request) {clearTimeout(request.timer); pending.delete(message.id); message.error ? request.reject(Error(message.error.message)) : request.resolve(message.result);}
  };
  return {socket,send,id:page.id,get imagesBlocked(){return imagesBlocked;},reset(){imagesBlocked=0;}};
}
async function configure(value) {
  blocked=value;
  const pages=await (await fetch('http://127.0.0.1:9224/json')).json();
  for(const page of pages.filter(p=>p.type==='page')) if(!clients.some(c=>c.id===page.id)) clients.push(await attach(page));
  for(const client of clients) {
    client.reset();
    await client.send(value?'Fetch.enable':'Fetch.disable',value?{patterns:[{urlPattern:'*',resourceType:'Image',requestStage:'Request'}]}:{});
  }
  console.log(JSON.stringify({mode:blocked?'images-blocked':'normal',views:clients.length}));
}
async function report() {
  for(const client of clients) {
    const result=await client.send('Runtime.evaluate',{returnByValue:true,expression:`JSON.stringify((()=>{
      const resources=performance.getEntriesByType('resource');const groups={};
      for(const r of resources){const kind=r.initiatorType;const g=groups[kind]||=( {count:0,transferBytes:0,decodedBytes:0,maxEndMs:0});g.count++;g.transferBytes+=r.transferSize||0;g.decodedBytes+=r.decodedBodySize||0;g.maxEndMs=Math.max(g.maxEndMs,Math.round(r.responseEnd));}
      return {host:location.hostname,path:location.pathname,groups,scraper:window.__lowpScraper?.state()};
    })())`});
    console.log(JSON.stringify({view:client.id,blocked:client.imagesBlocked,data:JSON.parse(result.result.value)}));
  }
}
async function close(){await Promise.allSettled(clients.map(c=>c.send('Fetch.disable')));clients.forEach(c=>c.socket.close());process.exit(0);}
(async()=>{
  await configure(false);
  const input=readline.createInterface({input:process.stdin});
  for await(const line of input) {
    try {if(line.trim()==='block') await configure(true);else if(line.trim()==='allow') await configure(false);else if(line.trim()==='report') await report();else if(line.trim()==='exit') await close();} catch(error){console.error(error.message);}
  }
  await close();
})().catch(error=>{console.error(error.message);process.exitCode=1;});
