import { PlatformId, StrategyMatrixRow } from '../types';

export interface CashbackTier { threshold: number; cashback: number; }
export interface StoreOffer { cardPercent: number; tiers: CashbackTier[]; }
export type StoreOffers = Partial<Record<PlatformId, StoreOffer>>;
export const OFFERS_STORAGE_KEY = 'lowp_store_offers_v1';
const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function normalizeOffer(offer?: StoreOffer): StoreOffer {
  const tiers = (offer?.tiers || []).filter(tier => Number.isFinite(tier.threshold) && tier.threshold > 0 && Number.isFinite(tier.cashback) && tier.cashback >= 0)
    .sort((a, b) => a.threshold - b.threshold);
  return {cardPercent: Number.isFinite(offer?.cardPercent) ? Math.max(0, Math.min(100, offer!.cardPercent)) : 0, tiers};
}

// Milestones use the product subtotal before card discount; only the highest
// eligible cashback is applied, rather than adding every reached level.
export function calculateOffer(subtotal: number, offer?: StoreOffer) {
  const base = money(Math.max(0, subtotal));
  const {cardPercent, tiers} = normalizeOffer(offer);
  const discount = money(base * cardPercent / 100);
  const payable = money(base - discount);
  const reached = tiers.filter(tier => base >= tier.threshold);
  const cashback = reached.length ? Math.max(...reached.map(tier => tier.cashback)) : 0;
  const next = tiers.find(tier => tier.threshold > base && tier.cashback > cashback);
  return {subtotal: base, cardPercent, discount, payable, cashback,
    effectiveTotal: money(Math.max(0, payable - cashback)),
    reachedThreshold: reached.slice().reverse().find(tier => tier.cashback === cashback)?.threshold,
    next: next ? {...next, remaining: money(next.threshold - base), additional: money(next.cashback - cashback)} : null};
}

export function comparisonBaskets(rows: StrategyMatrixRow[], offers: StoreOffers) {
  const ids = [...new Set(rows.flatMap(row => Object.keys(row.stores)))] as PlatformId[];
  const complete = ids.flatMap(id => {
    const cells = rows.map(row => row.stores[id]);
    if (!rows.length || !cells.every(cell => cell?.isAvailable && cell.isComparable !== false)) return [];
    return [{id, name: cells[0].platformName, ...calculateOffer(cells.reduce((sum, cell) => sum + (cell.effectivePrice ?? cell.price), 0), offers[id])}];
  }).sort((a, b) => a.effectiveTotal - b.effectiveTotal);
  const incomplete = ids.filter(id => !complete.some(store => store.id === id)).map(id => {
    const included = rows.filter(row => row.stores[id]?.isAvailable && row.stores[id].isComparable !== false);
    const missing = rows.filter(row => !row.stores[id]?.isAvailable || row.stores[id].isComparable === false)
      .map(row => ({title: row.query, excluded: !!row.stores[id]?.isAvailable}));
    const name = rows.find(row => row.stores[id])!.stores[id].platformName;
    return {id, name, count: included.length, missing,
      ...calculateOffer(included.reduce((sum, row) => sum + (row.stores[id].effectivePrice ?? row.stores[id].price), 0), offers[id])};
  });
  return {complete, incomplete};
}
