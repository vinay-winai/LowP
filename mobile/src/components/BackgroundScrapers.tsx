import React, { useEffect, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { PlatformId, ProductItem } from '../types';
import { generateScraperScript } from '../core/ScraperScript';

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

// Remount-per-search design (measured faster than persistent reuse on
// device): four fresh hidden WebViews per search, torn down afterwards so
// nothing heavy stays resident between searches. A persistent-pool variant
// was tried and rolled back — keeping 4 live SPAs resident cost more than
// the saved cold-start.
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
            injectedJavaScript={scraperJs}
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
