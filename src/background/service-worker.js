/**
 * LowP - Real-Time Price Comparator Service Worker (Manifest V3)
 * Focused on Amazon India, Swiggy Instamart, and Zepto
 */

// ==========================================
// 1. IN-MEMORY DEBUG TELEMETRY LOG
// ==========================================
const DEBUG_LOGS = [];
const MAX_DEBUG_LOGS = 100;

// User-controlled via Options → Developer → "Enable debug logging".
let DEBUG_ENABLED = true;
try {
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.sync) {
    chrome.storage.sync.get(["lowp_debug_enabled"], (res) => {
      if (res && res.lowp_debug_enabled === false) DEBUG_ENABLED = false;
    });
    if (chrome.storage.onChanged && chrome.storage.onChanged.addListener) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === "sync" && changes.lowp_debug_enabled) {
          DEBUG_ENABLED = changes.lowp_debug_enabled.newValue !== false;
        }
      });
    }
  }
} catch (e) {}

function logDebug(category, message, data = null) {
  if (!DEBUG_ENABLED) return;
  // Store the reference instead of deep-cloning: consumers serialize lazily,
  // and cloning multi-KB payloads on hot paths cost real milliseconds.
  const entry = {
    timestamp: new Date().toISOString(),
    category,
    message,
    data
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
          const cUnit = candQtyMatch[2].toLowerCase().replace(/litre|litres/, 'l').replace(/kgs?/, 'kg').replace(/gms?/, 'g');
          if (cNum !== qNum || cUnit !== qUnit) score -= 40;
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
        isLowestPrice: false,
        candidates: [],
        selectedIndex: 0
      };
    }

    // Providers use a zero-priced object when no live item was found so that
    // the user still gets a direct search link. It must not be reported as a
    // real in-stock result.
    const numericPrice = Number(item.price);
    const isAvailable = Number.isFinite(numericPrice) && numericPrice > 0;
    const candidateItems = Array.isArray(item.candidates) ? item.candidates : [];
    const normalizedCandidates = candidateItems
      .filter((candidate) => candidate && Number(candidate.price) > 0)
      .slice(0, 3)
      .map((candidate) => ({
        id: candidate.id || `${this.platformId}_${Date.now()}`,
        title: candidate.title || fallbackQuery,
        brand: candidate.brand || this.platformName,
        quantity: candidate.quantity || "1 unit",
        mrp: Number(candidate.mrp) > 0 ? candidate.mrp : candidate.price,
        price: Number(candidate.price),
        image: candidate.image || "assets/icon48.png",
        productUrl: candidate.productUrl || this.getSearchUrl(candidate.title || fallbackQuery),
      }));
    const selectedIndex = isAvailable
      ? Math.min(Math.max(Number.isInteger(item.selectedIndex) ? item.selectedIndex : 0, 0), Math.max(0, normalizedCandidates.length - 1))
      : 0;
    const priceBreakdown = MatchingEngine.calculateTotalCost(item);
    return {
      platformId: this.platformId,
      platformName: this.platformName,
      logoColor: this.logoColor,
      isAvailable,
      statusMessage: isAvailable ? "In Stock" : "Live price unavailable",
      item: isAvailable ? {
        id: item.id || `${this.platformId}_${Date.now()}`,
        title: item.title,
        brand: item.brand || this.platformName,
        quantity: item.quantity || "1 unit",
        mrp: item.mrp || item.price,
        price: item.price,
        image: item.image || "assets/icon48.png"
      } : null,
      priceBreakdown: isAvailable ? priceBreakdown : null,
      productUrl: item.productUrl || this.getSearchUrl(item.title || fallbackQuery),
      isLowestPrice: false,
      candidates: normalizedCandidates,
      selectedIndex
    };
  }

  getSearchUrl(query) {
    return "#";
  }
}

