/**
 * LowP - Real-Time Price Comparator Service Worker (Manifest V3)
 * Focused on Amazon India, Swiggy Instamart, and Zepto
 */

// ==========================================
// 1. IN-MEMORY DEBUG TELEMETRY LOG
// ==========================================
const DEBUG_LOGS = [];
const MAX_DEBUG_LOGS = 100;

function logDebug(category, message, data = null) {
  const entry = {
    timestamp: new Date().toISOString(),
    category,
    message,
    data: data ? JSON.parse(JSON.stringify(data)) : null
  };
  DEBUG_LOGS.unshift(entry);
  if (DEBUG_LOGS.length > MAX_DEBUG_LOGS) DEBUG_LOGS.pop();
  console.log(`[LowP ${category}] ${message}`, data || "");
}

// ==========================================
// 2. LOCATION PROFILES & PINCODE RESOLVER
// ==========================================
const DEFAULT_LOCATION = {
  id: "loc_hyd_500085",
  name: "Hyderabad (Kukatpally)",
  pincode: "500085",
  lat: 17.501725514188223,
  lng: 78.39361254731166,
  address: "Kukatpally, Hyderabad, Telangana 500085",
  isDefault: true
};

const DEFAULT_PROFILES = [
  DEFAULT_LOCATION,
  {
    id: "loc_blr_560034",
    name: "Bengaluru (Koramangala)",
    pincode: "560034",
    lat: 12.9352,
    lng: 77.6245,
    address: "Koramangala, Bengaluru, Karnataka 560034"
  },
  {
    id: "loc_mum_400050",
    name: "Mumbai (Bandra)",
    pincode: "400050",
    lat: 19.0596,
    lng: 72.8295,
    address: "Bandra West, Mumbai, Maharashtra 400050"
  },
  {
    id: "loc_del_110001",
    name: "Delhi (Connaught Place)",
    pincode: "110001",
    lat: 28.6304,
    lng: 77.2177,
    address: "Connaught Place, New Delhi, Delhi 110001"
  }
];

