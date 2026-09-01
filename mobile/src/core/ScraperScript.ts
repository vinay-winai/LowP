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
    // Drop parenthetical alt names so "Potato (Aalugadda)" and "Potato"
    // dedupe as the same product at the same price.
    return String(str || "").replace(/\\([^)]*\\)/g, " ")
      .replace(/(?<=[a-z])(?=\\d)/gi, " ").replace(/(?<=\\d)(?=[a-z])/gi, " ")
      .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
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
    if (/(^|[\\s-])(icon|chevron|arrow|sprite|svg)([\\s-]|$)|-icon$/.test(s)) return true;

    // Reject shelf/category labels and badges scraped instead of a name.
    if (/previously bought|earlier bought|already bought/.test(s)) return true;
    if (/^(fresh|plain)?\\s*(toned|full cream|slim|cow|buffalo)?\\s*milk( pouch)?$/.test(s)) return true;
    if (/(?:showing\\s+)?results\\s+for|search\\s+results\\s+for|did\\s+you\\s+mean|showing\\s+\\d+.*results/i.test(s)) return true;

    const bannedPatterns = [
      /^(home|cart|search|login|help|offers|new|corporate|swiggy|zepto|amazon|blinkit|menu|account|profile|orders|notifications)$/i,
      /^(delivery in\\s*\\d+\\s*(?:mins?|minutes?)|\\d+\\s*(?:mins?|minutes?|hours?|sec|seconds?)|\\d+\\s*-\\s*\\d+\\s*(?:mins?|minutes?))$/i,
      /^(fastest delivery|standard delivery|get it in|unlock free delivery|free delivery|instant delivery)$/i,
      /(?:showing\\s+)?results\\s+for|search\\s+results\\s+for|did\\s+you\\s+mean|showing\\s+\\d+.*results/i,
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
      .replace(/\\b(?:sponsored\\s+ad|sponsored|ad)\\s*[-–:]\\s*/gi, "")
      .replace(/^\\s*\\d+(?:\\.\\d+)?\\s*%\\s*off\\s*/i, "")
      .replace(/(?:₹|Rs\\.?|INR)\\s*[0-9,]+(?:\\.[0-9]+)?/gi, "")
      .replace(/\\b(?:delivery in\\s*)?\\d+(?:\\s*-\\s*\\d+)?\\s*(?:mins?|minutes?|hours?|sec|seconds?)\\b/gi, "")
      .replace(/\\b(?:add|options?)\\s*\\d*\\b/gi, "")
      .replace(/\\b\\d+(?:\\.\\d+)?\\s*(?:lac|lakh)\\b/gi, "")
      .replace(/\\b(?:fastest delivery|standard delivery|instant delivery|express delivery|free delivery|delivery)\\b/gi, "")
      .replace(/\\b(?:mrp|add|buy|added|in stock|out of stock|off|\\d+%\\s*off|save)\\b/gi, "")
      .replace(/(?<=[a-z])(?=[A-Z])/g, " ")
      .replace(/\\badd\\b/gi, "")
      .replace(/\\b(?:previously bought|earlier bought)\\b/gi, "")
      .replace(/(?<=[a-z])[A-Z](?=\\s|$)/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&#x27;/g, "'")
      .replace(/&#39;/g, "'")
      .replace(/\\s+/g, " ")
      .trim();
  }

  function scoreRelevance(itemTitle, query, packSize) {
    if (!itemTitle || !query || !query.trim()) return 0;
    const normalize = (str) => (str || "").toLowerCase().replace(/['’\`"]/g, "").replace(/[^a-z0-9\\s]/g, " ").replace(/\\s+/g, " ").trim();
    const fullText = normalize(String(itemTitle).replace(/\\([^)]*\\)/g, " ") + " " + (packSize || ""));
    const fullTextAlt = normalize(itemTitle + " " + (packSize || ""));
    const q = normalize(query);
    const queryTokens = q.split(/\\s+/).filter(Boolean);
    if (queryTokens.length === 0) return 0;

    let score = 0;
    let matchedTokens = 0;

    const matchToken = (text, token) => {
      const wordBoundary = new RegExp("(^|\\s)" + token + "(\\s|$)");
      if (wordBoundary.test(text)) return 35;
      if (text.includes(token)) return 20;
      if (token.endsWith('s') && token.length > 3 && text.includes(token.slice(0, -1))) return 18;
      if (!token.endsWith('s') && text.includes(token + 's')) return 18;
      return 0;
    };

    queryTokens.forEach(token => {
      const pts = Math.max(matchToken(fullText, token), matchToken(fullTextAlt, token));
      if (pts > 0) {
        score += pts;
        matchedTokens++;
      }
    });

    if (queryTokens[0].length >= 2) {
      const firstWordRx = new RegExp("(^|\\s)" + queryTokens[0] + "(\\s|$)");
      const hasFirstWord = firstWordRx.test(fullText) || firstWordRx.test(fullTextAlt);
      if (!hasFirstWord && !fullText.includes(queryTokens[0])) {
        score -= 50;
      } else {
        score += 25;
      }
    }

    const strippedTitle = normalize(String(itemTitle).replace(/\\([^)]*\\)/g, " "));
    if (q && strippedTitle.startsWith(q)) score += 20;

    const VARIETY_MODIFIERS = ["spring", "sambar", "green", "bunch", "shallot"];
    if (q) {
      const varietyRx = new RegExp("\\\\b(" + VARIETY_MODIFIERS.join("|") + ")\\\\s+" + q + "\\\\b");
      if (varietyRx.test(strippedTitle)) score -= 15;
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

    const coverage = matchedTokens / queryTokens.length;
    score = Math.round(score * (0.5 + 0.5 * coverage));

    return Math.max(0, score);
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
    if (cardNode.closest && cardNode.closest('[class*="filter"], [class*="suggestion"], [class*="chip"], [class*="pill"], [class*="breadcrumb"], [class*="header"], [class*="footer"], [class*="nav"], [class*="search-heading"], [class*="result-info"], [class*="s-breadcrumb"], header, footer, nav')) {
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
    if (/(?:showing\\s+)?results\\s+for|search\\s+results\\s+for|did\\s+you\\s+mean/i.test(spacedCardText)) {
      return null;
    }
    
    // 1. Price extraction
    let price = null;
    const priceEl = cardNode.querySelector ? cardNode.querySelector('[data-slot-id="EdlpPrice"], [data-testid*="price"], [data-testid*="item_price"], [data-testid*="offer-price"], span.a-price span.a-offscreen, span.a-price .a-price-whole, span.a-price, span.a-color-price, [class*="a-price"], div.hZ3P6w, div.Nx9bqj, div._30jeq3, div._1vC4OE, [class*="hZ3P6w"], [class*="Nx9bqj"], [class*="_30jeq3"], [class*="_2jn41"], [class*="_1yW90"], [class*="_3-M84"]') : null;
    if (priceEl) {
      const pTxt = getSpacedText(priceEl).trim();
      const m = pTxt.replace(/,/g, "").match(/([0-9]+(?:\\.[0-9]+)?)/);
      if (m) {
        const val = parseFloat(m[1]);
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

    if (!price || price <= 0 || price > 500000) {
      (window.__lowpFailLog = window.__lowpFailLog || []).push({ f: "price", txt: (cardNode.textContent || "").replace(/\\s+/g, " ").slice(0, 60) });
      return null;
    }

    const imgEl = cardNode.querySelector ? cardNode.querySelector('img.s-image, img.UCc1lI, img._396cs4, img.DByuf4, img[src*="media-amazon.com"], img[src*="rukminim"], img') : null;
    const image = imgEl ? (imgEl.src || (imgEl.getAttribute && imgEl.getAttribute('src')) || "assets/icon48.png") : "assets/icon48.png";

    let title = "";

    // 2. Title extraction:
    // 2a. Full aria-label on h2 (Amazon full product title)
    const ariaHeading = cardNode.querySelector ? cardNode.querySelector('h2[aria-label]') : null;
    if (ariaHeading && ariaHeading.getAttribute('aria-label')) {
      const cleanAria = cleanTitle(ariaHeading.getAttribute('aria-label'));
      if (cleanAria && cleanAria.length >= 6 && !isBadTitle(cleanAria)) {
        title = cleanAria;
      }
    }

    // 2b. Priority product title selectors
    if (!title) {
      const titleEl = cardNode.querySelector ? cardNode.querySelector('h2.a-size-mini span, h2.a-size-mini, h2.a-size-base-plus, h2.a-size-medium, h2 a span, h2 a, [data-slot-id="ProductName"], [data-testid*="name"], [data-testid*="title"], [data-testid*="item_name"], [data-testid*="item-title"], [data-slot-id*="title"], [data-cy="title-recipe"] h2, h2.a-color-base, a.a-text-normal[href*="/dp/"] span, a[title], div.KzDlHZ, a.pIpigb, a.wjcEIp, a.s1Q9rs, div._4rR01T, div.YBLCv4, a.WKTcLC, [class*="ProductName"], [class*="ItemName"], [class*="product_name"], [class*="styled__ItemName"], [class*="ItemTitle"], [class*="Product__UpdatedTitle"], [class*="tw-text-base-black"], [class*="tw-line-clamp-2"], [class*="_2T1-K"], [class*="nov9b"], [class*="_1W_4e"], [class*="_1b1-N"], h1, h3, h4, h5') : null;
      if (titleEl) {
        const rawTxt = (titleEl.getAttribute && titleEl.getAttribute('title')) || titleEl.textContent;
        const txt = cleanTitle(rawTxt);
        if (txt && txt.length >= 3 && !isBadTitle(txt)) {
          title = txt;
        }
      }
    }

    // 2c. Check for separate brand tag on Amazon/Flipkart and prepend if not already in title
    const brandEl = cardNode.querySelector ? cardNode.querySelector('span.a-size-medium.a-color-base, h5.s-line-clamp-1') : null;
    const brandTxt = brandEl ? cleanTitle(brandEl.textContent) : "";
    if (brandTxt && brandTxt.length >= 2 && brandTxt.length <= 25 && title && !title.toLowerCase().startsWith(brandTxt.toLowerCase())) {
      title = brandTxt + " " + title;
    }

    if (!title && imgEl && (imgEl.alt || (imgEl.getAttribute && imgEl.getAttribute('alt')))) {
      const altTxt = cleanTitle(imgEl.alt || imgEl.getAttribute('alt'));
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

    if (!title || isBadTitle(title)) {
      (window.__lowpFailLog = window.__lowpFailLog || []).push({ f: "title", txt: (title || cardNode.textContent || "").slice(0, 60) });
      return null;
    }

    const qtyEl = cardNode.querySelector ? cardNode.querySelector('[data-slot-id="PackSize"], [data-testid*="quantity"], [data-testid*="weight"], [data-testid*="item_quantity"], [class*="PackSize"], [class*="weight"], [class*="quantity"], span[class*="pack"], span[class*="unit"]') : null;
    const quantity = qtyEl ? qtyEl.textContent.trim() : "1 unit";

    let mrp = price;
    const mrpEl = cardNode.querySelector ? cardNode.querySelector('span.a-price.a-text-price span.a-offscreen, span[data-a-strike="true"], span.a-text-price, div.kRYCnD, div.yRaY8j, div._3I9_wc, [class*="kRYCnD"], [class*="yRaY8j"], [class*="_3I9_wc"], s, del, strike, [class*="strike"], [class*="slashed"]') : null;
    if (mrpEl) {
      const mMatch = mrpEl.textContent.replace(/,/g, "").match(/([0-9]+(?:\\.[0-9]+)?)/);
      if (mMatch) {
        const val = parseFloat(mMatch[1]);
        if (val >= price) mrp = val;
      }
    } else {
      const mrpMatch = spacedCardText.match(/(?:MRP|M\\.R\\.P|Strike)\\s*(?:₹|Rs\\.?|INR)?\\s*([0-9,]+(?:\\.[0-9]+)?)/i);
      if (mrpMatch) {
        const val = parseFloat(mrpMatch[1].replace(/,/g, ""));
        if (val >= price) mrp = val;
      }
    }

    const linkEl = cardNode.querySelector ? cardNode.querySelector('a[href*="/dp/"], a[href*="/p/"], a.a-link-normal[href*="/gp/product/"], a.a-link-normal[href*="/dp/"], a.GnxRXv, a.pIpigb, a.fb4uj3, h2 a, a[href]') : null;
    let productUrl = window.location.href;
    if (linkEl && linkEl.href) {
      productUrl = linkEl.href;
    } else if (linkEl && linkEl.getAttribute && linkEl.getAttribute('href')) {
      const hrefAttr = linkEl.getAttribute('href');
      if (hrefAttr.startsWith('http')) productUrl = hrefAttr;
      else if (hrefAttr.startsWith('/')) productUrl = window.location.origin + hrefAttr;
    }

    const brand = platformId === "amazon_tez" ? "Amazon Now (Tez)" : (platformId === "instamart" ? "Swiggy Instamart" : (platformId === "zepto" ? "Zepto" : (platformId === "blinkit" ? "Blinkit" : (platformId === "amazon_main" ? "Amazon.in" : (platformId === "flipkart" ? "Flipkart" : "Store")))));

    return {
      title,
      price,
      sponsored: /(?:^|[\\s])(?:sponsored|ad|ads|promoted|featured)(?:[\\s]|$)/i.test(
        spacedCardText + " " + ((imgEl && (imgEl.alt || "") + " " + (imgEl.title || "")) || "")
      ),
      mrp: Math.max(mrp, price),
      brand,
      quantity,
      image,
      productUrl,
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
                  brand: targetPlatformId === "instamart" ? "Swiggy Instamart" : (targetPlatformId === "zepto" ? "Zepto" : (targetPlatformId === "blinkit" ? "Blinkit" : (targetPlatformId === "amazon_main" ? "Amazon.in" : (targetPlatformId === "flipkart" ? "Flipkart" : "Amazon Now (Tez)")))),
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
      'div[data-component-type="s-search-result"]',
      'div[class*="s-result-item"]',
      'div[data-asin]:not([data-asin=""])',
      'div[data-id]',
      'div[class*="_1AtVbE"]',
      'div[class*="_75nlfW"]',
      'div[class*="slAVV4"]',
      'div[class*="cPHDOP"]',
      'div[class*="RGLWAk"]'
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
    // Product-card selection: keep matched nodes holding an image plus a
    // plausible price in their text. Some stores (Blinkit) render prices as
    // bare "₹77" text with no class hooks, so a price ELEMENT probe fails.
    // Qualify on price-text only. Requiring an <img> races Blinkit's lazy
    // image insertion and drops real cards during early passes.
    let cards = allMatched.filter((c) => {
      const t = c.textContent || "";
      if (/(?:₹|Rs\\.?|INR)\\s*[0-9,]{1,6}/i.test(t)) return true;
      for (const el of c.querySelectorAll("div, span, p")) {
        if (el.children && el.children.length > 0) continue;
        if (/^[0-9]{1,6}$/.test((el.textContent || "").trim())) return true;
      }
      return false;
    });
    // Prefer image-holding cards when available (better titles via alt text),
    // but never at the cost of dropping price-valid cards that lack images yet.
    const withImg = cards.filter((c) => c.querySelector("img"));
    if (withImg.length >= 3) cards = withImg;
    // If several nested matches qualify, keep the innermost per family
    // (drop the node that CONTAINS another qualifying node).
    cards = cards.filter((c, i) => {
      for (let j = 0; j < cards.length; j++) {
        if (j !== i && c.contains(cards[j])) return false;
      }
      return true;
    });
    let scannedCards = 0;
    for (const card of cards) {
      if (++scannedCards > 60) break;
      const item = extractFromCard(card, targetPlatformId);
      if (item && item.price > 0 && !isDuplicateCandidate(candidates, item)) {
        item.__el = card;
        candidates.push(item);
        // Only the store's own top listings matter: deep-page sponsored
        // strips were polluting results. 5 is enough to pick a best-of-3.
        if (candidates.length >= 5) break;
      }
    }
    // Sponsored badges often sit OUTSIDE the innermost product node, so mark
    // items by geometry: badge rect -> nearest product card below it.
    try {
      const sponsoredRoots = [];
      const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let tn;
      while ((tn = tw.nextNode())) {
        if (/^(?:sponsored|ad)$/i.test((tn.nodeValue || "").trim()) && tn.parentElement) {
          sponsoredRoots.push(tn.parentElement);
        }
      }
      // Attribution must be tight: an "Ad" chip belongs to the product in the
      // SAME grid cell — directly below within one row height (~120px) and
      // horizontally inside that cell. Loose windows mis-attribute to the
      // next row's organic products and wrongly demote them.
      const itemRects = sponsoredRoots.length
        ? candidates.filter((c) => c.__el).map((ci) => ({ ci, r: ci.__el.getBoundingClientRect() }))
        : [];
      for (const root of sponsoredRoots) {
        let cellRoot = root;
        for (let up = 0; up < 4 && cellRoot.parentElement; up++) {
          cellRoot = cellRoot.parentElement;
          if (cellRoot.getBoundingClientRect().width > 120) break;
        }
        const cw = cellRoot.getBoundingClientRect();
        for (const ir of itemRects) {
          const vGap = ir.r.top - cw.bottom;
          if (vGap < -8 || vGap > 120) continue;
          const overlapStart = Math.max(ir.r.left, cw.left);
          const overlapEnd = Math.min(ir.r.right, cw.right);
          if (overlapEnd - overlapStart < Math.min(ir.r.width, cw.width) * 0.5) continue;
          ir.ci.sponsored = true;
          break;
        }
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
            if (candidates.length >= 5) break;
          }
        }
      }
    }

    // Old behavior dropped Blinkit's first listing unconditionally (it used to
    // be a search-header card echoing the query verbatim, e.g. title "raw mango"
    // with another item's price). Only strip when the title is EXACTLY the
    // query — real products always carry brand/pack/variant words.
    if (targetPlatformId === "blinkit" && candidates.length > 1) {
      const firstTitle = String(candidates[0].title || "").toLowerCase().replace(/[^a-z0-9\\s]/g, " ").replace(/\\s+/g, " ").trim();
      const qNorm = String(searchQuery || "").toLowerCase().replace(/[^a-z0-9\\s]/g, " ").replace(/\\s+/g, " ").trim();
      if (qNorm && firstTitle === qNorm) {
        candidates.shift();
      }
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
    // Word-level relevance: the word is the minimum matching unit (no
    // character substrings). Score counts how many query words appear in the
    // title; ties keep the store's own display order (stable sort).
    const qWords = String(searchQuery || "").toLowerCase().replace(/[^a-z0-9\\s]/g, " ").split(/\\s+/).filter(Boolean);
    const stem = (w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w);
    const ranked = candidates.map((c) => {
      let _score = scoreRelevance(c.title, searchQuery, c.quantity);
      const isSponsored = !!c.sponsored || /\b(?:sponsored\s+ad|sponsored|ad)\b/i.test(c.rawTitle || c.title || "");
      if (isSponsored) _score -= 15;
      return Object.assign({}, c, { _score, isSponsored });
    });

    // If candidate has "Sponsored" or "Ad" and score is lower than 25, discard it
    const filtered = ranked.filter((c) => {
      if (c.isSponsored && c._score < 25) return false;
      return true;
    });

    function applyTitleLengthBonus(cands, query) {
      if (!cands || cands.length <= 1 || !query) return cands;
      const cleanQ = String(query).trim();
      const qLen = cleanQ.length;
      if (qLen === 0) return cands;

      const topN = cands.slice(0, 3);
      const sortedByLenDiff = topN
        .map((item) => ({
          item,
          diff: Math.abs((item.title || "").trim().length - qLen)
        }))
        .sort((a, b) => a.diff - b.diff);

      if (sortedByLenDiff[0]) {
        sortedByLenDiff[0].item._score = (sortedByLenDiff[0].item._score || 0) + 20;
      }
      if (sortedByLenDiff[1]) {
        sortedByLenDiff[1].item._score = (sortedByLenDiff[1].item._score || 0) + 10;
      }

      cands.sort((a, b) => (b._score || 0) - (a._score || 0));
      return cands;
    }

    filtered.sort((a, b) => b._score - a._score);
    const qualified = filtered.filter((c) => c._score > 0);
    let pool = (searchQuery && searchQuery.trim() && qualified.length > 0) ? qualified : filtered;
    if (pool.length > 1 && searchQuery && searchQuery.trim()) {
      applyTitleLengthBonus(pool, searchQuery);
    }
    const topCandidates = pool.slice(0, 3);
    return { best: topCandidates[0] || null, candidates: topCandidates, found: candidates.length };
  }

  // Stale-page guard: a reused WebView mid-navigation must never answer with
  // the previous query's products. Results are accepted when the live
  // document URL contains any significant search token.
  const queryTokens = String(searchQuery || "").toLowerCase().replace(/[^a-z0-9\\s]/g, " ").split(/\\s+/).filter((t) => t.length >= 2);
  const hrefOk = () => {
    try {
      let href = (window.location.href || "").toLowerCase();
      try { href += " " + decodeURIComponent(href).replace(/\\+/g, " "); } catch (e) {}
      if (href.includes("/dp/") || href.includes("/product/") || href.includes("/pn/") || href.includes("/item/") || href.includes("/prid/")) {
        return true;
      }
      if (queryTokens.length > 0) {
        return queryTokens.some((t) => href.includes(t));
      }
      return true;
    } catch (e) {
      return true;
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

  // Execute reactively and poll up to 9 seconds.
  // 1. Run immediately on evaluation (t = 0).
  // 2. Observe DOM mutations with a lightweight 80ms debounce so React/Next.js
  //    hydration triggers extraction immediately.
  // 3. Fast adaptive polling (150ms) ensures background/timer throttled
  //    WebViews still settle within ~1.5s instead of paying 500ms dead waits.
  let attempts = 0;
  let bestRes = null;
  let lastSig = null;
  let lastChangeAt = Date.now();
  let finalized = false;
  let pollInterval = null;
  let mutationObserver = null;
  let debounceTimer = null;
  let lastAttemptTime = 0;

  const sigOf = (res) => ((res && res.candidates) || []).map((c) => c.title + "@" + c.price).join("|");

  function sendResult(success, data, candidates, debug) {
    if (finalized) return;
    finalized = true;
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
    if (window.__lowpScraperTimer) {
      clearInterval(window.__lowpScraperTimer);
      window.__lowpScraperTimer = null;
    }
    if (mutationObserver) {
      try { mutationObserver.disconnect(); } catch (e) {}
      mutationObserver = null;
    }
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'SCRAPE_RESULT',
        platformId: targetPlatformId,
        success,
        data: data || null,
        candidates: candidates || [],
        debug: Object.assign({
          url: window.location.href,
          title: document.title,
          attempts: attempts,
          domNodes: document.getElementsByTagName ? document.getElementsByTagName("*").length : 0
        }, debug || {})
      }));
    }
  }

  function attemptExtraction() {
    if (finalized) return;
    const now = Date.now();
    if (now - lastAttemptTime < 80) return;
    lastAttemptTime = now;
    attempts++;

    let res = runExtraction();
    if (res.best && !hrefOk()) {
      res = { best: null, candidates: [], found: 0 };
    }

    // Empty-state early exit: when the site itself explicitly displays a "no results" state
    if (!res.best && attempts >= 8 && document.readyState === "complete") {
      try {
        const bodyText = visibleBodyText();
        const hasExplicitNoResults = /(?:no\s+results\s+for\s+[^.]*check\s+your\s+spelling|no\s+results\s+found\s+for|we\s+couldn't\s+find\s+any\s+results|could\s+not\s+find\s+any\s+results|did\s+not\s+match\s+any\s+products|no\s+products\s+found\s+for|0\s+items\s+found\s+for|nothing\s+here\s+yet)/i.test(bodyText) ||
          !!(document.querySelector && document.querySelector('.s-no-outline, [data-component-type="s-no-results-found"], [data-testid="no-results-container"], [class*="noResults"], [class*="EmptyState"]'));
        if (hasExplicitNoResults) {
          sendResult(false, null, [], { reason: 'empty_state' });
          return;
        }
      } catch (e) {}
    }

    // Second-tier give-up: page fully loaded, 18+ attempts (~2.5s+), still zero candidates
    if (!res.best && attempts >= 20 && document.readyState === "complete") {
      sendResult(false, null, [], { reason: 'no_results_timeout' });
      return;
    }

    if (res.best) {
      const sig = sigOf(res);
      if (sig !== lastSig) {
        lastSig = sig;
        lastChangeAt = now;
        bestRes = res;
      }

      const topScore = (bestRes.best && bestRes.best._score) || 0;
      const found = bestRes.found || 0;
      const candCount = (bestRes.candidates || []).length;
      const isDocReady = document.readyState === "complete" || document.readyState === "interactive";

      // FAST-PATH SETTLEMENT:
      // If we have a confident full listing (>= 3 candidates with valid score) or
      // a complete document with multiple valid candidates, settle immediately!
      if ((candCount >= 3 && topScore >= 30) || (found >= 4 && isDocReady && topScore >= 20) || (topScore >= 55 && candCount >= 2)) {
        sendResult(true, bestRes.best, bestRes.candidates, { failures: (window.__lowpFailLog || []).slice(0, 8), fastSettled: true });
        return;
      }

      // SHORT-WINDOW SETTLEMENT for partial/single candidate matches:
      const settledFor = (topScore >= 40 && found >= 3) ? 80 : 250;
      if (now - lastChangeAt >= settledFor) {
        sendResult(true, bestRes.best, bestRes.candidates, { failures: (window.__lowpFailLog || []).slice(0, 8) });
        return;
      }
    }

    if (attempts >= 40) { // ~6-7s limit
      sendResult(!!(bestRes && bestRes.best), (bestRes && bestRes.best) || null, (bestRes && bestRes.candidates) || [], {
        failures: (window.__lowpFailLog || []).slice(0, 12),
        reason: 'max_attempts'
      });
    }
  }

  // 1. Immediate execution
  attemptExtraction();

  // 2. Reactive MutationObserver
  try {
    const rootNode = document.body || document.documentElement;
    if (rootNode && typeof MutationObserver !== "undefined") {
      mutationObserver = new MutationObserver(() => {
        if (finalized) return;
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          attemptExtraction();
        }, 60);
      });
      mutationObserver.observe(rootNode, { childList: true, subtree: true });
    }
  } catch (e) {}

  // 3. Document Lifecycle hooks
  if (document.readyState !== "complete") {
    document.addEventListener("DOMContentLoaded", attemptExtraction, { once: true });
    document.addEventListener("readystatechange", attemptExtraction);
  }

  // 4. Fast adaptive polling interval (150ms)
  pollInterval = setInterval(attemptExtraction, 150);
  window.__lowpScraperTimer = pollInterval;
})();
true;
`;
}
