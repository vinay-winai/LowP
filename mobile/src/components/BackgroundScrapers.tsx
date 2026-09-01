import React, { useEffect, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { PlatformId, ProductItem } from '../types';
import { generateScraperScript } from '../core/ScraperScript';
import { MatchingEngine } from '../core/MatchingEngine';

interface BackgroundScrapersProps {
  searchQuery: string;
  searchId: number;
  activeStoreIds?: PlatformId[];
  onStoreResult: (
    platformId: PlatformId,
    item: ProductItem | null,
    durationMs?: number,
    candidates?: ProductItem[]
  ) => void;
}

const STORES: { platformId: PlatformId; getUrl: (q: string) => string }[] = [
  {
    platformId: 'amazon_tez',
    getUrl: (q) => `https://www.amazon.in/tez/browse/search?searchKeyword=${encodeURIComponent(q)}`
  },
  {
    platformId: 'instamart',
    getUrl: (q) => `https://www.swiggy.com/instamart/search?custom_back=true&query=${encodeURIComponent(q)}`
  },
  {
    platformId: 'zepto',
    getUrl: (q) => `https://www.zepto.com/search?query=${encodeURIComponent(q)}`
  },
  {
    platformId: 'blinkit',
    getUrl: (q) => `https://blinkit.com/s/?q=${encodeURIComponent(q)}`
  },
  {
    platformId: 'amazon_main',
    getUrl: (q) => `https://www.amazon.in/s?k=${encodeURIComponent(q)}`
  },
  {
    platformId: 'flipkart',
    getUrl: (q) => `https://www.flipkart.com/search?q=${encodeURIComponent(q)}`
  }
];

const DESKTOP_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

async function directHttpSearch(
  platformId: PlatformId,
  searchQuery: string
): Promise<{ best: ProductItem | null; candidates: ProductItem[] } | null> {
  const cleanQ = MatchingEngine.cleanSearchTerm(searchQuery);

  if (platformId === 'amazon_main') {
    const url = `https://www.amazon.in/s?k=${encodeURIComponent(cleanQ)}`;
    try {
      const res = await fetch(url, {
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'User-Agent': DESKTOP_USER_AGENT
        }
      });
      if (res && res.ok) {
        const html = await res.text();
        const cardBlocks = html.split(/data-component-type="s-search-result"|<div[^>]*data-asin="[A-Z0-9]{10}"|class="[^"]*s-result-item[^"]*"/);
        const candidates: ProductItem[] = [];

        for (let i = 1; i < cardBlocks.length; i++) {
          const block = cardBlocks[i];
          const asinMatch = block.match(/data-asin="([A-Z0-9]{10})"/i);
          const asin = asinMatch ? asinMatch[1] : null;

          let title = '';
          const h2AriaMatch = block.match(/<h2[^>]*aria-label="([^"]+)"[^>]*>/i);
          if (h2AriaMatch && h2AriaMatch[1].length > 5) {
            title = h2AriaMatch[1].trim();
          }

          if (!title) {
            const dpLinkMatch = block.match(/<a[^>]*class="[^"]*(?:s-link-style|a-text-normal|a-link-normal)[^"]*"[^>]*href="[^"]*\/dp\/[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
            if (dpLinkMatch) {
              const text = dpLinkMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
              if (text.length > 5 && !text.startsWith('₹')) {
                title = text;
              }
            }
          }

          if (!title) {
            const h2Match = block.match(/<h2[^>]*><a[^>]*><span[^>]*>([\s\S]*?)<\/span><\/a><\/h2>/i) ||
                            block.match(/<h2[^>]*><span[^>]*>([\s\S]*?)<\/span><\/h2>/i) ||
                            block.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
            if (h2Match) {
              const text = h2Match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
              if (text.length > 5 && !text.startsWith('₹')) {
                title = text;
              }
            }
          }

          if (!title) {
            const spanMatch = block.match(/<span[^>]*class="[^"]*(?:a-size-medium|a-size-base-plus|a-text-normal)[^"]*"[^>]*>([^<]+)<\/span>/i);
            if (spanMatch && spanMatch[1].trim().length > 5) {
              title = spanMatch[1].trim();
            }
          }

          const brandMatch = block.match(/<h2 class="a-size-mini[^"]*"[^>]*><span[^>]*>([^<]+)<\/span><\/h2>/i) ||
                             block.match(/<span class="a-size-medium a-color-base">([^<]+)<\/span>/i);
          const brand = brandMatch ? brandMatch[1].trim() : 'Amazon.in';

          if (brand && brand !== 'Amazon.in' && title && !title.toLowerCase().startsWith(brand.toLowerCase())) {
            title = `${brand} ${title}`;
          }

          const priceMatch = block.match(/class="a-price-whole">([0-9,]+)/i) ||
                             block.match(/class="a-offscreen">₹?([0-9,]+(?:\.[0-9]+)?)/i) ||
                             block.match(/(?:₹|Rs\.?|INR)\s*([0-9,]+(?:\.[0-9]+)?)/i);
          const mrpMatch = block.match(/class="a-price a-text-price"[^>]*><span class="a-offscreen">₹?([0-9,]+(?:\.[0-9]+)?)/i) ||
                           block.match(/data-a-strike="true"[^>]*>₹?([0-9,]+(?:\.[0-9]+)?)/i);
          const imgMatch = block.match(/class="s-image"[^>]*src="([^"]+)"/i) || block.match(/src="(https:\/\/[^"]*media-amazon\.com\/images\/[^"]+)"/i);

          if (title && title.length >= 3 && priceMatch) {
            title = title.replace(/^Sponsored Ad\s*[-–:]\s*/i, "").replace(/^Sponsored\s*[-–:]\s*/i, "").replace(/&amp;/g, '&').trim();
            const price = parseFloat(priceMatch[1].replace(/,/g, ''));
            const mrp = mrpMatch ? parseFloat(mrpMatch[1].replace(/,/g, '')) : price;

            if (price >= 5 && price <= 500000) {
              candidates.push({
                id: asin || `amz_main_${Date.now()}_${i}`,
                title,
                brand,
                quantity: '1 unit',
                mrp: Math.max(mrp, price),
                price,
                image: imgMatch ? imgMatch[1] : 'assets/icon48.png',
                productUrl: asin ? `https://www.amazon.in/dp/${asin}` : url,
                platformId: 'amazon_main',
                _score: MatchingEngine.scoreRelevance(title, cleanQ)
              });
              if (candidates.length >= 6) break;
            }
          }
        }

        if (candidates.length > 0) {
          const valid = candidates.filter((c) => {
            const isAd = (c as any).isSponsored || /\b(?:sponsored\s+ad|sponsored|ad)\b/i.test(c.title || '');
            if (isAd && ((c as any)._score || 0) < 25) return false;
            return true;
          });
          if (valid.length > 0) {
            valid.sort((a, b) => (b as any)._score - (a as any)._score);
            MatchingEngine.applyTitleLengthBonus(valid, cleanQ);
            return { best: valid[0], candidates: valid.slice(0, 3) };
          }
        }
      }
    } catch (e) {}
  } else if (platformId === 'flipkart') {
    const url = `https://www.flipkart.com/search?q=${encodeURIComponent(cleanQ)}`;
    try {
      const res = await fetch(url, {
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9'
        }
      });
      if (res && res.ok) {
        const html = await res.text();
        const cardBlocks = html.split(/data-id="([A-Z0-9]+)"/i);
        const candidates: ProductItem[] = [];

        for (let i = 1; i < cardBlocks.length; i += 2) {
          const dataId = cardBlocks[i];
          const block = cardBlocks[i + 1] || '';

          const titleMatch = block.match(/title="([^"]+)"/i) ||
                             block.match(/alt="([^"]+)"/i) ||
                             block.match(/class="[^"]*KzDlHZ[^"]*">([^<]+)</i) ||
                             block.match(/class="[^"]*_4rR01T[^"]*">([^<]+)</i);
          const priceMatch = block.match(/class="[^"]*hZ3P6w[^"]*">₹?([0-9,]+)/i) ||
                             block.match(/class="[^"]*Nx9bqj[^"]*">₹?([0-9,]+)/i) ||
                             block.match(/class="[^"]*_30jeq3[^"]*">₹?([0-9,]+)/i) ||
                             block.match(/(?:₹|Rs\.?|INR)\s*([0-9,]+(?:\.[0-9]+)?)/i);
          const mrpMatch = block.match(/class="[^"]*kRYCnD[^"]*">₹?<!-- -->([0-9,]+)/i) ||
                           block.match(/class="[^"]*yRaY8j[^"]*">₹?([0-9,]+)/i) ||
                           block.match(/class="[^"]*_3I9_wc[^"]*">₹?([0-9,]+)/i);
          const imgMatch = block.match(/src="([^"]+rukminim[^"]+)"/i) || block.match(/src="([^"]+)"/i);
          const linkMatch = block.match(/href="(\/[^"]+\/p\/[^"]+)"/i);

          if (titleMatch && priceMatch) {
            let rawTitle = titleMatch[1].trim();
            const isSponsored = /^Sponsored\b/i.test(rawTitle);
            const title = rawTitle.replace(/^Sponsored\s*[-–:]\s*/i, '').trim();
            const price = parseFloat(priceMatch[1].replace(/,/g, ''));
            const mrp = mrpMatch ? parseFloat(mrpMatch[1].replace(/,/g, '')) : price;
            const productUrl = linkMatch ? `https://www.flipkart.com${linkMatch[1]}` : url;

            if (price >= 5 && price <= 500000 && title.length >= 3) {
              const _score = MatchingEngine.scoreRelevance(title, cleanQ);
              candidates.push({
                id: dataId || `fk_${Date.now()}_${i}`,
                title,
                brand: 'Flipkart',
                quantity: '1 unit',
                mrp: Math.max(mrp, price),
                price,
                image: imgMatch ? imgMatch[1] : 'assets/icon48.png',
                productUrl,
                platformId: 'flipkart',
                isSponsored,
                _score
              } as any);
              if (candidates.length >= 6) break;
            }
          }
        }

        if (candidates.length > 0) {
          const valid = candidates.filter((c) => {
            const isAd = (c as any).isSponsored || /\b(?:sponsored\s+ad|sponsored|ad)\b/i.test(c.title || '');
            if (isAd && ((c as any)._score || 0) < 25) return false;
            return true;
          });
          if (valid.length > 0) {
            valid.sort((a, b) => (b as any)._score - (a as any)._score);
            MatchingEngine.applyTitleLengthBonus(valid, cleanQ);
            return { best: valid[0], candidates: valid.slice(0, 3) };
          }
        }
      }
    } catch (e) {}
  }
  return null;
}