class LocationService {
  static async getActiveLocation() {
    return new Promise((resolve) => {
      if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.sync) {
        return resolve(DEFAULT_LOCATION);
      }
      chrome.storage.sync.get(["activeLocation", "locationProfiles"], (result) => {
        if (!result.locationProfiles || result.locationProfiles.length === 0) {
          chrome.storage.sync.set({
            locationProfiles: DEFAULT_PROFILES,
            activeLocation: DEFAULT_LOCATION
          });
          return resolve(DEFAULT_LOCATION);
        }
        resolve(result.activeLocation || result.locationProfiles[0] || DEFAULT_LOCATION);
      });
    });
  }

  static async getProfiles() {
    return new Promise((resolve) => {
      if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.sync) {
        return resolve(DEFAULT_PROFILES);
      }
      chrome.storage.sync.get(["locationProfiles"], (result) => {
        if (!result.locationProfiles || result.locationProfiles.length === 0) {
          chrome.storage.sync.set({ locationProfiles: DEFAULT_PROFILES });
          return resolve(DEFAULT_PROFILES);
        }
        resolve(result.locationProfiles);
      });
    });
  }

  static async setActiveProfile(profileId) {
    const profiles = await this.getProfiles();
    const target = profiles.find((p) => p.id === profileId);
    if (!target) throw new Error("Location profile not found");

    await new Promise((resolve) => {
      chrome.storage.sync.set({ activeLocation: target }, resolve);
    });
    logDebug("Location", "Switched active location", target);
    return target;
  }

  static async saveCustomLocation(name, addressText) {
    const geo = await this.geocodeAddress(addressText);
    const profiles = await this.getProfiles();
    const newProfile = {
      id: `loc_${Date.now()}`,
      name: name.trim() || `Location ${profiles.length + 1}`,
      address: geo.display_name || addressText.trim(),
      pincode: geo.pincode || "500085",
      lat: geo.lat,
      lng: geo.lng
    };
    profiles.push(newProfile);
    await new Promise((resolve) => {
      chrome.storage.sync.set({ locationProfiles: profiles, activeLocation: newProfile }, resolve);
    });
    logDebug("Location", "Saved custom location", newProfile);
    return newProfile;
  }

  static async deleteProfile(profileId) {
    let profiles = await this.getProfiles();
    if (profiles.length <= 1) throw new Error("Cannot delete the only location profile.");
    profiles = profiles.filter((p) => p.id !== profileId);
    const active = await this.getActiveLocation();
    const updates = { locationProfiles: profiles };
    if (active.id === profileId) {
      updates.activeLocation = profiles[0];
    }
    await new Promise((resolve) => chrome.storage.sync.set(updates, resolve));
    return true;
  }

  static async geocodeAddress(addressText) {
    const pinMatch = (addressText || "").match(/\b([1-9][0-9]{5})\b/);
    if (pinMatch) {
      const pin = pinMatch[1];
      const pinMap = {
        "500085": { lat: 17.5017, lng: 78.3936, name: "Kukatpally, Hyderabad" },
        "500072": { lat: 17.4947, lng: 78.3996, name: "KPHB Colony, Hyderabad" },
        "560034": { lat: 12.9352, lng: 77.6245, name: "Koramangala, Bengaluru" },
        "400050": { lat: 19.0596, lng: 72.8295, name: "Bandra, Mumbai" },
        "110001": { lat: 28.6304, lng: 77.2177, name: "Connaught Place, Delhi" }
      };
      if (pinMap[pin]) {
        return {
          lat: pinMap[pin].lat,
          lng: pinMap[pin].lng,
          pincode: pin,
          display_name: `${pinMap[pin].name}, ${pin}`
        };
      }
    }

    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&countrycodes=in&q=${encodeURIComponent(addressText)}`;
      const res = await fetch(url, { headers: { "User-Agent": "LowPPriceComparator/2.0" } });
      if (res.ok) {
        const data = await res.json();
        if (data && data.length > 0) {
          return {
            lat: parseFloat(data[0].lat),
            lng: parseFloat(data[0].lon),
            display_name: data[0].display_name,
            pincode: pinMatch ? pinMatch[1] : "500085"
          };
        }
      }
    } catch (e) {}

    return {
      lat: DEFAULT_LOCATION.lat,
      lng: DEFAULT_LOCATION.lng,
      display_name: addressText || DEFAULT_LOCATION.address,
      pincode: pinMatch ? pinMatch[1] : DEFAULT_LOCATION.pincode
    };
  }
}

// ==========================================
// 3. MATCHING ENGINE (PURE BASE PRICE & BADGES)
// ==========================================
class MatchingEngine {
  static cleanSearchTerm(query) {
    if (!query) return "";
    let q = query;
    try {
      q = decodeURIComponent(q);
    } catch (e) {}
    q = q.replace(/https?:\/\/[^\s]+/g, "");
    q = q.replace(/\b(?:delivery in\s*)?\d+(?:\s*-\s*\d+)?\s*(?:mins?|minutes?|hours?|sec|seconds?)\b/gi, "");
    q = q.replace(/\b(?:fastest delivery|standard delivery|instant delivery|express delivery|free delivery|delivery)\b/gi, "");
    q = q.replace(/[,\-_|+/\\%]+/g, " ");
    q = q.replace(/\s+/g, " ").trim();
    return q;
  }

  static calculateTotalCost(item) {
    if (!item) return { basePrice: 0, finalPayable: 0, savings: 0, discountPercent: 0 };
    const basePrice = Math.round(Number(item.price) || 0);
    const mrp = Math.round(Number(item.mrp) || basePrice);
    const savings = Math.max(0, mrp - basePrice);
    const discountPercent = mrp > 0 ? Math.round((savings / mrp) * 100) : 0;
    return { basePrice, finalPayable: basePrice, savings, discountPercent };
  }

  static scoreRelevance(itemTitle, query, packSize = '') {
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

    queryTokens.forEach(token => {
      if (fullText.includes(token)) {
        score += 30;
      } else if (token.endsWith('s') && token.length > 3 && fullText.includes(token.slice(0, -1))) {
        score += 25;
      } else if (!token.endsWith('s') && fullText.includes(token + 's')) {
        score += 25;
      }
    });

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
          if (cNum !== qNum) score -= 40;
        }
      }
    }

    if (queryTokens.length > 0 && fullText.includes(queryTokens[0])) {
      score += 25;
    }

    return score;
  }

  static annotateBestOffers(results) {
    const available = results.filter((r) => r && r.isAvailable && r.priceBreakdown && r.priceBreakdown.finalPayable > 0);
    if (available.length === 0) return results;

    let minPrice = Infinity;

    available.forEach((r) => {
      const p = r.priceBreakdown.finalPayable;
      if (p < minPrice) minPrice = p;
    });

    results.forEach((r) => {
      if (r && r.isAvailable && r.priceBreakdown && r.priceBreakdown.finalPayable > 0) {
        r.isLowestPrice = r.priceBreakdown.finalPayable === minPrice;
      } else if (r) {
        r.isLowestPrice = false;
      }
    });

    return results;
  }
}

// ==========================================
// 4. PLATFORM PROVIDERS
// ==========================================
class BaseProvider {
  constructor(platformId, platformName, logoColor) {
    this.platformId = platformId;
    this.platformName = platformName;
    this.logoColor = logoColor;
  }

  formatResult(item, location, fallbackQuery = "") {
    if (!item) {
      return {
        platformId: this.platformId,
        platformName: this.platformName,
        logoColor: this.logoColor,
        isAvailable: false,
        statusMessage: "Not available for this location",
        item: null,
        priceBreakdown: null,
        productUrl: this.getSearchUrl(fallbackQuery),
        isLowestPrice: false
      };
    }

    const priceBreakdown = MatchingEngine.calculateTotalCost(item);
    return {
      platformId: this.platformId,
      platformName: this.platformName,
      logoColor: this.logoColor,
      isAvailable: true,
      statusMessage: "In Stock",
      item: {
        id: item.id || `${this.platformId}_${Date.now()}`,
        title: item.title,
        brand: item.brand || this.platformName,
        quantity: item.quantity || "1 unit",
        mrp: item.mrp || item.price,
        price: item.price,
        image: item.image || "assets/icon48.png"
      },
      priceBreakdown,
      productUrl: item.productUrl || this.getSearchUrl(item.title || fallbackQuery),
      isLowestPrice: false
    };
  }

  getSearchUrl(query) {
    return "#";
  }
}

function inPageExtract(searchQuery) {
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
      .replace(/\b(?:fastest delivery|standard delivery|instant delivery|express delivery|free delivery|delivery)\b/gi, "")
      .replace(/\b(?:mrp|add|buy|added|in stock|out of stock|off|\d+%\s*off|save)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
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
      mrp = Math.round(price * 1.15);
    }

    const brand = platformId === "amazon_tez" ? "Amazon Now (Tez)" : (platformId === "instamart" ? "Swiggy Instamart" : (platformId === "zepto" ? "Zepto" : (platformId === "blinkit" ? "Blinkit" : (platformId === "google_shopping" ? "Google Shopping" : "Quick Store"))));

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

  const host = (window.location.hostname || "").toLowerCase();
  const pathname = (window.location.pathname || "").toLowerCase();
  const href = (window.location.href || "").toLowerCase();
  const isPDP = pathname.includes("/pn/") || pathname.includes("/product/") || pathname.includes("/item/") || pathname.includes("/dp/") || pathname.includes("/prid/") || pathname.includes("/shopping/product/");

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

  // 2. PDP Handling
  if (isPDP) {
    const pdpTitle = document.querySelector('h1[data-testid*="name"], h1[data-testid*="title"], h1#title span, h1');
    const pdpPrice = document.querySelector('[data-testid*="price"], span.a-price-whole, span.a-offscreen, h4, div[class*="price"]');
    if (pdpTitle && pdpPrice) {
      const title = pdpTitle.textContent?.trim();
      const pMatch = pdpPrice.textContent?.match(/([0-9,]+(?:\.[0-9]+)?)/);
      if (title && !isBadTitle(title) && pMatch) {
        const price = parseFloat(pMatch[1].replace(/,/g, ""));
        if (price > 0 && price < 500000) {
          const imgEl = document.querySelector("#landingImage, img[class*=\"pdp\"], [data-testid*=\"image\"] img, img");
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

  // 3. Listing Cards
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
    'a[href*="/prid/"]',
    'div[data-test-id*="plp-product"]',
    'div[class*="Product__Updated"]',
    'div[class*="ProductCard"]',
    'div[class*="product"]',
    'a[href*="/p/"]',
    'div[class*="sh-dgr__grid-result"]',
    'div[class*="sh-dgr__content"]',
    'div[class*="KZmu8e"]',
    'div[class*="sh-np__click-target"]',
    'div[class*="pla-unit"]',
    'div[class*="sh-dlr__list-result"]',
    'div[class*="iU5tvd"]',
    'div[data-docid]',
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

  // 3. Proximity Fallback
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

  // Blinkit's first rendered listing can be a search-header card whose title
  // is just the query while its container exposes another item's price.
  // Discard it before ranking the remaining products.
  if (platformId === "blinkit" && !isPDP && candidates.length > 0) {
    candidates.shift();
  }

  if (candidates.length === 0) {
    return {
      success: false,
      data: null,
      debug: {
        url: window.location.href,
        title: document.title,
        htmlLength: document.documentElement ? document.documentElement.outerHTML.length : 0,
        cardsFound: cards.length,
        candidatesFound: 0,
        topCandidate: null
      }
    };
  }

  candidates.forEach(cand => {
    cand._score = scoreRelevance(cand.title, searchQuery, cand.quantity);
  });

  candidates.sort((a, b) => b._score - a._score);
  const best = candidates[0];
  const isValid = best && best._score >= 20;

  return {
    success: isValid,
    data: isValid ? best : null,
    debug: {
      url: window.location.href,
      title: document.title,
      htmlLength: document.documentElement ? document.documentElement.outerHTML.length : 0,
      cardsFound: cards.length,
      candidatesFound: candidates.length,
      topCandidate: best ? { title: best.title, price: best.price, score: best._score } : null,
      sampleCandidates: candidates.slice(0, 3).map(c => ({ title: c.title, price: c.price, score: c._score }))
    }
  };
}

async function extractDataFromTab(tabId, cleanQ) {
  let data = null;
  let debugInfo = null;

  // 1. Direct Script Execution
  if (typeof chrome !== "undefined" && chrome.scripting && chrome.scripting.executeScript) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: inPageExtract,
        args: [cleanQ]
      });
      const res = results && results[0] ? results[0].result : null;
      if (res) {
        data = res.data || (res.price ? res : null);
        debugInfo = res.debug || null;
      }
    } catch (e) {
      logDebug("TabExtract", `Direct tab execution error on ${tabId}: ${e.message}`);
    }
  }

  // 2. Fallback to Content Script message
  if (!data || !data.price) {
    try {
      const res = await chrome.tabs.sendMessage(tabId, { action: "GET_PAGE_PRODUCT_DATA", query: cleanQ });
      if (res && res.data && res.data.price > 0) {
        data = res.data;
      }
    } catch (e) {}
  }

  if (debugInfo) {
    logDebug("TabExtract", `Tab ${tabId} Diagnosed: URL="${debugInfo.url}", Title="${debugInfo.title}", HTML=${debugInfo.htmlLength}b, Cards=${debugInfo.cardsFound}, Candidates=${debugInfo.candidatesFound}, Top=${JSON.stringify(debugInfo.topCandidate)}`, debugInfo);
  }

  if (data && data.price > 0) {
    logDebug("TabExtract", `Tab ${tabId} successfully extracted: "${data.title}" at ₹${data.price} (Score: ${data._score})`, data);
    return data;
  } else {
    logDebug("TabExtract", `Tab ${tabId} returned no matching product for "${cleanQ}"`);
    return null;
  }
}

async function fetchViaEphemeralTab(url, cleanQ, timeoutMs = 8000) {
  if (typeof chrome === "undefined" || (!chrome.tabs && !chrome.windows)) {
    return null;
  }
  let winId = null;
  let tabId = null;
  try {
    logDebug("EphemeralTab", `Opening background window for ${url}`);

    // Create a detached minimized window so the extension popup never loses focus
    if (chrome.windows && chrome.windows.create) {
      try {
        const win = await chrome.windows.create({
          url,
          type: "popup",
          focused: false,
          state: "minimized"
        });
        winId = win.id;
        tabId = win.tabs && win.tabs[0] ? win.tabs[0].id : null;
      } catch (winErr) {
        // Fallback to tab creation if window creation fails
        const tab = await chrome.tabs.create({ url, active: false });
        tabId = tab.id;
      }
    } else if (chrome.tabs && chrome.tabs.create) {
      const tab = await chrome.tabs.create({ url, active: false });
      tabId = tab.id;
    }

    if (!tabId) return null;

    // Poll every 500ms up to timeout (returns immediately once data is ready)
    const startTime = Date.now();
    let data = null;
    while (Date.now() - startTime < timeoutMs) {
      data = await extractDataFromTab(tabId, cleanQ);
      if (data && data.price > 0) {
        logDebug("EphemeralTab", `Successfully extracted data from ${url} in ${Date.now() - startTime}ms: "${data.title}" at ₹${data.price}`, data);
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    return data;
  } catch (err) {
    logDebug("EphemeralTab", `Ephemeral extraction error for ${url}: ${err.message}`);
    return null;
  } finally {
    if (winId && typeof chrome !== "undefined" && chrome.windows && chrome.windows.remove) {
      try {
        await chrome.windows.remove(winId);
        logDebug("EphemeralTab", `Ephemeral window ${winId} closed successfully`);
      } catch (e) {}
    } else if (tabId && typeof chrome !== "undefined" && chrome.tabs && chrome.tabs.remove) {
      try {
        await chrome.tabs.remove(tabId);
        logDebug("EphemeralTab", `Ephemeral tab ${tabId} closed successfully`);
      } catch (e) {}
    }
  }
}

function isOpenTabMatchingQuery(tabUrl, query) {
  if (!tabUrl || !query) return false;
  const lowerUrl = tabUrl.toLowerCase();
  const cleanQ = (typeof MatchingEngine !== "undefined" ? MatchingEngine.cleanSearchTerm(query) : query).toLowerCase();

  // If it's a dedicated PDP (Product Detail Page), allow tab extraction (relevance will score the product)
  if (lowerUrl.includes("/dp/") || lowerUrl.includes("/product/") || lowerUrl.includes("/pn/") || lowerUrl.includes("/item/")) {
    return true;
  }

  // If it's a search results page, the search URL MUST contain at least one significant search term
  const tokens = cleanQ.split(/\s+/).filter(t => t.length >= 2);
  if (tokens.length > 0) {
    return tokens.some(t => lowerUrl.includes(encodeURIComponent(t)) || lowerUrl.includes(t));
  }
  return true;
}

// --- AMAZON NOW / TEZ PROVIDER ---
class AmazonTezProvider extends BaseProvider {
  constructor() {
    super("amazon_tez", "Amazon Now (Tez)", "#FF9900");
  }

  getSearchUrl(query) {
    return `https://www.amazon.in/tez/browse/search?searchKeyword=${encodeURIComponent(query || "")}`;
  }

  async search(query, location) {
    if (!query || !query.trim()) return this.formatResult(null, location, query);
    const cleanQ = MatchingEngine.cleanSearchTerm(query);
    const tezUrl = this.getSearchUrl(cleanQ);

    logDebug("AmazonTez", `Searching Amazon Tez for "${cleanQ}" (Live Direct Search)`);

    // 1. Query open Amazon Tez tabs matching the search query
    if (typeof chrome !== "undefined" && chrome.tabs && chrome.tabs.query) {
      try {
        const allTabs = await chrome.tabs.query({});
        const tezTabs = allTabs.filter(t => t.url && t.url.includes("amazon.in") && (t.url.includes("/tez/") || t.url.includes("searchKeyword")) && isOpenTabMatchingQuery(t.url, cleanQ));
        logDebug("AmazonTez", `Found ${tezTabs.length} open matching Amazon Tez tab(s)`);

        for (const t of tezTabs) {
          try {
            logDebug("AmazonTez", `Querying open Amazon Tez tab (${t.id}): ${t.url}`);
            const data = await extractDataFromTab(t.id, cleanQ);
            if (data && data.price > 0 && MatchingEngine.scoreRelevance(data.title, cleanQ) >= 30) {
              logDebug("AmazonTez", `Retrieved relevant price from open Amazon Tez tab: ${data.title} at ₹${data.price}`, data);
              return this.formatResult(data, location, cleanQ);
            }
          } catch (e) {
            logDebug("AmazonTez", `Amazon Tez tab (${t.id}) query error: ${e.message}`);
          }
        }
      } catch (e) {}
    }

    // 3. Automated ephemeral background window extraction targeting Amazon Tez
    if (typeof chrome !== "undefined" && (chrome.tabs || chrome.windows)) {
      try {
        logDebug("AmazonTez", `Attempting automated ephemeral background window extraction for "${cleanQ}"`);
        const ephemeralData = await fetchViaEphemeralTab(tezUrl, cleanQ);
        if (ephemeralData && ephemeralData.price > 0) {
          logDebug("AmazonTez", `Retrieved live price via ephemeral background window: ${ephemeralData.title} at ₹${ephemeralData.price}`, ephemeralData);
          return this.formatResult(ephemeralData, location, cleanQ);
        }
      } catch (e) {
        logDebug("AmazonTez", `Ephemeral extraction error: ${e.message}`);
      }
    }

    // 4. Fallback: Provide direct Tez search link
    return this.formatResult({
      id: `amz_tez_${Date.now()}`,
      title: cleanQ,
      brand: "Amazon Now (Tez)",
      quantity: "1 unit",
      mrp: 0,
      price: 0,
      image: "assets/icon48.png",
      productUrl: tezUrl
    }, location, cleanQ);
  }
}



