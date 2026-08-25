export function generateScraperScript(searchQuery: string, platformId: string): string {
  const sanitizedQuery = JSON.stringify(searchQuery);
  const sanitizedPlatformId = JSON.stringify(platformId);

  return `
(function() {
  // A navigation should have exactly one extraction loop. Guard against a
  // duplicate native injection before it starts another full DOM scan.
  if (window.__lowpScraperTimer) {
    clearInterval(window.__lowpScraperTimer);
    window.__lowpScraperTimer = null;
  }
  const searchQuery = ${sanitizedQuery};
  const targetPlatformId = ${sanitizedPlatformId};

  function titleKey(str) {
    return String(str || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  // Same physical product scraped twice (outer grid cell + inner card, or at
  // two ancestor depths) must not yield two candidates. Titles scraped from
  // different depths differ by a glued pack size, so equal-priced containment
  // counts as a duplicate too.
  function isDuplicateCandidate(list, item) {
    const key = titleKey(item.title);
    return list.some((c) => {
      if (c.price !== item.price) return false;
      const k = titleKey(c.title);
      return k === key ||
        (key.length >= 8 && k.includes(key)) ||
        (k.length >= 8 && key.includes(k));
    });
  }

  function isBadTitle(str) {
    if (!str || typeof str !== "string") return true;
    const s = str.trim().toLowerCase();
    if (s.length < 2 || s.length > 150) return true;

    // Reject numeric / unit fragments ("/100 ml", "466", "% off") that the
    // generic text fallback sometimes grabs instead of a real product name.
    if ((s.match(/[a-z]/g) || []).length < 3) return true;

    // Reject UI glyph names picked up as text ("down-chevron-icon", svg ids).
    if (/(^|[\s-])(icon|chevron|arrow|sprite|svg)([\s-]|$)|-icon$/.test(s)) return true;

    // Reject shelf/category labels and badges scraped instead of a name.
    if (/previously bought|earlier bought|already bought/.test(s)) return true;

    const bannedPatterns = [
      /^(home|cart|search|login|help|offers|new|corporate|swiggy|zepto|amazon|blinkit|menu|account|profile|orders|notifications)$/i,
      /^(delivery in\\s*\\d+\\s*(?:mins?|minutes?)|\\d+\\s*(?:mins?|minutes?|hours?|sec|seconds?)|\\d+\\s*-\\s*\\d+\\s*(?:mins?|minutes?))$/i,
      /^(fastest delivery|standard delivery|get it in|unlock free delivery|free delivery|instant delivery)$/i,
      /^(showing results for|results for|search results for)/i,
      /^(out of stock|sold out|unavailable|currently unavailable|add|added|buy|view|closed|loading|customise|in stock|add to cart|add item|qty|\\+|\\-)$/i,
      /^(trending|bestseller|offers?|save|flat|best price|discount|\\d+%\\s*off|save\\s*₹?\\d+|\\d+\\s*off|see all|view all|explore)$/i,
      /^(corporate|falcon|help & support|categories|see more|product image|cart icon|item image|image|photo|thumbnail|logo|banner|offer_icon|offer icon|coupon|promo)$/i,
      /^(item|product|unit|pack|pc|pcs|piece|pieces|kg|gm|g|l|ml)$/i,
      /^(shop for\\b|unlock\\b|\\d+\\s*(?:more|items?)\\s*(?:to|for|worth)|items? worth)/i
    ];

    const words = s.split(/\\s+/);
    const wordCounts = {};
    for (const w of words) {
      if (w.length >= 3) {
        wordCounts[w] = (wordCounts[w] || 0) + 1;
        if (wordCounts[w] >= 4) return true;
      }
    }

    return bannedPatterns.some(p => p.test(s));
  }

  function cleanTitle(str) {
    if (!str || typeof str !== "string") return "";
    return str
      .replace(/^sponsored\\s*/i, "")
      .replace(/^\\s*\\d+(?:\\.\\d+)?\\s*%\\s*off\\s*/i, "")
      .replace(/(?:₹|Rs\\.?|INR)\\s*[0-9,]+(?:\\.[0-9]+)?/gi, "")
      .replace(/\\b(?:delivery in\\s*)?\\d+(?:\\s*-\\s*\\d+)?\\s*(?:mins?|minutes?|hours?|sec|seconds?)\\b/gi, "")
      .replace(/\\b(?:fastest delivery|standard delivery|instant delivery|express delivery|free delivery|delivery)\\b/gi, "")
      .replace(/\\b(?:mrp|add|buy|added|in stock|out of stock|off|\\d+%\\s*off|save)\\b/gi, "")
      .replace(/\\s+/g, " ")
      .trim();
  }

  function scoreRelevance(itemTitle, query, packSize) {
    if (!itemTitle || !query || !query.trim()) return 0;
    const normalize = (str) => (str || "").toLowerCase().replace(/['’\`"]/g, "").replace(/[^a-z0-9\\s]/g, " ").replace(/\\s+/g, " ").trim();
    const fullText = normalize(itemTitle + " " + (packSize || ""));
    const q = normalize(query);
    const queryTokens = q.split(/\\s+/).filter(Boolean);

    let score = 0;
    queryTokens.forEach(token => {
      if (fullText.includes(token)) score += 30;
      else if (token.endsWith('s') && token.length > 3 && fullText.includes(token.slice(0, -1))) score += 25;
      else if (!token.endsWith('s') && fullText.includes(token + 's')) score += 25;
    });

    const qtyMatch = query.match(/(\\d+(?:\\.\\d+)?)\\s*(l|litre|litres|kg|kgs|g|gm|gms|ml)/i);
    if (qtyMatch) {
      const qNum = parseFloat(qtyMatch[1]);
      const qUnit = qtyMatch[2].toLowerCase().replace(/litre|litres/, 'l').replace(/kgs?/, 'kg').replace(/gms?/, 'g');
      const targetQtyStr = qNum + " " + qUnit;
      const targetQtyCompact = qNum + qUnit;
      if (fullText.includes(targetQtyStr) || fullText.includes(targetQtyCompact)) {
        score += 40;
      } else {
        const candQtyMatch = fullText.match(/(\\d+(?:\\.\\d+)?)\\s*(l|litre|litres|kg|kgs|g|gm|gms|ml)/i);
        if (candQtyMatch) {
          const cNum = parseFloat(candQtyMatch[1]);
          if (cNum !== qNum) score -= 40;
        }
      }
    }

    if (queryTokens.length > 0 && fullText.includes(queryTokens[0])) score += 25;
    return score;
  }

  function getSpacedText(node) {
    if (!node) return "";
    if (node.nodeType === 3) return (node.nodeValue || "") + " ";
    let text = "";
    const children = node.childNodes || [];
    for (let i = 0; i < children.length; i++) {
      text += getSpacedText(children[i]);
    }
    return text;
  }

  function extractFromCard(cardNode, platformId) {
    if (!cardNode) return null;
    if (cardNode.closest && cardNode.closest('[class*="filter"], [class*="suggestion"], [class*="chip"], [class*="pill"], [class*="breadcrumb"], [class*="header"], [class*="footer"], [class*="nav"], header, footer, nav')) {
      return null;
    }

    // Reject overlay/app-chrome nodes (sticky "Shop for ₹X to unlock free
    // delivery" banners, bottom bars): they carry prices but are not products.
    let overlayProbe = cardNode;
    let overlayDepth = 0;
    while (overlayProbe && overlayProbe !== document.body && overlayDepth < 8) {
      try {
        const cs = window.getComputedStyle ? window.getComputedStyle(overlayProbe) : null;
        if (cs && (cs.position === "fixed" || cs.position === "sticky")) return null;
      } catch (e) {}
      overlayProbe = overlayProbe.parentElement;
      overlayDepth++;
    }

    const spacedCardText = getSpacedText(cardNode).replace(/\\s+/g, " ").trim();
    
    // 1. Price extraction
    let price = null;
    const priceEl = cardNode.querySelector ? cardNode.querySelector('[data-slot-id="EdlpPrice"], [data-testid*="price"], [data-testid*="item_price"], [data-testid*="offer-price"], [class*="_2jn41"], [class*="_1yW90"], [class*="_3-M84"]') : null;
    if (priceEl) {
      const pTxt = getSpacedText(priceEl).trim();
      const m = pTxt.match(/([0-9,]+(?:\\.[0-9]+)?)/);
      if (m) {
        const val = parseFloat(m[1].replace(/,/g, ""));
        if (val >= 5 && val <= 500000) price = val;
      }
    }

    if (!price || isNaN(price)) {
      const literalMatch = spacedCardText.match(/(?:₹|Rs\\.?|INR)\\s*([0-9,]+(?:\\.[0-9]+)?)/i);
      if (literalMatch) {
        const val = parseFloat(literalMatch[1].replace(/,/g, ""));
        if (val >= 5 && val <= 500000) price = val;
      }
    }

    if (!price || isNaN(price)) {
      const children = cardNode.querySelectorAll ? cardNode.querySelectorAll('div, span, p, b, strong') : [];
      for (const el of children) {
        if (el.children && el.children.length > 0) continue;
        const txt = el.textContent ? el.textContent.trim() : "";
        if (txt && /^\\s*[0-9]{2,5}(?:\\.[0-9]+)?\\s*$/.test(txt)) {
          const val = parseFloat(txt);
          if (val >= 5 && val <= 500000) {
            price = val;
            break;
          }
        }
      }
    }

    if (!price || price <= 0 || price > 500000) return null;

    const imgEl = cardNode.querySelector ? cardNode.querySelector('img') : null;
    const image = imgEl ? (imgEl.src || "assets/icon48.png") : "assets/icon48.png";

    let title = "";
    const titleEl = cardNode.querySelector ? cardNode.querySelector('[data-slot-id="ProductName"], [data-testid*="name"], [data-testid*="title"], [data-testid*="item_name"], [data-testid*="item-title"], [data-slot-id*="title"], [class*="ProductName"], [class*="ItemName"], [class*="product_name"], [class*="styled__ItemName"], [class*="ItemTitle"], [class*="Product__UpdatedTitle"], [class*="tw-text-base-black"], [class*="tw-line-clamp-2"], [class*="_2T1-K"], [class*="nov9b"], [class*="_1W_4e"], [class*="_1b1-N"], h1, h2, h3, h4, h5') : null;
    if (titleEl) {
      const txt = cleanTitle(titleEl.textContent);
      if (txt && txt.length >= 3 && !isBadTitle(txt)) {
        title = txt;
      }
    }

    if (!title && imgEl && imgEl.alt && imgEl.alt.length > 5) {
      const altTxt = cleanTitle(imgEl.alt);
      if (altTxt && altTxt.length >= 3 && !isBadTitle(altTxt)) {
        title = altTxt;
      }
    }

    if (!title) {
      const textElements = cardNode.querySelectorAll ? cardNode.querySelectorAll('p, span, div, a') : [];
      for (const el of textElements) {
        const txt = cleanTitle(el.textContent);
        if (txt && txt.length >= 3 && txt.length <= 120 && !isBadTitle(txt)) {
          title = txt;
          break;
        }
      }
    }

    if (!title || isBadTitle(title)) return null;

    const qtyEl = cardNode.querySelector ? cardNode.querySelector('[data-slot-id="PackSize"], [data-testid*="quantity"], [data-testid*="weight"], [data-testid*="item_quantity"], [class*="PackSize"], [class*="weight"], [class*="quantity"], span[class*="pack"], span[class*="unit"]') : null;
    const quantity = qtyEl ? qtyEl.textContent.trim() : "1 unit";

    let mrp = price;
    const mrpMatch = spacedCardText.match(/(?:MRP|M\\.R\\.P|Strike)\\s*(?:₹|Rs\\.?|INR)?\\s*([0-9,]+(?:\\.[0-9]+)?)/i);
    if (mrpMatch) {
      const val = parseFloat(mrpMatch[1].replace(/,/g, ""));
      if (val >= price) mrp = val;
    }

    const brand = platformId === "amazon_tez" ? "Amazon Now (Tez)" : (platformId === "instamart" ? "Swiggy Instamart" : (platformId === "zepto" ? "Zepto" : (platformId === "blinkit" ? "Blinkit" : "Quick Store")));

    return {
      title,
      price,
      mrp: Math.max(mrp, price),
      brand,
      quantity,
      image,
      productUrl: window.location.href,
      platformId
    };
  }

  function runExtraction() {
    const candidates = [];

    // 1. Next.js Data Check
    try {
      const nextEl = document.getElementById('__NEXT_DATA__');
      if (nextEl && nextEl.textContent) {
        const nextJson = JSON.parse(nextEl.textContent);
        function walk(o) {
          if (!o || typeof o !== 'object') return;
          if ((o.name || o.display_name || o.product_name || o.title) && (o.price || o.mrp || o.final_price || o.sp || o.offer_price)) {
            const rawTitle = o.name || o.display_name || o.product_name || o.title;
            const cleanT = cleanTitle(rawTitle);
            const rawPrice = o.final_price || o.sp || o.offer_price || o.price || 0;
            const price = typeof rawPrice === 'number' ? (rawPrice > 1000 ? rawPrice / 100 : rawPrice) : parseFloat(rawPrice);
            const rawMrp = o.mrp || rawPrice;
            const mrp = typeof rawMrp === 'number' ? (rawMrp > 1000 ? rawMrp / 100 : rawMrp) : parseFloat(rawMrp);
            if (cleanT && price > 0 && !isBadTitle(cleanT)) {
              if (!isDuplicateCandidate(candidates, { title: cleanT, price })) {
                candidates.push({
                  title: cleanT,
                  price,
                  mrp: Math.max(mrp, price),
                  brand: targetPlatformId === "instamart" ? "Swiggy Instamart" : (targetPlatformId === "zepto" ? "Zepto" : (targetPlatformId === "blinkit" ? "Blinkit" : "Amazon Now (Tez)")),
                  quantity: o.quantity || o.pack_size || o.weight || "1 unit",
                  image: o.image || o.imageUrl || (o.imageId ? "https://media-assets.swiggy.com/swiggy/image/upload/fl_lossy,f_auto,q_auto,w_252,h_252/" + o.imageId : "assets/icon48.png"),
                  productUrl: window.location.href,
                  platformId: targetPlatformId
                });
              }
            }
          }
          for (const k of Object.keys(o)) {
            walk(o[k]);
          }
        }
        walk(nextJson);
      }
    } catch (e) {}

    // 2. Listing Cards
    const cardSelectors = [
      '[data-testid="item-collection-card-full"]',
      'div[class*="_3Rr1X"]',
      'div[class*="sWdPz"]',
      'div[class*="_1WDPG"]',
      '[data-testid="product-card"]',
      '[data-testid*="product"]',
      'div[class*="ProductCard"]',
      'div[class*="product-card"]',
      'div[class*="itemCard"]',
      'div[class*="product_card"]',
      'div[class*="styles__ProductCard"]',
      'div[class*="style__Card"]',
      'div[class*="item-card"]',
      'div[class*="card"]',
      'div[class*="Product__"]',
      'div[class*="tw-relative"]',
      'a[href*="/pn/"]',
      'a[href*="/product/"]',
      'a[href*="/item/"]',
      'a[href*="/dp/"]',
      'a[href*="/prid/"]',
      'a[href*="/p/"]',
      'div[data-component-type="s-search-result"]',
      'div[class*="s-result-item"]',
      'div[data-asin]'
    ];

    const allMatched = Array.from(document.querySelectorAll(cardSelectors.join(', ')));
    // Amazon wraps every product in BOTH an outer grid cell and an inner card
    // container; both match broad selectors so the same product is scraped
    // twice. Keep only innermost matches via pairwise contains().
    // Innermost-match sweep with early exits: once a node is proven to be a
    // wrapper (it contains another match) we stop comparing it, and proven
    // inner cards prune their own descendants in the same pass. This keeps
    // the cost near-linear in practice instead of a full n^2 grind, which
    // matters on mobile WebViews where the extraction loop re-runs the whole
    // pipeline on every hydration retry.
    const cards = [];
    const isWrapped = new Array(allMatched.length).fill(false);
    for (let i = 0; i < allMatched.length; i++) {
      if (isWrapped[i]) continue;
      const a = allMatched[i];
      let selfWrapped = false;
      for (let j = i + 1; j < allMatched.length; j++) {
        if (isWrapped[j]) continue;
        const b = allMatched[j];
        if (a.contains(b)) isWrapped[j] = true;
        else if (b.contains(a)) { selfWrapped = true; break; }
      }
      if (!selfWrapped) cards.push(a);
    }
    let scannedCards = 0;
    for (const card of cards) {
      if (++scannedCards > 150) break;
      const item = extractFromCard(card, targetPlatformId);
      if (item && item.price > 0 && !isDuplicateCandidate(candidates, item)) {
        item.__el = card;
        candidates.push(item);
        if (candidates.length >= 20) break;
      }
    }
    // Sponsored badges often sit OUTSIDE the innermost product node, so mark
    // items by geometry: badge rect -> nearest product card below it.
    try {
      const sponsoredRoots = [];
      const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let tn;
      while ((tn = tw.nextNode())) {
        if (/^sponsored$/i.test((tn.nodeValue || "").trim()) && tn.parentElement) {
          sponsoredRoots.push(tn.parentElement);
        }
      }
      const itemRects = sponsoredRoots.length
        ? candidates.filter((c) => c.__el).map((ci) => ({ ci, r: ci.__el.getBoundingClientRect() }))
        : [];
      for (const root of sponsoredRoots) {
        const b = root.getBoundingClientRect();
        let best = null;
        for (const ir of itemRects) {
          const vGap = ir.r.top - b.bottom;
          if (vGap < -24 || vGap > 220) continue;
          const overlap = Math.min(ir.r.right, b.right) - Math.max(ir.r.left, b.left);
          if (overlap < Math.min(ir.r.width, b.width) * 0.4) continue;
          if (!best || vGap < best.vGap) best = { ci: ir.ci, vGap };
        }
        if (best) best.ci.sponsored = true;
      }
    } catch (e) {}

    // 3. Proximity Fallback — the most expensive walk. Skip it while the
    // document is still a shell, cap the scan, and use targeted nodes for
    // stores with stable price containers (Tez keeps the full fallback).
    if (candidates.length === 0) {
      const docReady = document.readyState === "complete";
      if (docReady || cards.length > 0 || targetPlatformId === "amazon_tez") {
        const allEls = targetPlatformId === "amazon_tez"
          ? document.querySelectorAll('*')
          : document.querySelectorAll('[data-testid*="price" i], [class*="price" i], [class*="amount" i], [class*="cost" i], span');
        let scanned = 0;
        for (const el of allEls) {
          if (++scanned > 600) break;
          const text = el.textContent || '';
          if (/(?:₹|Rs\\.?|INR)\\s*[0-9,]+/i.test(text) && text.length < 30) {
            let parent = el.parentElement;
            let depth = 0;
            while (parent && depth < 6 && parent !== document.body) {
              const item = extractFromCard(parent, targetPlatformId);
              if (item && item.price > 0 && !isDuplicateCandidate(candidates, item)) {
                item.__el = parent;
                candidates.push(item);
                break;
              }
              parent = parent.parentElement;
              depth++;
            }
            if (candidates.length >= 20) break;
          }
        }
      }
    }

    // Blinkit's first rendered listing can be a search-header card whose
    // title is just the query while its container exposes another item's
    // price. Discard it before ranking the remaining products.
    if (targetPlatformId === "blinkit" && candidates.length > 0) {
      candidates.shift();
    }

    if (candidates.length === 0) {
      return { best: null, candidates: [], found: 0 };
    }

    // Strip element references BEFORE anything crosses the React Native
    // bridge: DOM nodes are not serializable and leak from BOTH the
    // card-selector path and the proximity-fallback path.
    candidates.forEach((ci) => { delete ci.__el; });

    // Rank by query relevance so banners/sponsored fragments near a price
    // never outrank real matches for the searched term.
    const ranked = candidates.map((c) => Object.assign({}, c, {
      _score: scoreRelevance(c.title, searchQuery, c.quantity || "") - (c.sponsored ? 60 : 0)
    }));
    // Amazon Tez pins its sponsored/ad slot at position #1 of the listing.
    // Badge detection there is unreliable, so apply a flat demotion to the
    // first-listed candidate regardless.
    if (targetPlatformId === "amazon_tez" && ranked.length > 0) ranked[0]._score -= 30;
    ranked.sort((a, b) => b._score - a._score);
    const qualified = ranked.filter((c) => c._score >= 20);
    // No/blank query: preserve document order untouched.
    const pool = (searchQuery && searchQuery.trim() && qualified.length > 0) ? qualified : ranked;
    const topCandidates = pool.slice(0, 3);
    return { best: topCandidates[0] || null, candidates: topCandidates, found: candidates.length };
  }

  // Stale-page guard: a reused WebView mid-navigation must never answer with
  // the previous query's products. Results are only accepted when the live
  // document URL contains the current search term.
  const wantedRaw = searchQuery.toLowerCase().trim();
  const hrefOk = () => {
    try {
      return decodeURIComponent(window.location.href || "").toLowerCase().includes(wantedRaw);
    } catch (e) {
      return false;
    }
  };

  // Visible text only: <script> bundles embedded in <body> (Next.js does
  // this) contain strings like "no results" from app code, which previously
  // caused false empty-state detection on bare shells.
  function visibleBodyText() {
    try {
      const root = document.body;
      if (!root) return "";
      const skip = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1 };
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
        acceptNode: function (node) {
          if (node.nodeType === 1) {
            return skip[node.nodeName] ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      let out = "";
      let guard = 0;
      let cur;
      while ((cur = walker.nextNode()) && guard < 20000) {
        if (cur.nodeType === 3 && cur.nodeValue) {
          out += cur.nodeValue + " ";
          if (out.length > 100000) break;
        }
        guard++;
      }
      return out.toLowerCase();
    } catch (e) {
      return "";
    }
  }

  // Execute and poll up to 16 attempts (8 seconds). Mirror the desktop
  // settle rule: a confident top score over a grid-sized candidate set is
  // accepted almost immediately, weaker/partial states must hold stable for
  // a short window so early-hydration fragments never win.
  let attempts = 0;
  let bestRes = null;
  let lastSig = null;
  let lastChangeAt = Date.now();
  const sigOf = (res) => ((res && res.candidates) || []).map((c) => c.title + "@" + c.price).join("|");
  const pollInterval = setInterval(() => {
    attempts++;
    let res = runExtraction();
    if (res.best && !hrefOk()) {
      res = { best: null, candidates: [], found: 0 };
    }

    // Empty-state early exit: when the site itself says nothing matched
    // ("couldn't find", "no results", ...), stop polling immediately instead
    // of burning the full 8s budget. Guarded hard against false positives:
    // only visible text (scripts/styles excluded), only after the document
    // finished loading, and never before attempt 4 — bare SPA shells must
    // not be mistaken for genuine empty states.
    if (!res.best && attempts >= 4 && document.readyState === "complete") {
      try {
        const bodyText = visibleBodyText();
        // couldn.t / didn.t cover straight, curly, and missing apostrophes.
        if (/no results|couldn.t find|could not find|didn.t find|nothing here|did not match any|didn.t match|no matching|no items found|0 results|no products|nothing matched|unable to find|not available in/.test(bodyText)) {
          clearInterval(pollInterval);
          if (window.__lowpScraperTimer === pollInterval) {
            window.__lowpScraperTimer = null;
          }
          if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'SCRAPE_RESULT',
              platformId: targetPlatformId,
              success: false,
              data: null,
              candidates: [],
              debug: {
                url: window.location.href,
                title: document.title,
                reason: 'empty_state',
                attempts: attempts,
                domNodes: document.getElementsByTagName ? document.getElementsByTagName("*").length : 0
              }
            }));
          }
          return;
        }
      } catch (e) {}
    }

    // Second-tier give-up: page fully loaded, ten attempts, still zero
    // candidates and none of the known empty-state phrases — treat as no
    // results instead of stretching to attempt 16 (~9-10s with walk time).
    if (!res.best && attempts >= 10 && document.readyState === "complete") {
      clearInterval(pollInterval);
      if (window.__lowpScraperTimer === pollInterval) {
        window.__lowpScraperTimer = null;
      }
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'SCRAPE_RESULT',
          platformId: targetPlatformId,
          success: false,
          data: null,
          candidates: [],
          debug: {
            url: window.location.href,
            title: document.title,
            reason: 'no_results_timeout',
            attempts: attempts,
            domNodes: document.getElementsByTagName ? document.getElementsByTagName("*").length : 0
          }
        }));
      }
      return;
    }

    if (res.best) {
      const sig = sigOf(res);
      if (sig !== lastSig) {
        lastSig = sig;
        lastChangeAt = Date.now();
        bestRes = res;
      }
    }
    const settledFor = (() => {
      if (!bestRes) return 0;
      const topScore = (bestRes.best && bestRes.best._score) || 0;
      const found = bestRes.found || 0;
      return (topScore >= 60 && found >= 5) ? 100 : 500;
    })();
    const stable = !!bestRes && (Date.now() - lastChangeAt >= settledFor);
    if (stable || attempts >= 16) {
      clearInterval(pollInterval);
      if (window.__lowpScraperTimer === pollInterval) {
        window.__lowpScraperTimer = null;
      }
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'SCRAPE_RESULT',
          platformId: targetPlatformId,
          success: !!(bestRes && bestRes.best),
          data: (bestRes && bestRes.best) || null,
          candidates: (bestRes && bestRes.candidates) || [],
          debug: {
            url: window.location.href,
            title: document.title,
            attempts: attempts,
            domNodes: document.getElementsByTagName ? document.getElementsByTagName("*").length : 0
          }
        }));
      }
    }
  }, 500);
  window.__lowpScraperTimer = pollInterval;
})();
true;
`;
}
