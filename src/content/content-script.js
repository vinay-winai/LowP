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
      /^(corporate|falcon|help & support|categories|see more|product image|cart icon|item image|image|photo|thumbnail|logo|banner)$/i,
      /^(item|product|unit|pack|pc|pcs|piece|pieces|kg|gm|g|l|ml)$/i
    ];

    return bannedPatterns.some(p => p.test(s));
  }

  function cleanTitle(str) {
    if (!str || typeof str !== "string") return "";
    return str
      .replace(/(?:₹|Rs\.?|INR)\s*[0-9,]+(?:\.[0-9]+)?/gi, "")
      .replace(/^\s*(?:delivery in\s*)?\d+(?:\s*-\s*\d+)?\s*(?:mins?|minutes?|hours?|sec|seconds?)\s*/i, "")
      .replace(/\s*(?:delivery in\s*)?\d+(?:\s*-\s*\d+)?\s*(?:mins?|minutes?|hours?|sec|seconds?)\s*$/i, "")
      .replace(/\b(?:mrp|add|buy|added|in stock|out of stock|off|\d+%\s*off|save)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function scoreRelevance(itemTitle, query, packSize = '') {
    if (!itemTitle) return 0;
    if (!query || !query.trim()) return 50;

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
        score += 50;
      } else {
        const candQtyMatch = fullText.match(/(\d+(?:\.\d+)?)\s*(l|litre|litres|kg|kgs|g|gm|gms|ml)/i);
        if (candQtyMatch) {
          const cNum = parseFloat(candQtyMatch[1]);
          if (cNum !== qNum) {
            score -= 50;
          }
        }
      }
    }

    // 3. Brand Matching (First word is usually brand, e.g. "freedom", "fortune", "lays")
    if (queryTokens.length > 0 && fullText.includes(queryTokens[0])) {
      score += 35;
    }

    return score;
  }

  function extractFromCard(cardNode, platformId) {
    if (!cardNode) return null;
    const cardText = cardNode.textContent || "";
    
    // 1. Price extraction (Robust: Literal Currency -> Price Element -> Numeric Node Fallback)
    let price = null;
    const literalMatch = cardText.match(/(?:₹|Rs\.?|INR)\s*([0-9,]+(?:\.[0-9]+)?)/i);
    if (literalMatch) {
      price = parseFloat(literalMatch[1].replace(/,/g, ""));
    }

    if (!price || isNaN(price)) {
      const priceEl = cardNode.querySelector ? cardNode.querySelector('[data-slot-id="EdlpPrice"], [data-testid*="price"], [data-testid*="item_price"], [class*="price"], [class*="Price"], [class*="_1yW90"], [class*="_3-M84"]') : null;
      if (priceEl) {
        const pTxt = priceEl.textContent?.trim() || "";
        const m = pTxt.match(/([0-9,]+(?:\.[0-9]+)?)/);
        if (m) {
          const val = parseFloat(m[1].replace(/,/g, ""));
          if (val >= 5 && val <= 500000) price = val;
        }
      }
    }

    if (!price || isNaN(price)) {
      const children = cardNode.querySelectorAll ? cardNode.querySelectorAll('div, span, p') : [];
      for (const el of children) {
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
    const titleEl = cardNode.querySelector ? cardNode.querySelector('[data-slot-id="ProductName"], [data-testid*="name"], [data-testid*="title"], [data-testid*="item_name"], [data-testid*="item-title"], [data-slot-id*="title"], [class*="ProductName"], [class*="ItemName"], [class*="product_name"], [class*="styled__ItemName"], [class*="ItemTitle"], [class*="_2T1-K"], [class*="nov9b"], [class*="_1W_4e"], [class*="_1b1-N"], h1, h2, h3, h4, h5') : null;
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
      const inlineTxt = cleanTitle(cardText);
      if (inlineTxt.length >= 3 && inlineTxt.length <= 120 && !isBadTitle(inlineTxt)) {
        title = inlineTxt;
      }
    }

    if (!title || isBadTitle(title)) return null;

    // 4. Pack size
    const qtyEl = cardNode.querySelector ? cardNode.querySelector('[data-slot-id="PackSize"], [data-testid*="quantity"], [data-testid*="weight"], [data-testid*="item_quantity"], [class*="PackSize"], [class*="weight"], [class*="quantity"], span[class*="pack"], span[class*="unit"]') : null;
    const quantity = qtyEl ? qtyEl.textContent.trim() : "1 unit";

    // 5. MRP
    const mrpEl = cardNode.querySelector ? cardNode.querySelector('[data-slot-id*="mrp"], [class*="cx3iWL"], [class*="mrp"]') : null;
    const mrpMatch = (mrpEl ? mrpEl.textContent : cardText).match(/₹\s*([0-9,]+)/);
    const mrp = mrpMatch ? parseFloat(mrpMatch[1].replace(/,/g, "")) : Math.round(price * 1.15);

    const deliveryTime = platformId === "instamart" ? "10-15 mins" : (platformId === "zepto" ? "5-9 mins" : "Same Day");
    const brand = platformId === "instamart" ? "Swiggy Instamart" : (platformId === "zepto" ? "Zepto" : "Amazon");

    return {
      title,
      price,
      mrp: Math.max(mrp, price),
      brand,
      quantity,
      image,
      productUrl: window.location.href,
      platformId,
      deliveryTime
    };
  }

  function extractStorePageData(searchQuery = "") {
    if (!document.querySelectorAll) return null;

    const host = window.location.hostname || "";
    const pathname = window.location.pathname || "";
    const isPDP = pathname.includes("/pn/") || pathname.includes("/product/") || pathname.includes("/item/") || pathname.includes("/dp/");

    let platformId = "unknown";
    if (host.includes("amazon")) platformId = "amazon";
    else if (host.includes("swiggy")) platformId = "instamart";
    else if (host.includes("zepto")) platformId = "zepto";

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
            return {
              title,
              price,
              mrp: Math.round(price * 1.15),
              brand: platformId === "instamart" ? "Swiggy Instamart" : (platformId === "zepto" ? "Zepto" : "Amazon"),
              quantity: "1 unit",
              image: imgEl?.src || "assets/icon48.png",
              productUrl: window.location.href,
              platformId
            };
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
      'div[class*="ItemCard"]',
      'div[class*="styled__Item"]',
      'div[class*="nov9b"]',
      'div[class*="_1W_4e"]',
      'div[class*="_1lbNR"]',
      'div[data-component-type="s-search-result"]',
      'div[class*="s-result-item"]'
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
      const allEls = document.querySelectorAll('*');
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

    if (candidates.length === 0) return null;

    // 4. Score Candidates Against Search Query
    candidates.forEach(cand => {
      cand._score = scoreRelevance(cand.title, searchQuery, cand.quantity);
    });

    candidates.sort((a, b) => b._score - a._score);
    const best = candidates[0];
    if (searchQuery && searchQuery.trim() && best._score < 20) {
      return null;
    }
    return best;
  }

  // Handle messages from Extension Popup & Background Worker
  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === "GET_PAGE_PRODUCT_DATA") {
        const bestData = extractStorePageData(message.query || "");
        if (bestData && bestData.price > 0) {
          sendResponse({ success: true, data: bestData });
          return true;
        }
        sendResponse({ success: false, data: null });
        return true;
      }
    });

    // Auto-sync extracted store item to background
    const syncTimer = setInterval(() => {
      if (!document.querySelectorAll) return;
      const data = extractStorePageData();
      if (data && data.price > 0 && !isBadTitle(data.title)) {
        clearInterval(syncTimer);
        try {
          chrome.runtime.sendMessage({
            action: "STORE_PRICE_SYNC",
            payload: {
              url: window.location.href,
              data
            }
          }, () => {
            if (chrome.runtime.lastError) { /* ignore */ }
          });
        } catch (e) {}
      }
    }, 1000);

    setTimeout(() => clearInterval(syncTimer), 15000);
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