// --- SWIGGY INSTAMART PROVIDER ---
class InstamartProvider extends BaseProvider {
  constructor() {
    super("instamart", "Swiggy Instamart", "#FC8019");
  }

  getSearchUrl(query) {
    return `https://www.swiggy.com/instamart/search?custom_back=true&query=${encodeURIComponent(query || "")}`;
  }

  async search(query, location) {
    if (!query || !query.trim()) return this.formatResult(null, location);
    const cleanQ = MatchingEngine.cleanSearchTerm(query);
    const targetUrl = this.getSearchUrl(cleanQ);

    logDebug("Instamart", `Searching Instamart for "${cleanQ}" (Live Direct Search)`);

    // 1. Query open Swiggy tabs matching search query
    if (typeof chrome !== "undefined" && chrome.tabs && chrome.tabs.query) {
      try {
        const allTabs = await chrome.tabs.query({});
        const swiggyTabs = allTabs.filter(t => t.url && t.url.includes("swiggy.com") && isOpenTabMatchingQuery(t.url, cleanQ));
        logDebug("Instamart", `Found ${swiggyTabs.length} open matching Swiggy tab(s)`);

        for (const t of swiggyTabs) {
          try {
            logDebug("Instamart", `Querying open Swiggy tab (${t.id}): ${t.url}`);
            const data = await extractDataFromTab(t.id, cleanQ);
            if (data && data.price > 0 && MatchingEngine.scoreRelevance(data.title, cleanQ) >= 30) {
              logDebug("Instamart", `Retrieved relevant price from open Swiggy tab: ${data.title} at ₹${data.price}`, data);
              return this.formatResult(data, location, cleanQ);
            }
          } catch (e) {
            logDebug("Instamart", `Swiggy tab (${t.id}) query error: ${e.message}`);
          }
        }
      } catch (e) {}
    }

    // 3. Direct Background HTML Scraping (like Amazon)
    try {
      const searchRes = await fetch(targetUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        }
      });
      if (searchRes.ok) {
        const html = await searchRes.text();
        const cardBlocks = html.split(/data-testid="item-collection-card-full"|class="[^"]*_3Rr1X[^"]*"/);
        const candidates = [];

        for (let i = 1; i < cardBlocks.length; i++) {
          const block = cardBlocks[i];
          const titleMatch = block.match(/class="[^"]*_1lbNR[^"]*">([^<]+)<\/div>/i) ||
                             block.match(/alt="([^"]+)"[^>]*class="[^"]*_16I1D[^"]*"/i) ||
                             block.match(/class="[^"]*_16I1D[^"]*"[^>]*alt="([^"]+)"/i);
          const priceMatch = block.match(/class="[^"]*_2enD-[^"]*">\s*<div[^>]*class="[^"]*_2jn41[^"]*">([0-9]+)<\/div>/i) ||
                             block.match(/class="[^"]*_2jn41[^"]*">([0-9]+)<\/div>/i);
          const mrpMatch = block.match(/class="[^"]*_3eAjW[^"]*">([0-9]+)<\/div>/i);
          const qtyMatch = block.match(/class="[^"]*_3wq_F[^"]*">([^<]+)/i);
          const imgMatch = block.match(/src="([^"]+)"[^>]*alt="[^"]*"/i) ||
                           block.match(/src="([^"]+)"/i);

          if (titleMatch && priceMatch) {
            const rawTitle = titleMatch[1].trim();
            const title = MatchingEngine.cleanSearchTerm(rawTitle);
            const price = parseFloat(priceMatch[1]);
            const mrp = mrpMatch ? parseFloat(mrpMatch[1]) : Math.round(price * 1.2);
            const quantity = qtyMatch ? qtyMatch[1].trim() : "1 unit";
            const image = imgMatch ? imgMatch[1] : "assets/icon48.png";

            if (title && price > 0) {
              candidates.push({
                id: `im_${Date.now()}_${i}`,
                title: rawTitle,
                brand: "Swiggy Instamart",
                quantity,
                mrp,
                price,
                image,
                productUrl: targetUrl,
                _score: MatchingEngine.scoreRelevance(rawTitle, cleanQ, quantity)
              });
            }
          }
        }

        if (candidates.length > 0) {
          candidates.sort((a, b) => b._score - a._score);
          const best = candidates[0];
          if (best._score >= 20) {
            logDebug("Instamart", `Retrieved best Swiggy match via background scrape: "${best.title}" at ₹${best.price} (Score: ${best._score})`, best);
            return this.formatResult(best, location, cleanQ);
          }
        }
      }
    } catch (err) {
      logDebug("Instamart", `Swiggy background fetch error: ${err.message}`);
    }

    // 4. Automated Ephemeral Background Tab Extractor (when background HTML is empty or blocked)
    try {
      logDebug("Instamart", `Attempting automated ephemeral background tab extraction for "${cleanQ}"`);
      const ephemeralData = await fetchViaEphemeralTab(targetUrl, cleanQ);
      if (ephemeralData && ephemeralData.price > 0) {
        logDebug("Instamart", `Retrieved live price via ephemeral background tab: ${ephemeralData.title} at ₹${ephemeralData.price}`, ephemeralData);
        return this.formatResult(ephemeralData, location, cleanQ);
      }
    } catch (e) {
      logDebug("Instamart", `Ephemeral tab extraction failed: ${e.message}`);
    }

    // 5. Fallback: Provide direct search link
    return this.formatResult({
      id: `im_${Date.now()}`,
      title: cleanQ,
      brand: "Swiggy Instamart",
      quantity: "1 unit",
      mrp: 0,
      price: 0,
      image: "assets/icon48.png",
      productUrl: targetUrl
    }, location, cleanQ);
  }
}

