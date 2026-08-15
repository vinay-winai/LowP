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

    const fullText = normalize(`${itemTitle} ${packSize}`);
    const q = normalize(query);
    const queryTokens = q.split(/\s+/).filter((t) => t.length > 0);

    let score = 0;

    queryTokens.forEach((token) => {
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
