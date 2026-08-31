import { ProductItem, PriceBreakdown, StoreResult } from '../types';

export class MatchingEngine {
  static calculateTotalCost(item: { price: number; mrp?: number }): PriceBreakdown {
    const basePrice = Math.round(item.price);
    const mrp = Math.round(item.mrp || item.price);
    const savings = Math.max(0, mrp - basePrice);
    const discountPercent = mrp > basePrice ? Math.round((savings / mrp) * 100) : 0;

    return {
      basePrice,
      finalPayable: basePrice,
      savings,
      discountPercent
    };
  }

  static cleanSearchTerm(query: string): string {
    if (!query) return '';
    let q = query;
    try {
      q = decodeURIComponent(q);
    } catch (e) {}
    q = q.replace(/https?:\/\/[^\s]+/g, '');
    q = q.replace(/\b(?:delivery in\s*)?\d+(?:\s*-\s*\d+)?\s*(?:mins?|minutes?|hours?|sec|seconds?)\b/gi, '');
    q = q.replace(/\b(?:fastest delivery|standard delivery|instant delivery|express delivery|free delivery|delivery)\b/gi, '');
    q = q.replace(/[,\-_|+/\\%]+/g, ' ');
    q = q.replace(/\s+/g, ' ').trim();
    return q;
  }

  static scoreRelevance(itemTitle: string, query: string, packSize: string = ''): number {
    if (!itemTitle || !query || !query.trim()) return 0;

    const normalize = (str: string) =>
      (str || '')
        .toLowerCase()
        .replace(/['’`"]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    // Rank on BOTH views of the title: the primary name with parenthetical
    // alt names removed ("Potato (Aalugadda)" -> "Potato") keeps ranking
    // focused, while the untouched title still lets users find items by
    // their alternate name ("searching aalugadda"). The better score wins.
    const fullText = normalize(String(itemTitle).replace(/\([^)]*\)/g, ' ') + ' ' + packSize);
    const fullTextAlt = normalize(`${itemTitle} ${packSize}`);
    const q = normalize(query);
    const queryTokens = q.split(/\s+/).filter((t) => t.length > 0);

    let score = 0;
    let altScore = 0;

    const matchToken = (text: string, token: string) => {
      if (text.includes(token)) return 30;
      if (token.endsWith('s') && token.length > 3 && text.includes(token.slice(0, -1))) return 25;
      if (!token.endsWith('s') && text.includes(token + 's')) return 25;
      return 0;
    };

    queryTokens.forEach((token) => {
      score += matchToken(fullText, token);
      altScore += matchToken(fullTextAlt, token);
    });
    score = Math.max(score, altScore);

    // Exact-name preference: a product whose PRIMARY name (parentheticals
    // removed) starts with the query ("Onion (...)" for "onion") outranks
    // products that merely contain the word ("Sambar Onion (...)").
    const strippedTitle = normalize(String(itemTitle).replace(/\([^)]*\)/g, ' '));
    if (q && strippedTitle.startsWith(q)) score += 20;

    // Variety modifiers denote DIFFERENT products ("spring onion",
    // "sambar onion", "green onion" are not generic onions) — rank them
    // below plain matches instead of letting them tie on relevance.
    const VARIETY_MODIFIERS = ['spring', 'sambar', 'green', 'bunch', 'shallot'];
    if (q) {
      const varietyRx = new RegExp('\\b(' + VARIETY_MODIFIERS.join('|') + ')\\s+' + q + '\\b');
      if (varietyRx.test(strippedTitle)) score -= 15;
    }

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

  static annotateBestOffers(results: StoreResult[]): StoreResult[] {
    const availableStores = results.filter(
      (r) => r.isAvailable && r.priceBreakdown && r.priceBreakdown.finalPayable > 0
    );

    if (availableStores.length === 0) {
      return results.map((r) => ({ ...r, isLowestPrice: false }));
    }

    let minPrice = Infinity;
    for (const store of availableStores) {
      if (store.priceBreakdown!.finalPayable < minPrice) {
        minPrice = store.priceBreakdown!.finalPayable;
      }
    }

    return results.map((store) => {
      const isLowest =
        store.isAvailable &&
        store.priceBreakdown !== null &&
        store.priceBreakdown.finalPayable === minPrice;
      return {
        ...store,
        isLowestPrice: isLowest
      };
    });
  }
}
