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

export const BackgroundScrapers: React.FC<BackgroundScrapersProps> = ({
  searchQuery,
  searchId,
  onStoreResult
}) => {
  const resolvedStores = useRef<Set<PlatformId>>(new Set());
  const activeSearchId = useRef<number>(searchId);

  useEffect(() => {
    resolvedStores.current.clear();
    activeSearchId.current = searchId;

    if (!searchQuery || !searchQuery.trim()) return;

    // Safety fallback timeout (8s)
    const timeout = setTimeout(() => {
      STORES.forEach(({ platformId }) => {
        if (!resolvedStores.current.has(platformId)) {
          resolvedStores.current.add(platformId);
          onStoreResult(platformId, null);
        }
      });
    }, 8000);

    return () => clearTimeout(timeout);
  }, [searchId, searchQuery]);

  const handleMessage = (platformId: PlatformId, event: WebViewMessageEvent) => {
    try {
      const payload = JSON.parse(event.nativeEvent.data);
      if (payload && payload.type === 'SCRAPE_RESULT') {
        if (!resolvedStores.current.has(platformId)) {
          resolvedStores.current.add(platformId);
          onStoreResult(platformId, payload.data || null);
        }
      }
    } catch (e) {}
  };

  if (!searchQuery || !searchQuery.trim()) {
    return null;
  }

  return (
    <View style={styles.hiddenContainer} pointerEvents="none">
      {STORES.map((store) => {
        const targetUrl = store.getUrl(searchQuery);
        const scraperJs = generateScraperScript(searchQuery, store.platformId);

        return (
          <WebView
            key={`${store.platformId}_${searchId}`}
            source={{ uri: targetUrl }}
            style={styles.hiddenWebView}
            javaScriptEnabled={true}
            domStorageEnabled={true}
            sharedCookiesEnabled={true}
            thirdPartyCookiesEnabled={true}
            injectedJavaScript={scraperJs}
            onMessage={(e) => handleMessage(store.platformId, e)}
            onError={() => {
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
