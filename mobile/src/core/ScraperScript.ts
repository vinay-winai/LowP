export function generateScraperScript(searchQuery: string, platformId: string): string {
  const sanitizedQuery = JSON.stringify(searchQuery);
  const sanitizedPlatformId = JSON.stringify(platformId);

  return `
(function() {
  const searchQuery = ${sanitizedQuery};
  const targetPlatformId = ${sanitizedPlatformId};

  function isBadTitle(str) {
    if (!str || typeof str !== "string") return true;
    const s = str.trim().toLowerCase();
    if (s.length < 2 || s.length > 150) return true;

    const bannedPatterns = [
      /^(home|cart|search|login|help|offers|new|corporate|swiggy|zepto|amazon|blinkit|menu|account|profile|orders|notifications)$/i,
      /^(delivery in\\s*\\d+\\s*(?:mins?|minutes?)|\\d+\\s*(?:mins?|minutes?|hours?|sec|seconds?)|\\d+\\s*-\\s*\\d+\\s*(?:mins?|minutes?))$/i,
      /^(fastest delivery|standard delivery|get it in|unlock free delivery|free delivery|instant delivery)$/i,
      /^(showing results for|results for|search results for)/i,
      /^(out of stock|sold out|unavailable|currently unavailable|add|added|buy|view|closed|loading|customise|in stock|add to cart|add item|qty|\\+|\\-)$/i,
      /^(trending|bestseller|offers?|save|flat|best price|discount|\\d+%\\s*off|save\\s*₹?\\d+|\\d+\\s*off|see all|view all|explore)$/i,
      /^(corporate|falcon|help & support|categories|see more|product image|cart icon|item image|image|photo|thumbnail|logo|banner|offer_icon|offer icon|coupon|promo)$/i,
      /^(item|product|unit|pack|pc|pcs|piece|pieces|kg|gm|g|l|ml)$/i
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

    const CORE_CATEGORIES = [
      'paneer', 'cheese', 'butter', 'milk', 'ghee', 'curd', 'dahi', 'yogurt',
      'rice', 'atta', 'flour', 'maida', 'besan', 'sooji', 'rava',
      'oil', 'sugar', 'salt', 'tea', 'coffee', 'bread', 'eggs', 'biscuit', 'cookies',
      'noodle', 'noodles', 'pasta', 'sauce', 'ketchup', 'chocolate', 'chips'
    ];

    const queryCategories = CORE_CATEGORIES.filter(cat => queryTokens.includes(cat));
    if (queryCategories.length > 0) {
      queryCategories.forEach(cat => {
        if (fullText.includes(cat)) {
          score += 50;
        } else {
          score -= 60;
        }
      });

      const conflictingCategories = CORE_CATEGORIES.filter(cat => !queryCategories.includes(cat) && fullText.includes(cat));
      if (conflictingCategories.length > 0) {
        score -= 50;
      }
    }

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

    const spacedCardText = getSpacedText(cardNode).replace(/\\s+/g, " ").trim();
    
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
    const titleEl = cardNode.querySelector ? cardNode.querySelector('[data-slot-id="ProductName"], [data-testid*="name"], [data-testid*="title"], [data-testid*="item_name"], [data-testid*="item-title"], [data-slot-id*="title"], [class*="ProductName"], [class*="ItemName"], [class*="product_name"], [class*="styled__ItemName"], [class*="ItemTitle"], [class*="Product__UpdatedTitle"], [class*="tw-text-base-black"], [class*="tw-line-clamp-2"], [class*="_2T1-K"], [class*="nov9b"], [class*="_1W_4e"], [class*="_1b1-N"], h2, h3, h4, h5') : null;
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

    if (title.toLowerCase() === cleanTitle(searchQuery).toLowerCase() && (!image || image.includes('icon48.png') || !image.startsWith('http'))) {
      return null;
    }

    if (!title || isBadTitle(title)) return null;

    const qtyEl = cardNode.querySelector ? cardNode.querySelector('[data-slot-id="PackSize"], [data-testid*="quantity"], [data-testid*="weight"], [data-testid*="item_quantity"], [class*="PackSize"], [class*="weight"], [class*="quantity"], span[class*="pack"], span[class*="unit"]') : null;
    const quantity = qtyEl ? qtyEl.textContent.trim() : "1 unit";

    const mrpEl = cardNode.querySelector ? cardNode.querySelector('s, del, strike, [class*="strike"], [class*="slashed"], [class*="_3eAjW"], [class*="cx3iWL"], [style*="line-through"], [data-slot-id*="mrp"], [class*="mrp"]') : null;
    let mrp = null;
    if (mrpEl) {
      const mMatch = mrpEl.textContent.match(/([0-9,]+(?:\.[0-9]+)?)/);
      if (mMatch) {
        const val = parseFloat(mMatch[1].replace(/,/g, ""));
        if (val >= price && val <= 500000) mrp = val;
      }
    }

    return {
      title,
      price,
      mrp: mrp || price,
      brand: targetPlatformId === "instamart" ? "Swiggy Instamart" : (targetPlatformId === "zepto" ? "Zepto" : (targetPlatformId === "blinkit" ? "Blinkit" : "Amazon Now (Tez)")),
      quantity,
      image,
      productUrl: window.location.href,
      platformId: targetPlatformId
    };
  }

  function runExtraction() {
    const candidates = [];

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

    const cardSelectors = [
      '[data-testid="item-collection-card-full"]',
      '[data-testid="product-card"]',
      '[data-testid*="product"]',
      'div[class*="ProductCard"]',
      'div[class*="product-card"]',
      'div[class*="itemCard"]',
      'div[class*="product_card"]',
      'div[class*="styles__ProductCard"]',
      'div[class*="style__Card"]',
      'div[class*="item-card"]',
      'div[class*="Product__Updated"]',
      'div[class*="Product__Card"]',
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

    const cards = document.querySelectorAll(cardSelectors.join(', '));
    for (const card of cards) {
      const item = extractFromCard(card, targetPlatformId);
      if (item && item.price > 0 && !candidates.some(c => c.title === item.title && c.price === item.price)) {
        candidates.push(item);
        if (candidates.length >= 20) break;
      }
    }

    if (candidates.length === 0) {
      const allEls = document.querySelectorAll('*');
      for (const el of allEls) {
        const text = el.textContent || '';
        if (/(?:₹|Rs\\.?|INR)\\s*[0-9,]+/i.test(text) && text.length < 30) {
          let parent = el.parentElement;
          let depth = 0;
          while (parent && depth < 6 && parent !== document.body) {
            const item = extractFromCard(parent, targetPlatformId);
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

    if (candidates.length === 0) {
      return { best: null, count: 0 };
    }

    candidates.forEach(cand => {
      cand._score = scoreRelevance(cand.title, searchQuery, cand.quantity);
    });

    candidates.sort((a, b) => b._score - a._score);
    const best = candidates[0];
    return {
      best: (best && best._score >= 20) ? best : null,
      count: candidates.length
    };
  }

  let attempts = 0;
  let lastBest = null;
  const pollInterval = setInterval(() => {
    attempts++;
    const { best, count } = runExtraction();
    if (best) lastBest = best;

    const isHighConfidence = best && best._score >= 170;
    const hasEnoughCards = count >= 4 && best;
    const isTimeout = attempts >= 16;
    const hasStabilized = attempts >= 4 && lastBest;

    if (isHighConfidence || (hasEnoughCards && attempts >= 3) || hasStabilized || isTimeout) {
      clearInterval(pollInterval);
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'SCRAPE_RESULT',
          platformId: targetPlatformId,
          success: !!lastBest,
          data: lastBest,
          debug: {
            url: window.location.href,
            title: document.title,
            attempts: attempts,
            candidatesFound: count
          }
        }));
      }
    }
  }, 500);
})();
true;
`;
}
