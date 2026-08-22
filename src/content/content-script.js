/**
 * LowP Content Script (Live In-Page Product & Price Extractor)
 * Injected into Amazon India, Swiggy Instamart, and Zepto tabs.
 */

(function () {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  function isBadTitle(str) {
    if (!str || typeof str !== "string") return true;
    const s = str.trim().toLowerCase();
    if (s.length < 2 || s.length > 150) return true;

    const bannedPatterns = [
      /^(home|cart|search|login|help|offers|new|corporate|swiggy|zepto|amazon|menu|account|profile|orders|notifications)$/i,
      /^(delivery in\s*\d+\s*(?:mins?|minutes?)|\d+\s*(?:mins?|minutes?|hours?|sec|seconds?)|\d+\s*-\s*\d+\s*(?:mins?|minutes?))$/i,
      /^(fastest delivery|standard delivery|get it in|unlock free delivery|free delivery)$/i,
      /^(showing results for|results for|search results for)/i,
      /^(out of stock|sold out|unavailable|currently unavailable|add|added|buy|view|closed|loading|customise|in stock|add to cart|add item|qty|\+|\-)$/i,
      /^(trending|bestseller|offers?|save|flat|best price|discount|\d+%\s*off|save\s*₹?\d+|\d+\s*off|see all|view all|explore)$/i,
      /^(corporate|falcon|help & support|categories|see more|product image|cart icon|item image|image|photo|thumbnail|logo|banner|offer_icon|offer icon|coupon|promo)$/i,
      /^(item|product|unit|pack|pc|pcs|piece|pieces|kg|gm|g|l|ml)$/i
    ];

    const words = s.split(/\s+/);
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
      .replace(/(?:₹|Rs\.?|INR)\s*[0-9,]+(?:\.[0-9]+)?/gi, "")
      .replace(/\b(?:delivery in\s*)?\d+(?:\s*-\s*\d+)?\s*(?:mins?|minutes?|hours?|sec|seconds?)\b/gi, "")
      .replace(/\b(?:add|options?)\s*\d*\b/gi, "")
      .replace(/\b\d+(?:\.\d+)?\s*(?:lac|lakh)\b/gi, "")
      .replace(/\b(?:fastest delivery|standard delivery|instant delivery|express delivery|free delivery|delivery)\b/gi, "")
      .replace(/\b(?:mrp|add|buy|added|in stock|out of stock|off|\d+%\s*off|save)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function scoreRelevance(itemTitle, query, packSize = '') {
    if (!itemTitle || !query || !query.trim()) return 0;

    const normalize = (str) => (str || "").toLowerCase()
      .replace(/['’`"]/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const fullText = normalize(`${itemTitle} ${packSize}`);
    const q = normalize(query);
    const queryTokens = q.split(/\s+/).filter(t => t.length > 0);

    let score = 0;

    // 1. Keyword Overlap (+30 for each matching word, +25 for plural/singular)
    queryTokens.forEach(token => {
      if (fullText.includes(token)) {
        score += 30;
      } else if (token.endsWith('s') && token.length > 3 && fullText.includes(token.slice(0, -1))) {
        score += 25;
      } else if (!token.endsWith('s') && fullText.includes(token + 's')) {
        score += 25;
      }
    });

    // 2. Quantity & Unit matching (1l, 1kg, 200g, 500g, 5l)
    const qtyMatch = query.match(/(\d+(?:\.\d+)?)\s*(l|litre|litres|kg|kgs|g|gm|gms|ml)/i);
    if (qtyMatch) {
      const qNum = parseFloat(qtyMatch[1]);
      const qUnit = qtyMatch[2].toLowerCase().replace(/litre|litres/, 'l').replace(/kgs?/, 'kg').replace(/gms?/, 'g');
      const targetQtyStr = `${qNum} ${qUnit}`;
      const targetQtyCompact = `${qNum}${qUnit}`;

      if (fullText.includes(targetQtyStr) || fullText.includes(targetQtyCompact)) {
        score += 40;
      } else {
        const candQtyMatch = fullText.match(/(\d+(?:\.\d+)?)\s*(l|litre|litres|kg|kgs|g|gm|gms|ml)/i);
        if (candQtyMatch) {
          const cNum = parseFloat(candQtyMatch[1]);
          const cUnit = candQtyMatch[2].toLowerCase().replace(/litre|litres/, 'l').replace(/kgs?/, 'kg').replace(/gms?/, 'g');
          if (cNum !== qNum || cUnit !== qUnit) score -= 40;
        }
      }
    }

    // 3. Brand Matching (First word is usually brand, e.g. "freedom", "fortune", "lays")
    if (queryTokens.length > 0 && fullText.includes(queryTokens[0])) {
      score += 25;
    }

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

    const spacedCardText = getSpacedText(cardNode).replace(/\s+/g, " ").trim();
    const cardText = cardNode.textContent || "";
    
    // 1. Price extraction (Priority: specific price element -> spaced currency match -> leaf numeric fallback)
    let price = null;

    const priceEl = cardNode.querySelector ? cardNode.querySelector('[data-slot-id="EdlpPrice"], [data-testid*="price"], [data-testid*="item_price"], [data-testid*="offer-price"], [class*="_2jn41"], [class*="_1yW90"], [class*="_3-M84"]') : null;
    if (priceEl) {
      const pTxt = getSpacedText(priceEl).trim();
      const m = pTxt.match(/([0-9,]+(?:\.[0-9]+)?)/);
      if (m) {
        const val = parseFloat(m[1].replace(/,/g, ""));
        if (val >= 5 && val <= 500000) price = val;
      }
    }

    if (!price || isNaN(price)) {
      const literalMatch = spacedCardText.match(/(?:₹|Rs\.?|INR)\s*([0-9,]+(?:\.[0-9]+)?)/i);
      if (literalMatch) {
        const val = parseFloat(literalMatch[1].replace(/,/g, ""));
        if (val >= 5 && val <= 500000) price = val;
      }
    }

    if (!price || isNaN(price)) {
      const children = cardNode.querySelectorAll ? cardNode.querySelectorAll('div, span, p, b, strong') : [];
      for (const el of children) {
        if (el.children && el.children.length > 0) continue;
        const txt = el.textContent?.trim();
        if (txt && /^\s*[0-9]{2,5}(?:\.[0-9]+)?\s*$/.test(txt)) {
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

    // 2. Title extraction (Priority: specific slot/testid -> img alt -> h1-h5 -> generic)
    const titleEl = cardNode.querySelector ? cardNode.querySelector('[data-slot-id="ProductName"], [data-testid*="name"], [data-testid*="title"], [data-testid*="item_name"], [data-testid*="item-title"], [data-slot-id*="title"], [class*="ProductName"], [class*="ItemName"], [class*="product_name"], [class*="styled__ItemName"], [class*="ItemTitle"], [class*="Product__UpdatedTitle"], [class*="tw-text-base-black"], [class*="tw-line-clamp-2"], [class*="tAxDx"], [class*="sh-np__product-title"], [class*="_2T1-K"], [class*="nov9b"], [class*="_1W_4e"], [class*="_1b1-N"], h1, h2, h3, h4, h5') : null;
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

    // 3. Clean Inline Fallback
    if (!title) {
      const inlineTxt = cleanTitle(spacedCardText);
      if (inlineTxt.length >= 3 && inlineTxt.length <= 120 && !isBadTitle(inlineTxt)) {
        title = inlineTxt;
      }
    }

    if (!title || isBadTitle(title)) return null;

    // 4. Pack size
    const qtyEl = cardNode.querySelector ? cardNode.querySelector('[data-slot-id="PackSize"], [data-testid*="quantity"], [data-testid*="weight"], [data-testid*="item_quantity"], [class*="PackSize"], [class*="weight"], [class*="quantity"], span[class*="pack"], span[class*="unit"]') : null;
    const quantity = qtyEl ? qtyEl.textContent.trim() : "1 unit";

    // 5. MRP (Check slashed / strikethrough elements)
    const mrpEl = cardNode.querySelector ? cardNode.querySelector('s, del, strike, [class*="strike"], [class*="slashed"], [class*="_3eAjW"], [class*="cx3iWL"], [style*="line-through"], [data-slot-id*="mrp"], [class*="mrp"]') : null;
    let mrp = null;
    if (mrpEl) {
      const mMatch = mrpEl.textContent.match(/([0-9,]+(?:\.[0-9]+)?)/);
      if (mMatch) {
        const val = parseFloat(mMatch[1].replace(/,/g, ""));
        if (val >= price) mrp = val;
      }
    }
    if (!mrp || mrp < price) {
      // Only show a discount when the store actually exposes an MRP.
      mrp = price;
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

  function extractStorePageData(searchQuery = "") {
    if (!document.querySelectorAll) return null;

    const host = (window.location.hostname || "").toLowerCase();
    const pathname = (window.location.pathname || "").toLowerCase();
    const href = (window.location.href || "").toLowerCase();
    const isPDP = pathname.includes("/pn/") || pathname.includes("/product/") || pathname.includes("/item/") || pathname.includes("/dp/") || pathname.includes("/prid/");

    let platformId = "unknown";
    if (host.includes("amazon") || href.includes("amazon")) {
      platformId = "amazon_tez";
    } else if (host.includes("swiggy") || href.includes("swiggy")) {
      platformId = "instamart";
    } else if (host.includes("zepto") || href.includes("zepto")) {
      platformId = "zepto";
    } else if (host.includes("blinkit") || href.includes("blinkit")) {
      platformId = "blinkit";
    }

    const candidates = [];

    // 1. Next.js Structured State (__NEXT_DATA__)
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
              if (!candidates.some(c => c.title === cleanT && c.price === price)) {
                candidates.push({
                  title: cleanT,
                  price,
                  mrp: Math.max(mrp, price),
                  brand: platformId === "instamart" ? "Swiggy Instamart" : (platformId === "zepto" ? "Zepto" : "Amazon"),
                  quantity: o.quantity || o.pack_size || o.weight || "1 unit",
                  image: o.image || o.imageUrl || (o.imageId ? `https://media-assets.swiggy.com/swiggy/image/upload/fl_lossy,f_auto,q_auto,w_252,h_252/${o.imageId}` : "assets/icon48.png"),
                  productUrl: window.location.href,
                  platformId
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

    // 2. PDP Handling (Single Item Page)
    if (isPDP) {
      const pdpTitle = document.querySelector('h1[data-testid*="name"], h1[data-testid*="title"], h1#title span, h1');
      const pdpPrice = document.querySelector('[data-testid*="price"], span.a-price-whole, span.a-offscreen, h4, div[class*="price"]');
      if (pdpTitle && pdpPrice) {
        const title = pdpTitle.textContent?.trim();
        const pMatch = pdpPrice.textContent?.match(/([0-9,]+(?:\.[0-9]+)?)/);
        if (title && !isBadTitle(title) && pMatch) {
          const price = parseFloat(pMatch[1].replace(/,/g, ""));
          if (price > 0 && price < 500000) {
            const imgEl = document.querySelector('#landingImage, img[class*="pdp"], [data-testid*="image"] img, img');
            const item = {
              title,
              price,
              mrp: price,
              brand: platformId === "instamart" ? "Swiggy Instamart" : (platformId === "zepto" ? "Zepto" : "Amazon"),
              quantity: "1 unit",
              image: imgEl?.src || "assets/icon48.png",
              productUrl: window.location.href,
              platformId
            };
            return { best: item, candidates: [item] };
          }
        }
      }
    }

    // 3. Search & Listing Cards Collection
    const cardSelectors = [
      '[data-testid="item-collection-card-full"]',
      'div[class*="_3Rr1X"]',
      'div[class*="sWdPz"]',
      'div[class*="_1WDPG"]',
      '[data-testid="product-card"]',
      '[data-testid*="product"]',
      '[data-testid*="item"]',
      '[data-testid*="default_container"]',
      'a[href*="/pn/"]',
      'a[href*="/product/"]',
      'a[href*="/item/"]',
      'a[href*="/instamart/item/"]',
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
      'div[class*="ItemCard"]',
      'div[class*="styled__Item"]',
      'div[class*="nov9b"]',
      'div[class*="_1W_4e"]',
      'div[class*="_1lbNR"]',
      'a[href*="/prid/"]',
      'div[data-test-id*="plp-product"]',
      'div[class*="Product__Updated"]',
      'div[class*="ProductCard"]',
      'div[class*="product"]',
      'a[href*="/p/"]',
      'a[href*="/dp/"]',
      'div[class*="sh-dgr__grid-result"]',
      'div[class*="sh-dgr__content"]',
      'div[class*="KZmu8e"]',
      'div[class*="sh-np__click-target"]',
      'div[class*="pla-unit"]',
      'div[class*="sh-dlr__list-result"]',
      'div[class*="iU5tvd"]',
      'div[data-docid]',
      'div[data-component-type="s-search-result"]',
      'div[class*="s-result-item"]',
      'div[data-asin]'
    ];

    const cards = document.querySelectorAll(cardSelectors.join(', '));
    for (const card of cards) {
      const item = extractFromCard(card, platformId);
      if (item && item.price > 0 && !candidates.some(c => c.title === item.title && c.price === item.price)) {
        candidates.push(item);
        if (candidates.length >= 20) break;
      }
    }

    // 3. Fallback: Proximity Card Search
    if (candidates.length === 0) {
      // Amazon Tez needs the known-good full fallback because its current
      // product cards do not expose stable semantic selectors. Keep targeted
      // scanning for the other stores to avoid a whole-document text walk.
      const allEls = platformId === "amazon_tez"
        ? document.querySelectorAll('*')
        : document.querySelectorAll('[data-testid*="price" i], [class*="price" i], [class*="amount" i], [class*="cost" i], span');
      for (const el of allEls) {
        const text = el.textContent || '';
        if (/(?:₹|Rs\.?|INR)\s*[0-9,]+/i.test(text) && text.length < 30) {
          let parent = el.parentElement;
          let depth = 0;
          while (parent && depth < 6 && parent !== document.body) {
            const item = extractFromCard(parent, platformId);
            if (item && item.price > 0 && !candidates.some(c => c.title === item.title && c.price === item.price)) {
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

    if (candidates.length === 0) return { best: null, candidates: [] };

    // 4. Score Candidates Against Search Query
    candidates.forEach(cand => {
      cand._score = scoreRelevance(cand.title, searchQuery, cand.quantity);
    });

    candidates.sort((a, b) => b._score - a._score);
    const best = candidates[0];
    const isValid = !searchQuery || !searchQuery.trim() || best._score >= 20;
    return {
      best: isValid ? best : null,
      candidates: candidates.slice(0, 3)
    };
  }

  // Handle messages from Extension Popup & Background Worker
  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === "GET_PAGE_PRODUCT_DATA") {
        const extraction = extractStorePageData(message.query || "");
        const bestData = extraction?.best;
        if (bestData && bestData.price > 0) {
          sendResponse({ success: true, data: bestData, candidates: extraction.candidates || [] });
          return true;
        }
        sendResponse({ success: false, data: null });
        return true;
      }
    });

    // Extraction is request-driven through GET_PAGE_PRODUCT_DATA. The old
    // timer repeatedly scraped arbitrary products and sent debug-only events.
  }
})();

function extractProductTitle() {
  if (typeof document === "undefined" || !document.querySelector) return null;
  const host = typeof window !== "undefined" && window.location ? window.location.hostname : "";

  if (host.includes("amazon")) {
    const amzTitle = document.getElementById("productTitle") || document.querySelector("h1#title");
    if (amzTitle) return amzTitle.textContent.trim();
  }

  if (host.includes("zepto")) {
    const zeptoTitle = document.querySelector("[data-testid='product-name'], [data-testid='product-card-name'], h1, h5");
    if (zeptoTitle) return zeptoTitle.textContent.trim();
  }

  if (host.includes("swiggy")) {
    const swiggyTitle = document.querySelector("[data-testid='item-name'], .item-title, h1, h3");
    if (swiggyTitle) return swiggyTitle.textContent.trim();
  }

  const genericH1 = document.querySelector("h1");
  return genericH1 ? genericH1.textContent.trim() : null;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { extractProductTitle };
}
