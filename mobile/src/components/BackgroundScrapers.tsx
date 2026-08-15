import React, { useEffect, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { PlatformId, ProductItem } from '../types';
import { generateScraperScript } from '../core/ScraperScript';

interface BackgroundScrapersProps {
  searchQuery: string;
  searchId: number;
  onStoreResult: (platformId: PlatformId, item: ProductItem | null) => void;
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
  }
];

const DESKTOP_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

export const BackgroundScrapers: React.FC<BackgroundScrapersProps> = ({
  searchQuery,
  searchId,
  onStoreResult
}) => {
  const resolvedStores = useRef<Set<PlatformId>>(new Set());
  const activeSearchId = useRef<number>(searchId);
  const webViewRefs = useRef<{ [key: string]: WebView | null }>({});

  useEffect(() => {
    resolvedStores.current.clear();
    activeSearchId.current = searchId;

    if (!searchQuery || !searchQuery.trim()) return;

    console.log(`[LowP Mobile] Warm Search for: "${searchQuery}"`);

    // Navigate warm WebViews directly
    STORES.forEach((store) => {
      const targetUrl = store.getUrl(searchQuery);
      const scraperJs = generateScraperScript(searchQuery, store.platformId);
      const webView = webViewRefs.current[store.platformId];
      if (webView) {
        // Fast in-page navigation without destroying the Chromium context
        webView.injectJavaScript(`
          if (window.location.href !== ${JSON.stringify(targetUrl)}) {
            window.location.href = ${JSON.stringify(targetUrl)};
          } else {
            ${scraperJs}
          }
          true;
        `);
      }
    });

    // Safety fallback timeout (7s)
    const timeout = setTimeout(() => {
      STORES.forEach(({ platformId }) => {
        if (!resolvedStores.current.has(platformId)) {
          resolvedStores.current.add(platformId);
          console.log(`[LowP Mobile] Store timeout: ${platformId}`);
          onStoreResult(platformId, null);
        }
      });
    }, 7000);

    return () => clearTimeout(timeout);
  }, [searchId, searchQuery]);

  const handleMessage = (platformId: PlatformId, event: WebViewMessageEvent) => {
    try {
      const payload = JSON.parse(event.nativeEvent.data);
      if (payload && payload.type === 'SCRAPE_RESULT') {
        if (!resolvedStores.current.has(platformId)) {
          resolvedStores.current.add(platformId);
          if (payload.success && payload.data) {
            console.log(`[LowP Mobile] ${platformId} SUCCESS: "${payload.data.title}" at ₹${payload.data.price}`);
            onStoreResult(platformId, payload.data);
          } else {
            console.log(`[LowP Mobile] ${platformId} returned 0 candidates`, payload.debug || {});
            onStoreResult(platformId, null);
          }
        }
      }
    } catch (e) {}
  };

  return (
    <View style={styles.hiddenContainer} pointerEvents="none">
      {STORES.map((store) => {
        const initialUrl = searchQuery ? store.getUrl(searchQuery) : store.getUrl('paneer');
        const scraperJs = generateScraperScript(searchQuery || 'paneer', store.platformId);

        return (
          <WebView
            key={store.platformId}
            ref={(ref) => {
              webViewRefs.current[store.platformId] = ref;
            }}
            source={{ uri: initialUrl }}
            userAgent={DESKTOP_USER_AGENT}
            style={styles.hiddenWebView}
            javaScriptEnabled={true}
            domStorageEnabled={true}
            sharedCookiesEnabled={true}
            thirdPartyCookiesEnabled={true}
            cacheEnabled={true}
            cacheMode="LOAD_DEFAULT"
            mediaPlaybackRequiresUserAction={true}
            allowsInlineMediaPlayback={false}
            geolocationEnabled={false}
            injectedJavaScriptBeforeContentLoaded={scraperJs}
            injectedJavaScript={scraperJs}
            onLoadEnd={() => {
              if (searchQuery && searchQuery.trim()) {
                const currentScraper = generateScraperScript(searchQuery, store.platformId);
                webViewRefs.current[store.platformId]?.injectJavaScript(currentScraper);
              }
            }}
            onMessage={(e) => handleMessage(store.platformId, e)}
            onError={(err) => {
              console.log(`[LowP Mobile] ${store.platformId} WebView error:`, err.nativeEvent);
              if (!resolvedStores.current.has(store.platformId)) {
                resolvedStores.current.add(store.platformId);
                onStoreResult(store.platformId, null);
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
    width: 1,
    height: 1,
    opacity: 0,
    overflow: 'hidden'
  },
  hiddenWebView: {
    width: 1,
    height: 1
  }
});