// --- ZEPTO PROVIDER ---
class ZeptoProvider extends BaseProvider {
  constructor() {
    super("zepto", "Zepto", "#7C3AED");
  }

  getSearchUrl(query) {
    return `https://www.zepto.com/search?query=${encodeURIComponent(query || "")}`;
  }

  async search(query, location) {
    if (!query || !query.trim()) return this.formatResult(null, location, query);
    const cleanQ = MatchingEngine.cleanSearchTerm(query);
    const targetUrl = this.getSearchUrl(cleanQ);

    logDebug("Zepto", `Searching Zepto for "${cleanQ}" (Live Direct Search)`);

    // 1. Query open Zepto tabs matching search query
    if (typeof chrome !== "undefined" && chrome.tabs && chrome.tabs.query) {
      try {
        const allTabs = await chrome.tabs.query({});
        const zeptoTabs = allTabs.filter(t => t.url && (t.url.includes("zepto.com") || t.url.includes("zeptonow.com")) && isOpenTabMatchingQuery(t.url, cleanQ));
        logDebug("Zepto", `Found ${zeptoTabs.length} open matching Zepto tab(s)`);

        for (const t of zeptoTabs) {
          try {
            logDebug("Zepto", `Querying open Zepto tab (${t.id}): ${t.url}`);
            const data = await extractDataFromTab(t.id, cleanQ);
            if (data && data.price > 0 && MatchingEngine.scoreRelevance(data.title, cleanQ) >= 30) {
              logDebug("Zepto", `Retrieved relevant price from open Zepto tab: ${data.title} at ₹${data.price}`, data);
              return this.formatResult(data, location, cleanQ);
            }
          } catch (e) {
            logDebug("Zepto", `Zepto tab (${t.id}) query error: ${e.message}`);
          }
        }
      } catch (e) {}
    }

    // 3. Automated Ephemeral Background Tab Extractor (when no Zepto tab is open)
    try {
      logDebug("Zepto", `Attempting automated ephemeral background tab extraction for "${cleanQ}"`);
      const ephemeralData = await fetchViaEphemeralTab(targetUrl, cleanQ);
      if (ephemeralData && ephemeralData.price > 0) {
        logDebug("Zepto", `Retrieved live price via ephemeral background tab: ${ephemeralData.title} at ₹${ephemeralData.price}`, ephemeralData);
        return this.formatResult(ephemeralData, location, cleanQ);
      }
    } catch (e) {
      logDebug("Zepto", `Ephemeral tab extraction failed: ${e.message}`);
    }

    // 4. Fallback: Provide direct search link
    return this.formatResult({
      id: `zepto_${Date.now()}`,
      title: cleanQ,
      brand: "Zepto",
      quantity: "1 unit",
      mrp: 0,
      price: 0,
      image: "assets/icon48.png",
      productUrl: targetUrl
    }, location, cleanQ);
  }
}

