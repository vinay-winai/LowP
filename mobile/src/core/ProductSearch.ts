import {ProductItem} from '../types';

const normalizeSize = (text: string) => text.toLowerCase().replace(/(\d+(?:\.\d+)?)\s*(kilograms?|kgs?|grams?|gms?|g|millilitres?|milliliters?|ml|litres?|liters?|ltrs?|l)\b/g, (_, amount, unit: string) => {
  const volume = /^(?:ml|milli|l)/.test(unit);
  const factor = /^(?:kg|kilo|l(?!m))/.test(unit) ? 1000 : 1;
  return `${volume ? 'volume' : 'weight'}{${Number(amount) * factor}}`;
}).replace(/[\s()|,]/g, '');

export function productSearchTitle(item: Pick<ProductItem, 'title' | 'quantity'>): string {
  const title = item.title.trim(), quantity = (item.quantity || '').trim();
  if (!quantity || normalizeSize(title).includes(normalizeSize(quantity))) return title;
  return `${title} ${quantity}`;
}
