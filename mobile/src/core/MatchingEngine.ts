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
    let q = query.trim();
    q = q.replace(/https?:\/\/[^\s]+/g, '');
    q = q.replace(/\b(?:delivery in\s*)?\d+(?:\s*-\s*\d+)?\s*(?:mins?|minutes?|hours?|sec|seconds?)\b/gi, '');
    q = q.replace(/\b(?:fastest delivery|standard delivery|instant delivery|express delivery|free delivery|delivery)\b/gi, '');
    q = q.replace(/[,|\-_+/\\]+/g, ' ');
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
    const queryTokens = q.split(/\s+/).filter(Boolean);

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

    // Unit-normalized quantity matching
    const toStd = (val: number, unit: string) => {
      const u = unit.toLowerCase();
      if (/kg|kgs|kilo|kilogram/.test(u)) return val * 1000;
      if (/g|gm|gms|gram/.test(u)) return val;
      if (/l|lt|ltr|litre|liter/.test(u)) return val * 1000;
      if (/ml|milli/.test(u)) return val;
      return val;
    };

    const qtyRegex = /(\d+(?:\.\d+)?)\s*(l|lt|ltr|litre|litres|liter|kg|kgs|kilo|kilogram|g|gm|gms|gram|grams|ml)\b/i;
    const queryQty = query.match(qtyRegex);

    if (queryQty) {
      const qStd = toStd(parseFloat(queryQty[1]), queryQty[2]);
      const candQty = `${itemTitle} ${packSize}`.match(qtyRegex);
      if (candQty) {
        const cStd = toStd(parseFloat(candQty[1]), candQty[2]);
        if (Math.abs(qStd - cStd) < 0.1) {
          score += 150; // Exact pack size match!
        } else {
          score -= 100; // Pack size mismatch penalty!
        }
      }
    }

    if (queryTokens.length > 0 && fullText.includes(queryTokens[0])) {
      score += 35;
    }

    return Math.max(0, Math.round(score));
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