// --- BLINKIT PROVIDER ---
class BlinkitProvider extends BaseProvider {
  constructor() {
    super("blinkit", "Blinkit", "#F8CB46");
  }

  getSearchUrl(query) {
    return `https://blinkit.com/s/?q=${encodeURIComponent(query || "")}`;
  }

  async search(query, location) {
    if (!query || !query.trim()) return this.formatResult(null, location, query);
    const cleanQ = MatchingEngine.cleanSearchTerm(query);
    const targetUrl = this.getSearchUrl(cleanQ);

    logDebug("Blinkit", `Searching Blinkit for "${cleanQ}" (Live Direct Search)`);

    // 1. Query open Blinkit tabs matching search query
    if (typeof chrome !== "undefined" && chrome.tabs && chrome.tabs.query) {
      try {
        const allTabs = await chrome.tabs.query({});
        const blinkitTabs = allTabs.filter(t => t.url && t.url.includes("blinkit.com") && isOpenTabMatchingQuery(t.url, cleanQ));
        logDebug("Blinkit", `Found ${blinkitTabs.length} open matching Blinkit tab(s)`);

        for (const t of blinkitTabs) {
          try {
            logDebug("Blinkit", `Querying open Blinkit tab (${t.id}): ${t.url}`);
            const data = await extractDataFromTab(t.id, cleanQ);
            if (data && data.price > 0 && MatchingEngine.scoreRelevance(data.title, cleanQ) >= 30) {
              logDebug("Blinkit", `Retrieved relevant price from open Blinkit tab: ${data.title} at ₹${data.price}`, data);
              return this.formatResult(data, location, cleanQ);
            }
          } catch (e) {
            logDebug("Blinkit", `Blinkit tab (${t.id}) query error: ${e.message}`);
          }
        }
      } catch (e) {}
    }

    // 2. Automated Ephemeral Background Tab Extractor
    try {
      logDebug("Blinkit", `Attempting automated ephemeral background tab extraction for "${cleanQ}"`);
      const ephemeralData = await fetchViaEphemeralTab(targetUrl, cleanQ);
      if (ephemeralData && ephemeralData.price > 0) {
        logDebug("Blinkit", `Retrieved live price via ephemeral background tab: ${ephemeralData.title} at ₹${ephemeralData.price}`, ephemeralData);
        return this.formatResult(ephemeralData, location, cleanQ);
      }
    } catch (e) {
      logDebug("Blinkit", `Ephemeral tab extraction failed: ${e.message}`);
    }

    // 3. Fallback: Provide direct search link
    return this.formatResult({
      id: `blinkit_${Date.now()}`,
      title: cleanQ,
      brand: "Blinkit",
      quantity: "1 unit",
      mrp: 0,
      price: 0,
      image: "assets/icon48.png",
      productUrl: targetUrl
    }, location, cleanQ);
  }
}

