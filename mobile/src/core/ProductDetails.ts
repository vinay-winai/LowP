import { ProductItem } from '../types';
import { MatchingEngine } from './MatchingEngine';

const quantities = new Map<string, { value: string; checkedAt: number }>();

export async function enrichFlipkartQuantities(items: ProductItem[], signal: AbortSignal,
  onQuantity: (item: ProductItem, quantity: string) => void): Promise<void> {
  // At most the three visible candidates, sequentially, without another WebView.
  for (const item of items.slice(0, 3)) {
    if (signal.aborted) return;
    if (MatchingEngine.extractQuantity(item.quantity || '') || !item.productUrl) continue;
    let url: URL;
    try { url = new URL(item.productUrl.replace(/&amp;/g, '&')); } catch { continue; }
    if (url.protocol !== 'https:' || !['www.flipkart.com', 'flipkart.com'].includes(url.hostname) || !url.pathname.includes('/p/')) continue;
    const key = `${url.origin}${url.pathname}?pid=${url.searchParams.get('pid') || ''}`;
    const cached = quantities.get(key);
    if (cached && Date.now() - cached.checkedAt < 90000) {
      if (cached.value) onQuantity(item, cached.value);
      continue;
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort);
    const timeout = setTimeout(abort, 2500);
    try {
      const response = await fetch(key, { signal: controller.signal });
      if (!response.ok) continue;
      const html = await response.text();
      if (signal.aborted || controller.signal.aborted) return;
      const quantity = MatchingEngine.extractDetailQuantity(html);
      if (signal.aborted || controller.signal.aborted) return;
      quantities.set(key, { value: quantity, checkedAt: Date.now() });
      if (quantities.size > 60) quantities.delete(quantities.keys().next().value!);
      if (quantity) onQuantity(item, quantity);
    } catch { /* Keep the original result when product details are unavailable. */ }
    finally { clearTimeout(timeout); signal.removeEventListener('abort', abort); }
  }
}
