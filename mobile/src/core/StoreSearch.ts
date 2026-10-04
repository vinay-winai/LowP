// Only search-page controls are eligible. Account/location forms are never used.
export const WARM_SEARCH_STORES = ['zepto', 'instamart', 'blinkit', 'amazon_tez'];
export const warmSearchDeadline = (platformId: string) => platformId === 'instamart' ? 4500 : 2800;

export function storeSearchScript(platformId: string, query: string, searchId: number, scraper: string) {
  return `(function () {
    window.__lowpWarmSearch?.dispose();
    window.__lowpScraper?.dispose();
    const platformId = ${JSON.stringify(platformId)}, query = ${JSON.stringify(query)}, searchId = ${searchId};
    const configs = {
      zepto: ['input[placeholder*="Search for"]', '[data-testid="product-card"]', 'query'],
      instamart: ['input[data-testid="search-page-header-search-bar-input"]', '[data-testid="item-collection-card-full"]', 'query'],
      blinkit: ['input[placeholder*="Search for"]', 'div[role="button"][id][data-pf]', 'q'],
      amazon_tez: ['input[data-testid="search-input"]', 'div[role="button"]:has(p[role="heading"])', 'searchKeyword']
    };
    let timer, disposed = false, stable = 0, state = {};
    const dispose = () => { disposed = true; clearTimeout(timer); };
    window.__lowpWarmSearch = {dispose};
    const fallback = () => {
      if (disposed) return;
      dispose();
      window.ReactNativeWebView.postMessage(JSON.stringify({type:'LOWP_SEARCH_FALLBACK', platformId, searchId, state}));
    };
    try {
      const current = new URL(location.href);
      const allowed = platformId === 'zepto' && current.hostname === 'www.zepto.com' && current.pathname === '/search' ||
        platformId === 'instamart' && current.hostname === 'www.swiggy.com' && current.pathname === '/instamart/search' ||
        platformId === 'blinkit' && current.hostname === 'blinkit.com' && current.pathname === '/s/' ||
        platformId === 'amazon_tez' && current.hostname === 'www.amazon.in' && current.pathname === '/tez/browse/search';
      if (!allowed) { fallback(); return; }
      const config = configs[platformId];
      const input = config && document.querySelector(config[0]);
      const oldCards = config ? Array.from(document.querySelectorAll(config[1])) : [];
      // Swiggy recycles card containers. Its product image alt identifies the
      // product independently of changing delivery times, badges, and prices.
      const identity = card => platformId === 'instamart' ? (card.querySelector('img[alt]')?.getAttribute('alt') || '').trim() : '';
      const oldIdentities = oldCards.map(identity);
      // Without known previous cards we cannot prove old results were replaced.
      if (!input || input.disabled || input.readOnly || !oldCards.length) { fallback(); return; }
      const submitForm = platformId === 'instamart' || platformId === 'amazon_tez';
      if (submitForm && typeof input.form?.requestSubmit !== 'function') { fallback(); return; }
      const started = Date.now();
      const normalize = value => String(value || '').trim().toLowerCase().replace(/\\s+/g, ' ');
      const tick = () => {
        if (disposed) return;
        const url = new URL(location.href);
        let urlQuery = url.searchParams.get(config[2]);
        // Amazon's own search form encodes spaces before the router encodes
        // the parameter again. Decode only when literal matching fails.
        if (platformId === 'amazon_tez' && normalize(urlQuery) !== normalize(query)) {
          try { urlQuery = decodeURIComponent(urlQuery || ''); } catch (_) {}
        }
        state = {queryMatches: normalize(urlQuery) === normalize(query), inputMatches: normalize(input.value) === normalize(query),
          oldCardsRemaining: oldCards.filter(card => card.isConnected).length,
          oldProductsRemaining: oldCards.filter((card, index) => card.isConnected &&
            (!oldIdentities[index] || !identity(card) || identity(card) === oldIdentities[index])).length,
          cards: document.querySelectorAll(config[1]).length};
        const fresh = state.queryMatches && state.inputMatches && state.oldProductsRemaining === 0 && state.cards > 0;
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
        if (Date.now() - started >= ${warmSearchDeadline(platformId)}) { fallback(); return; }
        timer = setTimeout(tick, 100);
      };
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      input.focus();
      setter.call(input, query);
      input.dispatchEvent(new Event('input', {bubbles:true}));
      input.dispatchEvent(new Event('change', {bubbles:true}));
      if (submitForm) {
        // Synthetic Enter does not perform the browser's default form submit.
        // Let React commit the changed input before its onSubmit reads state.
        // Swiggy also debounces suggestions; submitting in the same burst can
        // leave its background page showing the previous result set.
        timer = setTimeout(() => {
          if (disposed) return;
          try { input.form.requestSubmit(); timer = setTimeout(tick, 100); }
          catch (_) { fallback(); }
        }, platformId === 'instamart' ? 500 : 100);
        return;
      }
      input.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', code:'Enter', keyCode:13, which:13, bubbles:true}));
      input.dispatchEvent(new KeyboardEvent('keyup', {key:'Enter', code:'Enter', keyCode:13, which:13, bubbles:true}));
      timer = setTimeout(tick, 100);
    } catch (_) { fallback(); }
  })(); true;`;
}
