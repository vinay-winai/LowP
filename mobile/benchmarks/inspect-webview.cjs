// Read development WebView state through an ADB-forwarded CDP port.
const expression = `JSON.stringify({
  readyState: document.readyState,
  bodyText: document.body.innerText.slice(0, 1400),
  scraper: window.__lowpScraper && window.__lowpScraper.state(),
  navigation: performance.getEntriesByType('navigation').map(n => ({responseEnd:n.responseEnd,domInteractive:n.domInteractive,load:n.loadEventEnd}))
})`;
(async () => {
  const pages = await (await fetch('http://127.0.0.1:9224/json')).json();
  for (const page of pages.filter(p => p.type === 'page' && JSON.parse(p.description || '{}').attached)) {
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { socket.close(); reject(new Error('CDP timeout')); }, 4000);
      socket.onopen = () => socket.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,returnByValue:true}}));
      socket.onmessage = event => {
        const message = JSON.parse(event.data);
        if(message.id !== 1) return;
        clearTimeout(timer); socket.close(); resolve(message.result || message.error);
      };
      socket.onerror = reject;
    });
    console.log(page.id, page.url, JSON.stringify(result));
  }
})();