// ==========================================
// 5. ORCHESTRATOR & SEARCH HANDLER
// ==========================================
const PROVIDERS = [
  new AmazonTezProvider(),
  new InstamartProvider(),
  new ZeptoProvider(),
  new BlinkitProvider()
];

async function handleSearchQuery(query, locationId = null) {
  if (!query || !query.trim()) return [];

  const activeLoc = await LocationService.getActiveLocation();
  let userSettings = activeLoc;

  if (locationId) {
    const profiles = await LocationService.getProfiles();
    const custom = profiles.find((p) => p.id === locationId);
    if (custom) userSettings = custom;
  }

  const startTime = Date.now();
  const cleanQuery = MatchingEngine.cleanSearchTerm(query);
  logDebug("Search", `Executing search for "${cleanQuery}" in ${userSettings.name} (Pincode: ${userSettings.pincode})`);

  const providerPromises = PROVIDERS.map((provider) =>
    provider.search(cleanQuery, userSettings).catch((err) => {
      logDebug("ProviderError", `${provider.platformId} failed: ${err.message}`);
      return provider.formatResult(null, userSettings);
    })
  );

  const rawResults = await Promise.all(providerPromises);
  const annotatedResults = MatchingEngine.annotateBestOffers(rawResults);
  const durationMs = Date.now() - startTime;

  logDebug("Search", `Completed search in ${durationMs}ms (${(durationMs / 1000).toFixed(2)}s). Available stores: ${annotatedResults.filter(r => r.isAvailable && r.priceBreakdown?.finalPayable > 0).length}`);
  return annotatedResults;
}

