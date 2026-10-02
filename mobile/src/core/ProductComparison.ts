import { ProductItem, StoreResult, StrategyMatrixRow, MatrixStoreCell, PlatformId } from '../types';
import {titleParts, DESCRIPTION_WEIGHT} from './TitleText';

const ignored = new Set(['pack', 'of', 'the', 'and', 'with', 'fresh', 'buy', 'online', 'g', 'gm', 'kg', 'ml', 'l', 'instant', 'breakfast', 'cereal']);
const words = (text: string) => (text || '').toLowerCase()
  .replace(/\bcooks?\s+in\s+\d+\s*(?:minutes?|mins?)/g, ' ')
  .replace(/\d+(?:\.\d+)?\s*(?:kgs?|kilograms?|grams?|gms?|g|ml|millilitres?|milliliters?|litres?|liters?|ltrs?|l)\b/g, ' ')
  .replace(/[^a-z0-9]+/g, ' ').split(' ')
  .filter(word => word.length > 1 && !ignored.has(word) && !/^\d+$/.test(word));

function size(item: ProductItem): string | null {
  const text = `${item.quantity || ''} ${item.title}`.toLowerCase();
  const match = text.match(/(\d+(?:\.\d+)?)\s*(kgs?|kilograms?|grams?|gms?|g|ml|millilitres?|milliliters?|litres?|liters?|ltrs?|l)\b/);
  if (!match) return null;
  const unit = match[2];
  const value = Number(match[1]) * (/^kg|^kilo|^l(?!m)/.test(unit) ? 1000 : 1);
  const count = text.match(/pack\s*of\s*(\d+)\b/) || text.match(/(\d+)\s*[x×]\s*\d+(?:\.\d+)?\s*(?:kg|g|ml|l)\b/)
    || text.match(/\d+(?:\.\d+)?\s*(?:kg|g|ml|l)\s*[x×]\s*(\d+)\b/);
  return `${/^(?:ml|milli|l)/.test(unit) ? 'volume' : 'weight'}:${value}:${count ? Number(count[1]) : 1}`;
}