export const BackgroundScrapers: React.FC<BackgroundScrapersProps> = ({
  searchQuery,
  searchId,
  activeStoreIds,
  onStoreResult
}) => {
  const webViewRefs = useRef<{ [key: string]: WebView | null }>({});
  const resolvedStores = useRef<Set<PlatformId>>(new Set());
  const activeSearchId = useRef<number>(searchId);
  const startTimeRef = useRef<number>(0);

  const targetStores = STORES.filter(
    (s) => !activeStoreIds || activeStoreIds.length === 0 || activeStoreIds.includes(s.platformId)
  );

  useEffect(() => {
    resolvedStores.current.clear();
    activeSearchId.current = searchId;
    startTimeRef.current = Date.now();

    if (!searchQuery || !searchQuery.trim()) return;

    console.log(`[LowP Mobile] Initiating parallel search for: "${searchQuery}" across ${targetStores.length} stores`);

    // Direct HTTP Fast Path for Amazon.in & Flipkart in parallel with WebView
    targetStores.forEach((store) => {
      if (store.platformId === 'amazon_main' || store.platformId === 'flipkart') {
        directHttpSearch(store.platformId, searchQuery).then((result) => {
          if (result && result.best && !resolvedStores.current.has(store.platformId) && activeSearchId.current === searchId) {
            resolvedStores.current.add(store.platformId);
            const elapsed = Date.now() - startTimeRef.current;
            console.log(`[LowP Mobile] ${store.platformId} FAST HTTP SUCCESS: "${result.best.title}" at ₹${result.best.price} (${elapsed}ms)`);
            onStoreResult(store.platformId, result.best, elapsed, result.candidates);
          }
        }).catch(() => {});
      }
    });

    // Safety fallback timeout (9s)
    const timeout = setTimeout(() => {
      targetStores.forEach(({ platformId }) => {
        if (!resolvedStores.current.has(platformId)) {
          resolvedStores.current.add(platformId);
          const elapsed = Date.now() - startTimeRef.current;
          console.log(`[LowP Mobile] Store timeout: ${platformId} (${elapsed}ms)`);
          onStoreResult(platformId, null, elapsed);
        }
      });
    }, 9000);

    return () => clearTimeout(timeout);
  }, [searchId, searchQuery, activeStoreIds]);

  const handleMessage = (platformId: PlatformId, event: WebViewMessageEvent) => {
    try {
      const payload = JSON.parse(event.nativeEvent.data);
      if (payload && payload.type === 'SCRAPE_RESULT') {
        if (!resolvedStores.current.has(platformId)) {
          resolvedStores.current.add(platformId);
          const elapsed = Date.now() - startTimeRef.current;
          if (payload.success && payload.data) {
            console.log(`[LowP Mobile] ${platformId} SUCCESS: "${payload.data.title}" at ₹${payload.data.price} (${elapsed}ms) [Candidates: ${(payload.candidates || []).map((c: any) => (c.title || "").slice(0, 28)).join(" | ")}]`);
            if (payload.debug && payload.debug.failures && payload.debug.failures.length) {
              console.log(`[LowP Mobile] ${platformId} extraction failures:`, payload.debug.failures);
            }
            onStoreResult(platformId, payload.data, elapsed, payload.candidates);
          } else {
            console.log(`[LowP Mobile] ${platformId} returned 0 candidates (${elapsed}ms)`, payload.debug || {});
            onStoreResult(platformId, null, elapsed, []);
          }
        }
      }
    } catch (e) {}
  };

  if (!searchQuery || !searchQuery.trim()) {
    return null;
  }

  return (
    <View style={styles.hiddenContainer} pointerEvents="none">
      {targetStores.map((store) => {
        const targetUrl = store.getUrl(searchQuery);
        const scraperJs = generateScraperScript(searchQuery, store.platformId);
        const key = `${store.platformId}_${searchId}`;

        return (
          <WebView
            key={key}
            ref={(ref) => {
              webViewRefs.current[store.platformId] = ref;
            }}
            source={{ uri: targetUrl }}
            userAgent={DESKTOP_USER_AGENT}
            style={styles.hiddenWebView}
            javaScriptEnabled={true}
            domStorageEnabled={true}
            cacheEnabled={true}
            sharedCookiesEnabled={true}
            thirdPartyCookiesEnabled={true}
            androidHardwareAccelerationDisabled={false}
            androidLayerType="hardware"
            mediaPlaybackRequiresUserAction={true}
            allowsInlineMediaPlayback={false}
            javaScriptCanOpenWindowsAutomatically={false}
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
            overScrollMode="never"
            injectedJavaScriptBeforeContentLoaded={scraperJs}
            injectedJavaScript={scraperJs}
            onLoadProgress={({ nativeEvent }) => {
              if (nativeEvent.progress > 0.5) {
                webViewRefs.current[store.platformId]?.injectJavaScript(scraperJs);
              }
            }}
            onLoadEnd={() => {
              webViewRefs.current[store.platformId]?.injectJavaScript(scraperJs);
            }}
            onMessage={(e) => handleMessage(store.platformId, e)}
            onError={(err) => {
              console.log(`[LowP Mobile] ${store.platformId} WebView error:`, err.nativeEvent);
              if (!resolvedStores.current.has(store.platformId)) {
                resolvedStores.current.add(store.platformId);
                const elapsed = Date.now() - startTimeRef.current;
                onStoreResult(store.platformId, null, elapsed);
              }
            }}
          />
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  hiddenContainer: {
    position: 'absolute',
    top: -9999,
    left: -9999,
    width: 480,
    height: 640,
    opacity: 0.01,
    overflow: 'hidden'
  },
  hiddenWebView: {
    width: 480,
    height: 640
  }
});
