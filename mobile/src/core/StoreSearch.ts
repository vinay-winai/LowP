// Only search-page controls are eligible. Account/location forms are never used.
// Zepto is verified on-device. Other stores keep normal navigation until their
// search controls and result replacement can be verified reliably.
export const WARM_SEARCH_STORES = ['zepto'];

export function storeSearchScript(platformId: string, query: string, searchId: number, scraper: string) {
  return `(function () {
    window.__lowpWarmSearch?.dispose();
    window.__lowpScraper?.dispose();
    const platformId = ${JSON.stringify(platformId)}, query = ${JSON.stringify(query)}, searchId = ${searchId};
    const configs = {
      zepto: ['input[placeholder*="Search for"]', '[data-testid="product-card"]', 'query']
    };
    let timer, disposed = false, stable = 0;
    const dispose = () => { disposed = true; clearTimeout(timer); };
    window.__lowpWarmSearch = {dispose};
    const fallback = () => {
      if (disposed) return;
      dispose();
      window.ReactNativeWebView.postMessage(JSON.stringify({type:'LOWP_SEARCH_FALLBACK', platformId, searchId}));
    };
    try {
      const current = new URL(location.href);
      const allowed = platformId === 'zepto' && current.hostname === 'www.zepto.com' && current.pathname === '/search';
      if (!allowed) { fallback(); return; }
      const config = configs[platformId];
      const input = config && document.querySelector(config[0]);
      const oldCards = config ? Array.from(document.querySelectorAll(config[1])) : [];
      // Without known previous cards we cannot prove old results were replaced.
      if (!input || input.disabled || input.readOnly || !oldCards.length) { fallback(); return; }
      const started = Date.now();
      const tick = () => {
        if (disposed) return;
        const url = new URL(location.href);
        const fresh = url.searchParams.get(config[2]) === query && input.value === query &&
          oldCards.every(card => !card.isConnected) && document.querySelectorAll(config[1]).length > 0;
        if (fresh) {
          if (!stable) stable = Date.now();
          if (Date.now() - stable >= 350) {
            dispose();
            window.__lowpDocumentRequestId = searchId;
            // Initial SSR data can still describe the previous query after SPA navigation.
            window.__lowpSkipInitialSearchData = true;
            window.ReactNativeWebView.postMessage(JSON.stringify({type:'LOWP_SEARCH_READY', platformId, searchId}));
            ${scraper}
            return;
          }
        } else stable = 0;
        if (Date.now() - started >= 2800) { fallback(); return; }
        timer = setTimeout(tick, 100);
      };
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      input.focus();
      setter.call(input, query);
      input.dispatchEvent(new Event('input', {bubbles:true}));
      input.dispatchEvent(new Event('change', {bubbles:true}));
      input.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', code:'Enter', keyCode:13, which:13, bubbles:true}));
      input.dispatchEvent(new KeyboardEvent('keyup', {key:'Enter', code:'Enter', keyCode:13, which:13, bubbles:true}));
      timer = setTimeout(tick, 100);
    } catch (_) { fallback(); }
  })(); true;`;
}