function titleBrand(title: string): string {
  const brand = title.toLowerCase().match(/\b(quaker|saffola|pintola|yogabar|bagrry'?s|kellogg'?s|amul|milky\s+mist|mother\s+dairy)\b/);
  return brand ? brand[1].replace(/['\s]/g, '') : '';
}

// Titles establish relevance; size and price rank the plausible candidates.
// Missing or conflicting scraped sizes are not a hard exclusion.
export function matchScore(anchor: ProductItem, candidate: ProductItem): number | null {
  if (!(candidate.price > 0)) return null;
  const aSize = size(anchor), bSize = size(candidate);
  const aBrand = words(anchor.brand || '').join(' '), bBrand = words(candidate.brand || '').join(' ');
  // Current scrapers sometimes put the store name in the brand field.
  const known = (brand: string) => brand && !['unknown', 'generic', 'unbranded', 'na',
    'swiggy instamart', 'instamart', 'zepto', 'blinkit', 'amazon in', 'amazon now tez', 'flipkart'].includes(brand);
  if (known(aBrand) && known(bBrand) && aBrand !== bBrand) return null;
  const inferredA = titleBrand(anchor.title), inferredB = titleBrand(candidate.title);
  if (inferredA && inferredB && inferredA !== inferredB) return null;
  const a = new Set(words(anchor.title)), b = new Set(words(candidate.title));
  const weightedWords = (title: string, stripAliases: boolean) => {
    const parts = titleParts(stripAliases ? title.replace(/\([^)]*\)/g, ' ') : title);
    const weights = new Map<string, number>(words(parts.description).map(word => [word, DESCRIPTION_WEIGHT]));
    words(parts.name).forEach(word => weights.set(word, 1));
    return weights;
  };
  const variants = ['salted', 'unsalted', 'organic', 'skimmed', 'toned', 'flavoured', 'masala', 'spring', 'sambar', 'powder', 'protein', 'fat', 'phool', 'doda', 'dodi'];
  if ((a.has('salted') && b.has('unsalted')) || (a.has('unsalted') && b.has('salted'))) return null;
  if (['masala', 'spring', 'sambar', 'powder', 'phool', 'doda', 'dodi', 'cookies', 'spread'].some(word => a.has(word) !== b.has(word))) return null;
  const processed = ['chips', 'wafers', 'fries', 'sticks', 'starch', 'snacks'];
  if (processed.some(word => a.has(word)) !== processed.some(word => b.has(word))) return null;
  const variantPenalty = variants.filter(word => a.has(word) !== b.has(word)).length * 15;
  const overlap = (left: Map<string, number>, right: Map<string, number>) => {
    const common = [...left].reduce((sum, [word, weight]) => sum + Math.min(weight, right.get(word) || 0), 0);
    const leftTotal = [...left.values()].reduce((sum, weight) => sum + weight, 0);
    const rightTotal = [...right.values()].reduce((sum, weight) => sum + weight, 0);
    return { common, coverage: common / Math.max(1, Math.min(leftTotal, rightTotal)),
      similarity: common / Math.max(1, leftTotal + rightTotal - common) };
  };
  const full = overlap(weightedWords(anchor.title, false), weightedWords(candidate.title, false));
  const primary = overlap(weightedWords(anchor.title, true), weightedWords(candidate.title, true));
  const { common, coverage, similarity } = primary.similarity > full.similarity ? primary : full;
  if (!common || coverage < 0.6 || similarity < 0.35) return null;
  const priceDistance = Math.abs(candidate.price - anchor.price) / Math.max(anchor.price, candidate.price, 1);
  const sizeBonus = aSize && bSize ? (aSize === bSize ? 25 : -35) : 0;
  return similarity * 100 + coverage * 30 + sizeBonus - variantPenalty - (a.has('baby') !== b.has('baby') ? 25 : 0)
    + (known(aBrand) && aBrand === bBrand ? 20 : 0) + (1 - priceDistance) * 80;
}

export function compareProduct(anchorStore: StoreResult, anchor: ProductItem, stores: StoreResult[], query: string): StrategyMatrixRow {
  const cells = {} as Record<PlatformId, MatrixStoreCell>;
  let cheapestPrice = Infinity;
  let cheapestStoreId: PlatformId | null = null;
  for (const store of stores) {
    let item: ProductItem | null = store.platformId === anchorStore.platformId ? anchor : null;
    if (!item) {
      let best = -Infinity;
      for (const candidate of store.candidates?.length ? store.candidates : store.item ? [store.item] : []) {
        const score = matchScore(anchor, candidate);
        if (score !== null && score > best) { best = score; item = candidate; }
      }
    }
    const price = item?.price || 0;
    const anchorSize = size(anchor), candidateSize = item ? size(item) : null;
    const comparisonKind = anchorSize && candidateSize ? (anchorSize === candidateSize ? 'same_pack' : 'different_pack') : 'size_unknown';
    const priceDifferencePercent = anchor.price > 0 ? Math.abs(price - anchor.price) / anchor.price * 100 : 0;
    const isComparable = price > 0 && Math.abs(Math.round(price * 100) - Math.round(anchor.price * 100)) * 100 <= Math.round(anchor.price * 100) * 20;
    cells[store.platformId] = {
      platformId: store.platformId, platformName: store.platformName,
      isAvailable: price > 0, isComparable, comparisonKind, priceDifferencePercent, item,
      candidates: [...(store.candidates?.length ? store.candidates : store.item ? [store.item] : [])],
      price, mrp: item?.mrp || price,
      productUrl: item?.productUrl || store.searchUrl || store.globalUrl || '#', isCheapestInRow: false
    };
    if (isComparable && price < cheapestPrice) { cheapestPrice = price; cheapestStoreId = store.platformId; }
  }
  Object.values(cells).forEach(cell => { cell.isCheapestInRow = cell.isComparable === true && cell.price === cheapestPrice; });
  return {
    id: `comparison_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, query: anchor.title,
    selectionKey: `${anchor.title}|${anchor.quantity}|${anchor.brand}`.toLowerCase(),
    searchQuery: query, anchorStoreId: anchorStore.platformId, anchorItem: anchor, addedAt: Date.now(), stores: cells,
    cheapestPrice: Number.isFinite(cheapestPrice) ? cheapestPrice : 0, cheapestStoreId
  };
}

export function refreshComparison(row: StrategyMatrixRow): StrategyMatrixRow {
  const anchor = row.anchorItem || (row.anchorStoreId ? row.stores[row.anchorStoreId]?.item : null);
  if (!anchor) return row;
  const anchorSize = size(anchor);
  const stores = { ...row.stores };
  let cheapestPrice = Infinity, cheapestStoreId: PlatformId | null = null;
  for (const cell of Object.values(stores)) {
    const candidateSize = cell.item ? size(cell.item) : null;
    const comparisonKind = anchorSize && candidateSize ? (anchorSize === candidateSize ? 'same_pack' : 'different_pack') : 'size_unknown';
    const priceDifferencePercent = anchor.price > 0 ? Math.abs(cell.price - anchor.price) / anchor.price * 100 : 0;
    const withinPriceRange = Math.abs(Math.round(cell.price * 100) - Math.round(anchor.price * 100)) * 100 <= Math.round(anchor.price * 100) * 20;
    const isComparable = cell.isAvailable && cell.price > 0 && (cell.includeInTotals === true || withinPriceRange);
    stores[cell.platformId] = { ...cell, comparisonKind, priceDifferencePercent, isComparable, isCheapestInRow: false };
    if (isComparable && cell.price < cheapestPrice) { cheapestPrice = cell.price; cheapestStoreId = cell.platformId; }
  }
  Object.values(stores).forEach(cell => { cell.isCheapestInRow = cell.isComparable === true && cell.price === cheapestPrice; });
  return { ...row, stores, cheapestStoreId, cheapestPrice: Number.isFinite(cheapestPrice) ? cheapestPrice : 0 };
}

export function parseComparisonPrice(input: string): number | null {
  const clean = input.replace(/[₹,\s]/g, '');
  if (!/^\d+(?:\.\d{1,2})?$/.test(clean)) return null;
  const price = Number(clean);
  return Number.isFinite(price) && price > 0 && price <= 500000 ? price : null;
}

export type ComparisonEdit = { kind: 'swap'; index: number } | { kind: 'price'; price: number } | { kind: 'remove' } | {kind: 'include'};

export function editComparisonCell(row: StrategyMatrixRow, platform: PlatformId, edit: ComparisonEdit): StrategyMatrixRow {
  const cell = row.stores[platform];
  if (!cell) return row;
  let updated: MatrixStoreCell;
  if (edit.kind === 'swap') {
    const item = cell.candidates?.[edit.index];
    if (!item || !(item.price > 0)) return row;
    updated = { ...cell, item: { ...item }, price: item.price, mrp: item.mrp || item.price,
      productUrl: item.productUrl || cell.productUrl, isAvailable: true, manuallySelected: true, originalPrice: undefined, includeInTotals: undefined };
  } else if (edit.kind === 'price') {
    if (!cell.item || !Number.isFinite(edit.price) || edit.price <= 0 || edit.price > 500000) return row;
    updated = { ...cell, price: edit.price, item: { ...cell.item, price: edit.price },
      originalPrice: cell.originalPrice ?? cell.price };
  } else if (edit.kind === 'include') {
    if (!cell.isAvailable || !cell.item) return row;
    updated = {...cell, includeInTotals: true};
  } else {
    updated = { ...cell, item: null, price: 0, isAvailable: false, originalPrice: undefined, manuallySelected: false, includeInTotals: undefined };
  }
  const anchorItem = row.anchorItem || (row.anchorStoreId ? row.stores[row.anchorStoreId]?.item : null) || undefined;
  return refreshComparison({ ...row, anchorItem, stores: { ...row.stores, [platform]: updated } });
}

export function reshuffleMatches(stores: StoreResult[], row: StrategyMatrixRow): StoreResult[] {
  const anchor = row.anchorStoreId ? row.stores[row.anchorStoreId]?.item : null;
  if (!anchor) return stores;
  return stores.map(store => {
    const cell = row.stores[store.platformId];
    const candidates = [...(store.candidates?.length ? store.candidates : store.item ? [store.item] : [])];
    candidates.sort((a, b) => {
      if (a === cell?.item) return -1;
      if (b === cell?.item) return 1;
      return (matchScore(anchor, b) ?? -1) - (matchScore(anchor, a) ?? -1);
    });
    return { ...store, candidates, selectedIndex: cell?.item ? 0 : undefined, comparisonMatch: !!cell?.item };
  });
}