async function inPageExtract(searchQuery, waitMs, expectedUrlToken) {
  function titleKey(str) {
    return String(str || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  // Same physical product scraped twice (outer grid cell + inner card) must
  // not yield two candidates. Compare normalized titles at equal prices.
  function isDuplicateCandidate(list, item) {
    const key = titleKey(item.title);
    // Titles scraped from different ancestor depths differ by a glued pack
    // size ("Amul Taaza Milk" vs "Amul Taaza Milk500 ml"), so exact equality
    // is not enough: treat equal-priced containment as the same product.
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
    if (/^(fresh|plain)?\s*(toned|full cream|slim|cow|buffalo)?\s*milk( pouch)?$/.test(s)) return true;
    if (/^fresh \w+ pouch$/.test(s)) return true;

    const bannedPatterns = [
      /^(home|cart|search|login|help|offers|new|corporate|swiggy|zepto|amazon|menu|account|profile|orders|notifications)$/i,
      /^(delivery in\s*\d+\s*(?:mins?|minutes?)|\d+\s*(?:mins?|minutes?|hours?|sec|seconds?)|\d+\s*-\s*\d+\s*(?:mins?|minutes?))$/i,
      /^(fastest delivery|standard delivery|get it in|unlock free delivery|free delivery)$/i,
      /^(showing results for|results for|search results for)/i,
      /^(out of stock|sold out|unavailable|currently unavailable|add|added|buy|view|closed|loading|customise|in stock|add to cart|add item|qty|\+|\-)$/i,
      /^(trending|bestseller|offers?|save|flat|best price|discount|\d+%\s*off|save\s*₹?\d+|\d+\s*off|see all|view all|explore)$/i,
      /^(corporate|falcon|help & support|categories|see more|product image|cart icon|item image|image|photo|thumbnail|logo|banner|offer_icon|offer icon|coupon|promo)$/i,
      /^(item|product|unit|pack|pc|pcs|piece|pieces|kg|gm|g|l|ml)$/i,
      /^(shop for\b|unlock\b|\d+\s*(?:more|items?)\s*(?:to|for|worth)|items? worth)/i
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
      .replace(/^sponsored\s*/i, "")
      .replace(/^\s*\d+(?:\.\d+)?\s*%\s*off\s*/i, "")
      .replace(/(?:₹|Rs\.?|INR)\s*[0-9,]+(?:\.[0-9]+)?/gi, "")
      .replace(/\b(?:delivery in\s*)?\d+(?:\s*-\s*\d+)?\s*(?:mins?|minutes?|hours?|sec|seconds?)\b/gi, "")
      .replace(/\b(?:fastest delivery|standard delivery|instant delivery|express delivery|free delivery|delivery)\b/gi, "")
      .replace(/\b(?:mrp|add|buy|added|in stock|out of stock|off|\d+%\s*off|save)\b/gi, "")
      .replace(/\b(?:previously bought|earlier bought)\b/gi, "")
      // Stray UI glyph letters glued to the end ("... Cow MilkR" from an
      // R-badge text node). Only strip a lone capital appended to a word;
      // never touch mid-title letters ("Vitamin D" stays intact).
      .replace(/(?<=[a-z])[A-Z](?=\s|$)/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  // Self-contained relevance scorer (this function is serialized into the
  // target page, so service-worker globals are unavailable here).
  function scoreCandidate(itemTitle, query, packSize = '') {
    if (!itemTitle || !query || !query.trim()) return 0;
    const normalize = (s) => (s || "").toLowerCase()
      .replace(/['’`"]/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const fullText = normalize(`${itemTitle} ${packSize}`);
    const q = normalize(query);
    const tokens = q.split(/\s+/).filter(Boolean);
    let score = 0;
    tokens.forEach((token) => {
      if (fullText.includes(token)) score += 30;
      else if (token.endsWith('s') && token.length > 3 && fullText.includes(token.slice(0, -1))) score += 25;
      else if (!token.endsWith('s') && fullText.includes(token + 's')) score += 25;
    });
    if (tokens.length > 0 && fullText.includes(tokens[0])) score += 25;

    // Pack-size awareness: reward items matching an explicit unit request
    // ("milk 1l") and penalize clear mismatches (a 500 ml carton for "1l").
    const qtyMatch = query.match(/(\d+(?:\.\d+)?)\s*(l|litre|litres|kg|kgs|g|gm|gms|ml)\b/i);
    if (qtyMatch) {
      const qNum = parseFloat(qtyMatch[1]);
      const qUnit = qtyMatch[2].toLowerCase().replace(/^litres?$/, "l").replace(/^kgs?$/, "kg").replace(/^gms?$/, "g");
      const target = new RegExp(qNum + "\\s*" + qUnit + "\\b", "i");
      if (target.test(fullText)) score += 40;
      else {
        const candQty = fullText.match(/(\d+(?:\.\d+)?)\s*(l|kg|g|ml)\b/i);
        if (candQty && parseFloat(candQty[1]) !== qNum) score -= 40;
      }
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
      // Do not invent an MRP: a synthetic value produces a misleading
      // crossed-out price and discount badge.
      mrp = price;
    }

    const brand = platformId === "amazon_tez" ? "Amazon Now (Tez)" : (platformId === "instamart" ? "Swiggy Instamart" : (platformId === "zepto" ? "Zepto" : (platformId === "blinkit" ? "Blinkit" : (platformId === "google_shopping" ? "Google Shopping" : "Quick Store"))));

    return {
      title,
      price,
      // Sponsored placements must be visible to the ranker so it can
      // demote them behind organic results for the same query.
      sponsored: /(?:^|\s)sponsored(?:\s|$)/i.test(spacedCardText),
      mrp: Math.max(mrp, price),
      brand,
      quantity,
      image,
      productUrl: window.location.href,
      platformId
    };
  }

  // Read only text that is actually visible to the user. App bundles often
  // contain "no results" strings in <script> tags even while the page is
  // still hydrating, so those nodes must not trigger an empty-state exit.
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

  function hasVisibleEmptyState() {
    if (document.readyState !== "complete") return false;
    return /no results|couldn.t find|could not find|didn.t find|nothing here|did not match any|didn.t match|no matching|no items found|0 results|no products|nothing matched|unable to find|not available in/.test(visibleBodyText());
  }

  function runExtraction() {
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
              if (!isDuplicateCandidate(candidates, { title: cleanT, price })) {
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
            const pdpItem = {
              title,
              price,
              mrp: price,
              brand: platformId === "instamart" ? "Swiggy Instamart" : (platformId === "zepto" ? "Zepto" : "Amazon"),
              quantity: "1 unit",
              image: imgEl?.src || "assets/icon48.png",
              productUrl: window.location.href,
              platformId
            };
            return {
              success: true,
              data: pdpItem,
              candidates: [pdpItem],
            debug: {
              url: window.location.href,
              title: document.title,
              vis: document.visibilityState,
              ready: document.readyState,
              domNodes: document.getElementsByTagName ? document.getElementsByTagName("*").length : 0,
              cardsFound: 0,
              candidatesFound: 1,
              topCandidate: { title: pdpItem.title, price: pdpItem.price }
            }
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

    const allMatched = Array.from(document.querySelectorAll(cardSelectors.join(', ')));
    // Amazon wraps every product in BOTH an outer grid cell (sg-col / data-asin)
    // and an inner card container. Both match the broad selector list, so the
    // same product is scraped twice with wrapper-level junk text. Keep only
    // innermost matches: drop any card that contains another matched card.
    // Pairwise contains(): an outer wrapper "contains" its inner card, so
    // wrappers drop out. n^2 native checks beat walking every descendant.
    const cards = allMatched.filter((card, i) => {
      for (let j = 0; j < allMatched.length; j++) {
        if (j !== i && allMatched[j].contains(card)) return false;
      }
      return true;
    });
    let scannedCards = 0;
    for (const card of cards) {
      if (++scannedCards > 150) break;
      const item = extractFromCard(card, platformId);
      if (item && item.price > 0 && !isDuplicateCandidate(candidates, item)) {
        candidates.push(item);
        if (candidates.length >= 20) break;
      }
    }

    // 3. Proximity Fallback — the most expensive walk on the page. Skip it
    // entirely while the document is still a shell (no cards matched AND
    // still loading): scanning thousands of spans there is pure waste and
    // steals main-thread time from the hydration we are waiting for.
    if (candidates.length === 0) {
      const docReady = document.readyState === "complete";
      const gridHint = cards.length > 0;
      if (docReady || gridHint || platformId === "amazon_tez") {
        // Amazon Tez currently uses unstable product-card markup. Keep the
        // known-good full fallback there; the other stores use targeted nodes
        // to avoid a whole-document text walk.
        const allEls = platformId === "amazon_tez"
          ? document.querySelectorAll('*')
          : document.querySelectorAll('[data-testid*="price" i], [class*="price" i], [class*="amount" i], [class*="cost" i], span');
        let scanned = 0;
        for (const el of allEls) {
          if (++scanned > 600) break;
          const text = el.textContent || '';
          if (/(?:₹|Rs\.?|INR)\s*[0-9,]+/i.test(text) && text.length < 30) {
            let parent = el.parentElement;
            let depth = 0;
            while (parent && depth < 6 && parent !== document.body) {
              const item = extractFromCard(parent, platformId);
              if (item && item.price > 0 && !isDuplicateCandidate(candidates, item)) {
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

    // Blinkit's first rendered listing can be a search-header card whose title
    // is just the query while its container also exposes another item's price.
    // Drop that leading listing before ranking so the next displayed product is
    // used consistently for both the title and price.
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
        vis: document.visibilityState,
        ready: document.readyState,
        domNodes: document.getElementsByTagName ? document.getElementsByTagName("*").length : 0,
        cardsFound: cards.length,
        candidatesFound: 0,
        topCandidate: null
      }
    };
  }

  // Rank by query relevance so banners/sponsored fragments that happen to
  // sit near a price never outrank real matches for the searched term.
  const ranked = candidates.map((c) => Object.assign({}, c, {
    _score: scoreCandidate(c.title, searchQuery, c.quantity || "")
  }));
  ranked.sort((a, b) => b._score - a._score);
  const qualified = ranked.filter((c) => c._score >= 20);
  // No/blank query (popup auto-detect): preserve document order untouched.
  const pool = (searchQuery && searchQuery.trim() && qualified.length > 0) ? qualified : ranked;
  const best = pool[0] || candidates[0];

  return {
    success: true,
    data: best,
    candidates: pool.slice(0, 3),
    debug: {
      url: window.location.href,
      title: document.title,
      vis: document.visibilityState,
      ready: document.readyState,
      domNodes: document.getElementsByTagName ? document.getElementsByTagName("*").length : 0,
      cardsFound: cards.length,
      candidatesFound: candidates.length,
      topCandidate: best ? { title: best.title, price: best.price, score: best._score } : null,
      sampleCandidates: pool.slice(0, 3).map(c => ({ title: c.title, price: c.price, score: c._score }))
    }
  };
}

  // If the first synchronous pass finds nothing, keep re-running the
  // extraction as the page hydrates. MutationObserver reacts to real DOM
  // changes and is unaffected by background-tab timer throttling; the
  // trailing timeout covers mutation bursts suppressed by the rate limiter
  // and the hard deadline bounds the total wait.
  //
  // expectedUrlToken guards against scraping a previous query's page: when a
  // reused pool tab's navigation fails or is still mid-flight, relevance
  // scoring alone cannot reject stale results (e.g. "milk" items score highly
  // for "milk 1l"), so the current URL must contain the token.
  // Default budget is deliberately small: the ephemeral pipeline polls this
  // extractor every 500ms, so each pass should stay cheap and let the outer
  // loop provide the overall patience.
  const budget = Number.isFinite(waitMs) ? Math.max(0, Math.min(Number(waitMs), 15000)) : 1500;
  const startedAt = Date.now();
  const wantedToken = expectedUrlToken ? String(expectedUrlToken).toLowerCase() : null;
  const hrefMatches = () => !wantedToken || String(window.location.href || "").toLowerCase().includes(wantedToken);
  const isValidResult = (res) => !!res && res.success === true && hrefMatches();
  // Never let a deadline convert a URL-mismatched (stale page) success into a
  // usable result: downgrade it to an explicit failure instead.
  const toSafeResult = (res) => {
    if (isValidResult(res)) return res;
    const debug = Object.assign({}, (res && res.debug) || {}, {
      reason: res && res.success ? "stale_page_url" : ((res && res.debug && res.debug.reason) || "no_match")
    });
    return { success: false, data: null, candidates: [], debug };
  };
  const withEmptyStateReason = (res, attempts) => ({
    ...(res || { success: false, data: null, candidates: [] }),
    success: false,
    data: null,
    candidates: [],
    debug: Object.assign({}, (res && res.debug) || {}, {
      reason: "empty_state",
      attempts
    })
  });

  let result = runExtraction();
  // Most Chrome calls use waitMs=0 because the outer search loop handles
  // hydration polling. A fully loaded page with a visible empty-state
  // message is definitive, so stop that outer loop on the first pass.
  if (!result.success && hasVisibleEmptyState()) {
    return withEmptyStateReason(result, 1);
  }
  if (typeof MutationObserver === "undefined" || !document.body) {
    return toSafeResult(result);
  }

  // Early-hydration fragments (banners, sponsored blocks) can look extractable
  // before the real product grid renders. Require the candidate set to stop
  // changing for a short settle window before accepting, and always prefer
  // the latest differing pass (later = more hydrated).
  //
  // Strong results skip most of that wait: a confident top score combined
  // with a grid-sized candidate count only occurs once the real listing has
  // rendered, whereas banner transients yield only a handful of candidates.
  let bestResult = null;
  let lastSignature = null;
  let lastChangeAt = startedAt;
  const signatureOf = (res) => {
    const list = (res && res.candidates) || [];
    return list.slice(0, 3).map((c) => `${c.title}@${c.price}`).join("|") + "#" + ((res && res.debug && res.debug.candidatesFound) || 0);
  };
  const settleFor = (res) => {
    const found = (res && res.debug && res.debug.candidatesFound) || 0;
    const topScore = (res && res.data && res.data._score) || 0;
    return (topScore >= 60 && found >= 5) ? 100 : 500;
  };
  if (isValidResult(result)) {
    bestResult = result;
    lastSignature = signatureOf(result);
    lastChangeAt = Date.now();
  }

  return await new Promise((resolve) => {
    let settled = false;
    let attempts = 1;
    let lastAttempt = 0;
    let trailingScheduled = false;
    let deadlineTimer = null;

    const finishWith = (res) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadlineTimer);
      try { observer.disconnect(); } catch (e) {}
      resolve(toSafeResult(res));
    };

    const attempt = () => {
      if (settled) return;
      const now = Date.now();
      if (now - lastAttempt < 200) {
        if (!trailingScheduled) {
          trailingScheduled = true;
          setTimeout(() => { trailingScheduled = false; attempt(); }, 220);
        }
        return;
      }
      lastAttempt = now;
      const res = runExtraction();
      attempts++;
      if (!res.success && attempts >= 4 && hasVisibleEmptyState()) {
        finishWith(withEmptyStateReason(res, attempts));
        return;
      }
      if (isValidResult(res)) {
        const signature = signatureOf(res);
        if (signature !== lastSignature) {
          lastSignature = signature;
          lastChangeAt = now;
          bestResult = res;
        }
      }
      const expired = Date.now() - startedAt >= budget;
      const stable = !!bestResult && (Date.now() - lastChangeAt >= settleFor(bestResult));
      if (expired || stable) finishWith(bestResult);
    };

    const observer = new MutationObserver(attempt);

    observer.observe(document.body, { childList: true, subtree: true });
    deadlineTimer = setTimeout(() => finishWith(runExtraction()), Math.max(0, startedAt + budget - Date.now()));
  });
}

// waitMs bounds how long the in-page extractor keeps waiting for product
// markup to render (see inPageExtract). Open-tab reuse passes 0 because those
// pages have already had their full session to hydrate; fresh navigations pass
// their remaining navigation budget. expectedUrlToken (optional) makes the
// extractor reject results whose page URL predates the current query.
async function extractDataFromTab(tabId, cleanQ, waitMs = 0, expectedUrlToken = null) {
  const { data } = await extractDataFromTabDetailed(tabId, cleanQ, waitMs, expectedUrlToken);
  return data;
}

// Same as extractDataFromTab but also surfaces the in-page debug snapshot
// (visibilityState/readyState), which the visibility self-healing uses.
async function extractDataFromTabDetailed(tabId, cleanQ, waitMs = 0, expectedUrlToken = null) {
  let data = null;
  let debugInfo = null;
  let injectionFailed = false;

  // Run the direct extractor first, as in the known-good 8b34689 baseline.
  if (typeof chrome !== "undefined" && chrome.scripting && chrome.scripting.executeScript) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: inPageExtract,
        args: [cleanQ, waitMs, expectedUrlToken]
      });
      const res = results && results[0] ? results[0].result : null;
      if (res) {
        data = res.data || (res.price ? res : null);
        if (data && Array.isArray(res.candidates)) {
          data.candidates = res.candidates.slice(0, 3).map((candidate) => {
            const { candidates: _nestedCandidates, ...candidateCopy } = candidate || {};
            return candidateCopy;
          });
        }
        debugInfo = res.debug || null;
      }
    } catch (e) {
      injectionFailed = true;
      logDebug("TabExtract", `Direct tab execution error on ${tabId}: ${e.message}`);
    }
  }

  // The content-script fallback re-runs the full extraction walk. Only pay
  // that cost when direct injection actually failed — an empty result from a
  // successful injection already walked the same DOM and will be retried by
  // the caller's polling loop anyway.
  if ((!data || !data.price) && injectionFailed) {
    try {
      const res = await chrome.tabs.sendMessage(tabId, { action: "GET_PAGE_PRODUCT_DATA", query: cleanQ, waitMs: Math.min(800, waitMs), expectedUrlToken });
      if (res && res.data && res.data.price > 0) {
        data = res.data;
        if (Array.isArray(res.candidates)) {
          data.candidates = res.candidates.slice(0, 3).map((candidate) => ({ ...candidate }));
        }
      }
      if (res && res.reason) {
        debugInfo = Object.assign({}, debugInfo || {}, { reason: res.reason });
      }
    } catch (e) {}
  }

  if (debugInfo) {
    logDebug("TabExtract", `Tab ${tabId} Diagnosed: URL="${debugInfo.url}", Title="${debugInfo.title}", Nodes=${debugInfo.domNodes}, Vis=${debugInfo.vis}, Cards=${debugInfo.cardsFound}, Candidates=${debugInfo.candidatesFound}, Top=${JSON.stringify(debugInfo.topCandidate)}`, debugInfo);
  }

  if (data && data.price > 0) {
    logDebug("TabExtract", `Tab ${tabId} successfully extracted: "${data.title}" at ₹${data.price}`, data);
    return { data, debug: debugInfo };
  } else {
    logDebug("TabExtract", `Tab ${tabId} returned no matching product for "${cleanQ}"`);
    return { data: null, debug: debugInfo };
  }
}

function withTimeout(promise, timeoutMs, label = "operation") {
  let timerId;
  const timeout = new Promise((_, reject) => {
    timerId = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timerId));
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 5000) {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timerId = setTimeout(() => controller?.abort(), timeoutMs);
  try {
    return await fetch(url, controller ? { ...options, signal: controller.signal } : options);
  } finally {
    clearTimeout(timerId);
  }
}

// Resolves with the first promise that produces a truthy value; resolves null
// only when every input has settled without producing one.
function firstPositive(promises) {
  return new Promise((resolve) => {
    let remaining = promises.length;
    let done = false;
    promises.forEach((p) => {
      Promise.resolve(p).then((value) => {
        if (done) return;
        if (value) { done = true; resolve(value); return; }
        if (--remaining === 0) { done = true; resolve(null); }
      }).catch(() => {
        if (!done && --remaining === 0) { done = true; resolve(null); }
      });
    });
  });
}

// ==========================================
// 4b. WARM BACKGROUND TAB POOL (DORMANT)
// The reuse experiment fought Chrome's renderer lifecycle (minimized,
// off-screen, and sliver placements each hit a different freezing or
// geometry restriction). It is no longer called by the search pipeline;
// retained only so existing registries can be garbage-collected.
// ==========================================
const POOL_IDLE_CLOSE_MS = 60000;
const POOL_REGISTRY_KEY = "lowp_tab_pool_registry";
const POOL_GC_ALARM = "lowp_tabpool_gc";

const WarmTabPool = {
  entries: new Map(),
  hydrated: false,

  platformMatches(platformId, url) {
    if (!url || !platformId) return false;
    const u = url.toLowerCase();
    if (platformId === "amazon_tez") return u.includes("amazon.in");
    if (platformId === "instamart") return u.includes("swiggy.com");
    if (platformId === "zepto") return u.includes("zepto.com") || u.includes("zeptonow.com");
    if (platformId === "blinkit") return u.includes("blinkit.com");
    return false;
  },

  detectPlatformId(url) {
    for (const id of ["amazon_tez", "instamart", "zepto", "blinkit"]) {
      if (this.platformMatches(id, url)) return id;
    }
    return null;
  },

  async managedTabIdSet() {
    await this.hydrate();
    const ids = new Set();
    this.entries.forEach((entry) => ids.add(entry.tabId));
    return ids;
  },

  async _persist() {
    try {
      if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.session) return;
      const plain = {};
      this.entries.forEach((value, key) => { plain[key] = value; });
      chrome.storage.session.set({ [POOL_REGISTRY_KEY]: plain }, () => {});
    } catch (e) {}
  },

  // After a service-worker restart the in-memory map is empty; re-adopt pool
  // windows from the persisted registry after verifying they still exist.
  async hydrate() {
    if (this.hydrated) return;
    this.hydrated = true;
    try {
      if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.session) return;
      const res = await new Promise((resolve) => chrome.storage.session.get([POOL_REGISTRY_KEY], resolve));
      const saved = res && res[POOL_REGISTRY_KEY];
      if (saved && typeof saved === "object") {
        for (const platformId of Object.keys(saved)) {
          if (this.entries.has(platformId)) continue;
          const entry = saved[platformId];
          let alive = false;
          try {
            const tab = await chrome.tabs.get(entry.tabId);
            alive = !!tab && !tab.discarded && this.platformMatches(platformId, tab.url || tab.pendingUrl);
          } catch (e) { alive = false; }
          if (alive) this.entries.set(platformId, entry);
        }
        await this._persist();
      }
    } catch (e) {}
  },

  async acquire(platformId, url) {
    if (typeof chrome === "undefined" || !chrome.tabs) return null;
    await this.hydrate();

    const canCreateWindows = !!(typeof chrome !== "undefined" && chrome.windows && chrome.windows.create);
    const existing = this.entries.get(platformId);
    if (existing) {
      try {
        const tab = await chrome.tabs.get(existing.tabId);
        // Tab-only entries come from the degraded fallback path; upgrade them
        // to a real window when possible because hidden background tabs keep
        // document.visibilityState "hidden", which stalls client-side-
        // rendered stores (Swiggy, Zepto) indefinitely.
        if (tab && !tab.discarded && (existing.windowId || !canCreateWindows)) {
          existing.lastUsedAt = Date.now();
          await this._persist();
          // Heal windows stuck in a frozen minimized/off-screen state. Note:
          // `state` cannot be combined with bounds in one update call.
          if (existing.windowId && chrome.windows && chrome.windows.update) {
            try {
              await chrome.windows.update(existing.windowId, { state: "normal", focused: false });
              await chrome.windows.update(existing.windowId, { left: -350, top: 60, width: 420, height: 700 });
            } catch (e) {}
          }
          await chrome.tabs.update(existing.tabId, { url });
          return { tabId: existing.tabId, reused: true, winId: existing.windowId };
        }
      } catch (e) {}
      await this.evict(platformId);
    }

    let winId = null;
    let tabId = null;
    if (canCreateWindows) {
      // Chrome's occlusion tracker treats FULLY off-screen and minimized
      // windows as hidden (visibilityState "hidden"), which stalls client-
      // side hydration. A window with a thin sliver on the primary display's
      // left edge is never occluded, so its renderer stays live, yet it is
      // effectively invisible. Bounds cannot be reliably combined with a
      // `state` value across Chrome builds, so `state` is omitted.
      const strategies = [
        { url, type: "popup", focused: false, left: -350, top: 60, width: 420, height: 700 },
        { url, type: "popup", focused: false, width: 420, height: 700 },
        { url, type: "popup", focused: false }
      ];
      for (const createData of strategies) {
        try {
          const win = await chrome.windows.create(createData);
          winId = win.id;
          tabId = win.tabs && win.tabs[0] ? win.tabs[0].id : null;
          // Chrome does not guarantee that windows.create returns populated
          // tabs. Resolve the newly-created tab by windowId before giving up,
          // allowing a short propagation delay in the tabs API.
          if (!tabId && winId && chrome.tabs.query) {
            const deadline = Date.now() + 1000;
            while (!tabId && Date.now() < deadline) {
              const tabs = await chrome.tabs.query({ windowId: winId });
              tabId = tabs && tabs[0] ? tabs[0].id : null;
              if (!tabId) await new Promise((r) => setTimeout(r, 100));
            }
          }
          if (tabId) break;
          logDebug("TabPool", `Window ${winId} produced no usable tab`);
          try { await chrome.windows.remove(winId); } catch (e) {}
          winId = null;
        } catch (winErr) {
          logDebug("TabPool", `Window create strategy failed: ${winErr.message}`);
          winId = null;
          tabId = null;
        }
      }
    }
    if (!tabId) {
      // Degraded fallback: hidden background tabs work only for server-
      // rendered stores; they are replaced by a real window on next acquire.
      try {
        const tab = await chrome.tabs.create({ url, active: false });
        tabId = tab.id;
        logDebug("TabPool", `Degraded to hidden background tab for ${platformId}`);
      } catch (e) { return null; }
    }
    if (!tabId) return null;

    this.entries.set(platformId, { windowId: winId, tabId, lastUsedAt: Date.now() });
    await this._persist();
    this.ensureGc();
    return { tabId, reused: false, winId };
  },

  touch(platformId) {
    const entry = this.entries.get(platformId);
    if (entry) {
      entry.lastUsedAt = Date.now();
      this._persist();
    }
  },

  async evict(platformId) {
    const entry = this.entries.get(platformId);
    if (!entry) return;
    this.entries.delete(platformId);
    await this._persist();
    try {
      if (entry.windowId && typeof chrome !== "undefined" && chrome.windows && chrome.windows.remove) {
        await chrome.windows.remove(entry.windowId);
      } else if (typeof chrome !== "undefined" && chrome.tabs && chrome.tabs.remove) {
        await chrome.tabs.remove(entry.tabId);
      }
    } catch (e) {}
  },

  async closeIdle(now = Date.now()) {
    // The GC alarm can wake a freshly restarted service worker whose
    // in-memory map is empty; re-adopt live windows from the persisted
    // registry before deciding what to close.
    await this.hydrate();
    for (const platformId of Array.from(this.entries.keys())) {
      const entry = this.entries.get(platformId);
      if (entry && now - entry.lastUsedAt > POOL_IDLE_CLOSE_MS) {
        await this.evict(platformId);
      }
    }
  },

  ensureGc() {
    try {
      if (typeof chrome === "undefined" || !chrome.alarms) return;
      chrome.alarms.create(POOL_GC_ALARM, { periodInMinutes: 1 });
    } catch (e) {}
  },

  async handleRemovedTab(tabId) {
    for (const platformId of Array.from(this.entries.keys())) {
      const entry = this.entries.get(platformId);
      if (entry && entry.tabId === tabId) {
        this.entries.delete(platformId);
        await this._persist();
      }
    }
  }
};

// After re-navigating a pooled tab, extraction must not run against the
// previous query's DOM. Cheap tabs.get polling (no DOM walk) waits for the
// new URL to commit and reach 'complete'; on timeout the caller proceeds and
// relevance scoring naturally rejects stale-page matches.
async function waitForPooledTabNavigation(tabId, expectedUrl, budgetMs) {
  const deadline = Date.now() + Math.max(0, Math.min(budgetMs, 4500));
  const wanted = (() => { try { return decodeURIComponent(expectedUrl); } catch (e) { return expectedUrl; } })();
  while (Date.now() < deadline) {
    let tab = null;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch (e) {
      return false;
    }
    const current = tab ? (tab.url || tab.pendingUrl || "") : "";
    const decoded = (() => { try { return decodeURIComponent(current); } catch (e) { return current; } })();
    if (decoded === wanted && tab.status === "complete") return true;
    await new Promise((r) => setTimeout(r, 80));
  }
  return false;
}

// Ephemeral extraction strategy, restored verbatim from the known-good
// 19789fb baseline: a fresh minimized window per store query plus patient
// 500ms polling. A brand-new renderer hydrates reliably for all four stores,
// and repeated polling gives slow client-side SPAs all the time they need.
// Serial numbers for ephemeral scraper windows so concurrent opens do not
// share one position (see the stagger comment inside fetchViaEphemeralTab).
let ephemeralWindowSeq = 0;

// 15s: cold SPA loads (notably Blinkit after an extension reload wipes the
// warm tab pool) regularly exceed the previous 8s budget before rendering
// their product grid, even though warm loads land in 3-4s.
async function fetchViaEphemeralTab(url, cleanQ, timeoutMs = 15000) {
  if (typeof chrome === "undefined" || (!chrome.tabs && !chrome.windows)) {
    return null;
  }
  let winId = null;
  let tabId = null;
  try {
    logDebug("EphemeralTab", `Opening background window for ${url}`);

    // Create a detached window so the extension popup never loses focus.
    // It must NOT be minimized: minimized (or fully occluded) windows report
    // visibilityState "hidden", and several store SPAs (Zepto, Blinkit) refuse
    // to render their product grid while hidden, yielding empty extractions.
    // A small unfocused window stays "visible"; we then hand focus straight
    // back to the user's previous window so the scraper sits BEHIND it.
    if (chrome.windows && chrome.windows.create) {
      try {
        const prevWindowId = await new Promise((res) => {
          try { chrome.windows.getLastFocused((w) => res(w ? w.id : null)); } catch (e) { res(null); }
        });
        // Stagger concurrent scraper windows: identical positions stack them
        // perfectly, and a fully-covered window reports visibilityState
        // "hidden" on Windows, which stops SPA rendering (Zepto/Blinkit).
        const seq = ephemeralWindowSeq++;
        const win = await chrome.windows.create({
          url,
          type: "popup",
          focused: false,
          width: 480,
          height: 640,
          top: 60 + (seq % 4) * 110,
          left: 60 + (seq % 4) * 170
        });
        // Push the scraper behind the user's active window again.
        if (prevWindowId && win && win.id !== prevWindowId) {
          try { chrome.windows.update(prevWindowId, { focused: true }); } catch (e) {}
        }
        winId = win.id;
        tabId = win.tabs && win.tabs[0] ? win.tabs[0].id : null;
        // Chrome does not guarantee that windows.create returns populated
        // tabs. Resolve the newly-created tab by windowId before giving up,
        // allowing a short propagation delay in the tabs API.
        if (!tabId && winId && chrome.tabs.query) {
          const tabLookupDeadline = Date.now() + 1000;
          while (!tabId && Date.now() < tabLookupDeadline) {
            const tabs = await chrome.tabs.query({ windowId: winId });
            tabId = tabs && tabs[0] ? tabs[0].id : null;
            if (!tabId) await new Promise((resolve) => setTimeout(resolve, 100));
          }
        }
      } catch (winErr) {
        // Fallback to tab creation if window creation fails
        try {
          const tab = await chrome.tabs.create({ url, active: false });
          tabId = tab.id;
        } catch (e) { return null; }
      }
    } else if (chrome.tabs.create) {
      try {
        const tab = await chrome.tabs.create({ url, active: false });
        tabId = tab.id;
      } catch (e) { return null; }
    }

    if (!tabId) return null;

    // Poll every 250ms up to timeout (returns immediately once data is ready).
    // Each pass is a short single-pass extraction; the in-page MutationObserver
    // wait is capped low so passes stay cheap and responsive.
    const startTime = Date.now();
    let data = null;
    while (Date.now() - startTime < timeoutMs) {
      const extracted = await extractDataFromTabDetailed(tabId, cleanQ);
      data = extracted.data;
      if (data && data.price > 0) {
        logDebug("EphemeralTab", `Successfully extracted data from ${url} in ${Date.now() - startTime}ms: "${data.title}" at ₹${data.price}`, data);
        break;
      }
      if (extracted.debug && extracted.debug.reason === "empty_state") {
        logDebug("EphemeralTab", `No visible results for "${cleanQ}" after ${Date.now() - startTime}ms`);
        break;
      }
      await new Promise((r) => setTimeout(r, 250));
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

// Warm DNS/TLS connections to every store origin so the first real navigation
// skips connection setup. Fire-and-forget; failures are irrelevant here.
const PREWARM_ORIGINS = [
  "https://www.amazon.in/",
  "https://www.swiggy.com/",
  "https://www.zepto.com/",
  "https://blinkit.com/"
];

function preWarmConnections() {
  if (typeof fetch !== "function") return;
  PREWARM_ORIGINS.forEach((origin) => {
    fetchWithTimeout(origin, { mode: "no-cors", cache: "no-store" }, 2500).catch(() => {});
  });
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
        // Pool-managed tabs hold the PREVIOUS query's page; their URLs can
        // partially match a new query (e.g. "milk" tab vs "milk 1l" search),
        // so they must never be treated as user-opened result tabs here.
        const poolTabIds = await WarmTabPool.managedTabIdSet();
        // Preserve the known-good Tez-only tab routing from 8b34689. Broadly
        // scanning unrelated Amazon tabs can select a non-Now result page.
        const tezTabs = allTabs.filter(t => !poolTabIds.has(t.id) && t.url && t.url.includes("amazon.in") && (t.url.includes("/tez/") || t.url.includes("searchKeyword")) && isOpenTabMatchingQuery(t.url, cleanQ));
        logDebug("AmazonTez", `Found ${tezTabs.length} open matching Amazon Tez tab(s)`);

        for (const t of tezTabs) {
          try {
            logDebug("AmazonTez", `Querying open Amazon Tez tab (${t.id}): ${t.url}`);
            const data = await extractDataFromTab(t.id, cleanQ);
            if (data && data.price > 0) {
              logDebug("AmazonTez", `Retrieved first price from open Amazon Tez tab: ${data.title} at ₹${data.price}`, data);
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
        const poolTabIds = await WarmTabPool.managedTabIdSet();
        const swiggyTabs = allTabs.filter(t => !poolTabIds.has(t.id) && t.url && t.url.includes("swiggy.com") && isOpenTabMatchingQuery(t.url, cleanQ));
        logDebug("Instamart", `Found ${swiggyTabs.length} open matching Swiggy tab(s)`);

        for (const t of swiggyTabs) {
          try {
            logDebug("Instamart", `Querying open Swiggy tab (${t.id}): ${t.url}`);
            const data = await extractDataFromTab(t.id, cleanQ);
            if (data && data.price > 0) {
              logDebug("Instamart", `Retrieved first price from open Swiggy tab: ${data.title} at ₹${data.price}`, data);
              return this.formatResult(data, location, cleanQ);
            }
          } catch (e) {
            logDebug("Instamart", `Swiggy tab (${t.id}) query error: ${e.message}`);
          }
        }
      } catch (e) {}
    }

    // 3+4. Run the direct background HTML scrape and the pooled background
    // tab extraction concurrently; the first live result wins instead of
    // paying for both sequentially.
    const scrapeViaHtml = async () => {
      try {
        const searchRes = await fetchWithTimeout(targetUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
          }
        }, 5000);
        if (!searchRes.ok) return null;
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
            const mrp = mrpMatch ? parseFloat(mrpMatch[1]) : price;
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
              });
            }
          }
        }

        if (candidates.length > 0) {
          // Do not put the ranked array on `best` by reference: that would
          // make the first candidate self-referential and break telemetry
          // JSON serialization.
          const best = candidates[0];
          best.candidates = candidates.slice(0, 3).map((candidate) => ({ ...candidate }));
          logDebug("Instamart", `Retrieved best Swiggy match via background scrape: "${best.title}" at ₹${best.price}`, best);
          return this.formatResult(best, location, cleanQ);
        }
        return null;
      } catch (err) {
        logDebug("Instamart", `Swiggy background fetch error: ${err.message}`);
        return null;
      }
    };

    const scrapeViaTab = async () => {
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
      return null;
    };

    const winner = await firstPositive([scrapeViaHtml(), scrapeViaTab()]);
    if (winner) return winner;

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
        const poolTabIds = await WarmTabPool.managedTabIdSet();
        const zeptoTabs = allTabs.filter(t => !poolTabIds.has(t.id) && t.url && (t.url.includes("zepto.com") || t.url.includes("zeptonow.com")) && isOpenTabMatchingQuery(t.url, cleanQ));
        logDebug("Zepto", `Found ${zeptoTabs.length} open matching Zepto tab(s)`);

        for (const t of zeptoTabs) {
          try {
            logDebug("Zepto", `Querying open Zepto tab (${t.id}): ${t.url}`);
            const data = await extractDataFromTab(t.id, cleanQ);
            if (data && data.price > 0) {
              logDebug("Zepto", `Retrieved first price from open Zepto tab: ${data.title} at ₹${data.price}`, data);
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
        const poolTabIds = await WarmTabPool.managedTabIdSet();
        const blinkitTabs = allTabs.filter(t => !poolTabIds.has(t.id) && t.url && t.url.includes("blinkit.com") && isOpenTabMatchingQuery(t.url, cleanQ));
        logDebug("Blinkit", `Found ${blinkitTabs.length} open matching Blinkit tab(s)`);

        for (const t of blinkitTabs) {
          try {
            logDebug("Blinkit", `Querying open Blinkit tab (${t.id}): ${t.url}`);
            const data = await extractDataFromTab(t.id, cleanQ);
            if (data && data.price > 0) {
              logDebug("Blinkit", `Retrieved first price from open Blinkit tab: ${data.title} at ₹${data.price}`, data);
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
const PROVIDER_TIMEOUT_MS = 16000;
const SEARCH_TIMEOUT_MS = 18000;

// ==========================================
// 5b. SHORT-TTL SEARCH RESULT CACHE
// Repeat searches for the same item within TTL return instantly. Prices are
// effectively stable minute-to-minute, so a short window carries near-zero
// staleness risk while eliminating the full scrape cost.
// ==========================================
const SEARCH_CACHE_KEY = "lowp_search_cache_v1";
class SearchCache {
  static TTL_MS = 90000;
  static MAX_ENTRIES = 30;

  // In-memory map is the fast path; chrome.storage.session mirrors it so
  // entries survive service-worker restarts.
  static memory = null;
  static hydration = null;

  static makeKey(pincode, query) {
    return `${pincode || "unknown"}|${String(query || "").toLowerCase().trim()}`;
  }

  static async hydrate() {
    if (this.memory) return this.memory;
    if (!this.hydration) {
      this.hydration = (async () => {
        const map = new Map();
        try {
          if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.session) {
            const res = await new Promise((resolve) => chrome.storage.session.get([SEARCH_CACHE_KEY], resolve));
            const saved = res && res[SEARCH_CACHE_KEY];
            if (saved && typeof saved === "object") {
              Object.keys(saved).forEach((key) => map.set(key, saved[key]));
            }
          }
        } catch (e) {}
        return map;
      })();
    }
    this.memory = await this.hydration;
    return this.memory;
  }

  static persist() {
    try {
      if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.session || !this.memory) return;
      const plain = {};
      this.memory.forEach((value, key) => { plain[key] = value; });
      chrome.storage.session.set({ [SEARCH_CACHE_KEY]: plain }, () => {});
    } catch (e) {}
  }

  static prune(map, now = Date.now()) {
    for (const [key, entry] of Array.from(map)) {
      if (!entry || typeof entry.ts !== "number" || now - entry.ts >= this.TTL_MS) {
        map.delete(key);
      }
    }
    if (map.size > this.MAX_ENTRIES) {
      const oldest = Array.from(map.entries()).sort((a, b) => a[1].ts - b[1].ts);
      while (map.size > this.MAX_ENTRIES) {
        const [key] = oldest.shift();
        if (map.has(key)) map.delete(key);
      }
    }
  }

  static async get(pincode, query, now = Date.now()) {
    const map = await this.hydrate();
    const key = this.makeKey(pincode, query);
    const entry = map.get(key);
    if (!entry) return null;
    if (now - entry.ts >= this.TTL_MS) {
      map.delete(key);
      this.persist();
      return null;
    }
    return entry;
  }

  static async set(pincode, query, results, now = Date.now()) {
    const map = await this.hydrate();
    map.set(this.makeKey(pincode, query), { ts: now, results });
    this.prune(map, now);
    this.persist();
    return true;
  }

  static resetForTests() {
    this.memory = null;
    this.hydration = null;
  }
}

async function resolveSearchContext(query, locationId = null) {
  const activeLoc = await LocationService.getActiveLocation();
  let userSettings = activeLoc;
  if (locationId) {
    const profiles = await LocationService.getProfiles();
    const custom = profiles.find((p) => p.id === locationId);
    if (custom) userSettings = custom;
  }
  return { userSettings, cleanQuery: MatchingEngine.cleanSearchTerm(query) };
}

// Runs every provider in parallel and reports each result through onResult as
// soon as it settles, so callers can render progressively instead of waiting
// for the slowest store. Resolves with the fully annotated result array.
async function streamSearchResults(query, locationId = null, onResult = () => {}) {
  if (!query || !query.trim()) return [];

  const emit = (store) => {
    try { onResult(store); } catch (e) {}
  };

  const { userSettings, cleanQuery } = await resolveSearchContext(query, locationId);
  const startTime = Date.now();
  logDebug("Search", `Executing search for "${cleanQuery}" in ${userSettings.name} (Pincode: ${userSettings.pincode})`);

  // Cache identity is the RAW search term exactly as typed (only case and
  // surrounding whitespace normalized). It must never be derived from
  // cleanSearchTerm output or scored/fuzzed: "milk" and "milk 1l" are
  // different searches and must never share an entry.
  const cacheTerm = String(query || "").toLowerCase().trim();

  const cached = await SearchCache.get(userSettings.pincode, cacheTerm);
  if (cached) {
    logDebug("Search", `Cache hit for "${cleanQuery}" (age ${Date.now() - cached.ts}ms)`);
    const cachedResults = cached.results.map((result) => ({ ...result, cachedAt: cached.ts }));
    cachedResults.forEach(emit);
    return cachedResults;
  }

  const unavailableResult = (provider, reason) => {
    if (reason) logDebug("ProviderTimeout", `${provider.platformId} ${reason}`);
    return provider.formatResult(null, userSettings, cleanQuery);
  };

  const collected = [];
  const hasResultFor = (platformId) => collected.some((r) => r.platformId === platformId);

  const providerPromises = PROVIDERS.map((provider) =>
    withTimeout(
      Promise.resolve().then(() => provider.search(cleanQuery, userSettings)),
      PROVIDER_TIMEOUT_MS,
      `${provider.platformId} provider`
    ).catch((err) => {
      logDebug("ProviderError", `${provider.platformId} failed: ${err.message}`);
      return unavailableResult(provider, err.message.includes("timed out") ? "timed out" : null);
    }).then((result) => {
      if (!hasResultFor(result.platformId)) {
        // Per-store settle time (like mobile's responseTimeMs): how long this
        // store took from query start until its result was ready.
        result.durationMs = Date.now() - startTime;
        collected.push(result);
        emit(result);
      }
    })
  );

  let globalTimer;
  const globalTimeout = new Promise((resolve) => {
    globalTimer = setTimeout(() => {
      logDebug("Search", `Global search timeout reached after ${SEARCH_TIMEOUT_MS}ms`);
      PROVIDERS.forEach((provider) => {
        if (!hasResultFor(provider.platformId)) {
          const fill = unavailableResult(provider, "cancelled by global timeout");
          collected.push(fill);
          emit(fill);
        }
      });
      resolve(null);
    }, SEARCH_TIMEOUT_MS);
  });
  await Promise.race([Promise.all(providerPromises), globalTimeout]);
  clearTimeout(globalTimer);

  const annotatedResults = MatchingEngine.annotateBestOffers(collected);
  annotatedResults.sort((a, b) =>
    PROVIDERS.findIndex((p) => p.platformId === a.platformId) -
    PROVIDERS.findIndex((p) => p.platformId === b.platformId)
  );
  await SearchCache.set(userSettings.pincode, cacheTerm, annotatedResults);
  const durationMs = Date.now() - startTime;

  logDebug("Search", `Completed search in ${durationMs}ms (${(durationMs / 1000).toFixed(2)}s). Available stores: ${annotatedResults.filter(r => r.isAvailable && r.priceBreakdown?.finalPayable > 0).length}`);
  return annotatedResults;
}

async function handleSearchQuery(query, locationId = null) {
  return streamSearchResults(query, locationId);
}

// ==========================================
// 6. MESSAGE LISTENERS
// ==========================================
function configureSidePanelAction() {
  if (typeof chrome === "undefined" || !chrome.sidePanel?.setPanelBehavior) return;
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => logDebug("SidePanel", `Could not enable action click: ${err.message}`));
}

configureSidePanelAction();
if (typeof chrome !== "undefined" && chrome.runtime?.onInstalled) {
  chrome.runtime.onInstalled.addListener(configureSidePanelAction);
}

if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const { action, payload } = message;

    if (action === "SEARCH_QUERY") {
      preWarmConnections();
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

    if (action === "CLEAR_DEBUG_LOGS") {
      DEBUG_LOGS.length = 0;
      sendResponse({ success: true });
      return true;
    }

  });
}

// Progressive search streaming: the panel connects once per search and
// receives each provider result as it settles, then a final DONE marker.
if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onConnect) {
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== "search-stream") return;
    preWarmConnections();

    port.onMessage.addListener((message) => {
      if (!message || message.action !== "SEARCH_QUERY_STREAM") return;
      const payload = message.payload || {};
      const startedAt = Date.now();
      streamSearchResults(payload.query, payload.locationId, (store) => {
        try { port.postMessage({ type: "RESULT", store }); } catch (e) {}
      })
        .then((results) => {
          try {
            port.postMessage({ type: "DONE", durationMs: Date.now() - startedAt, count: results.length });
          } catch (e) {}
        })
        .catch((err) => {
          try { port.postMessage({ type: "ERROR", error: err.message }); } catch (e) {}
        });
    });
  });
}

// Warm tab pool housekeeping.
if (typeof chrome !== "undefined" && chrome.tabs && chrome.tabs.onRemoved) {
  chrome.tabs.onRemoved.addListener((tabId) => {
    WarmTabPool.handleRemovedTab(tabId);
  });
}
if (typeof chrome !== "undefined" && chrome.alarms && chrome.alarms.onAlarm) {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm && alarm.name === POOL_GC_ALARM) {
      WarmTabPool.closeIdle();
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
    streamSearchResults,
    SearchCache,
    WarmTabPool,
    firstPositive,
    DEBUG_LOGS,
    logDebug
  };
}