// ==========================================
// 6. MESSAGE LISTENERS
// ==========================================
if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const { action, payload } = message;

    if (action === "SEARCH_QUERY") {
      handleSearchQuery(payload.query, payload.locationId)
        .then((results) => sendResponse({ success: true, data: results }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;
    }

    if (action === "GET_ACTIVE_LOCATION") {
      LocationService.getActiveLocation()
        .then((loc) => sendResponse({ success: true, data: loc }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;
    }

    if (action === "SET_ACTIVE_LOCATION") {
      LocationService.setActiveProfile(payload.profileId)
        .then((loc) => sendResponse({ success: true, data: loc }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;
    }

    if (action === "GEOCODE_ADDRESS") {
      LocationService.saveCustomLocation(payload.name, payload.addressText)
        .then((profile) => sendResponse({ success: true, data: profile }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;
    }

    if (action === "DELETE_LOCATION_PROFILE") {
      LocationService.deleteProfile(payload.profileId)
        .then((res) => sendResponse({ success: true, data: res }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;
    }

    if (action === "STORE_PRICE_SYNC") {
      const { data } = payload || {};
      if (data && data.platformId && data.price > 0) {
        logDebug("Sync", `Received live store event from ${data.platformId}: "${data.title}" at ₹${data.price}`);
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false });
      }
      return true;
    }

    if (action === "GET_DEBUG_LOGS") {
      sendResponse({ success: true, logs: DEBUG_LOGS });
      return true;
    }

    if (action === "CLEAR_CACHE") {
      chrome.storage.local.clear(() => {
        DEBUG_LOGS.length = 0;
        sendResponse({ success: true });
      });
      return true;
    }

    if (action === "OPEN_SIDE_PANEL") {
      if (chrome.sidePanel && chrome.sidePanel.open) {
        chrome.windows.getCurrent((win) => {
          if (win && win.id) {
            chrome.sidePanel.open({ windowId: win.id });
          }
        });
      }
      sendResponse({ success: true });
      return true;
    }
  });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    DEFAULT_LOCATION,
    DEFAULT_PROFILES,
    LocationService,
    MatchingEngine,
    BaseProvider,
    AmazonTezProvider,
    InstamartProvider,
    ZeptoProvider,
    BlinkitProvider,
    PROVIDERS,
    handleSearchQuery,
    DEBUG_LOGS,
    logDebug
  };
}
