import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { PlatformId, ProductItem } from '../types';
import { generateScraperScript } from '../core/ScraperScript';
import {storeSearchScript, WARM_SEARCH_STORES} from '../core/StoreSearch';
import { MatchingEngine } from '../core/MatchingEngine';
import {SessionCheckJob, StoreSession, STORE_SESSION_URLS, SESSION_CHECK_TIMEOUT_MS, readSessionMessage, sessionProbeScript, sessionObserverScript, isStoreSessionUrl} from '../core/StoreSession';
import {StoreLocation, readLocationMessage, locationObserverScript} from '../core/StoreSession';

interface BackgroundScrapersProps {
  searchQuery: string;
  searchId: number;
  enabled?: boolean;
  activeStoreIds?: PlatformId[];
  maxConcurrentWebViews?: number;
  limitMode?: 'page' | 'extraction';
  sessionJob?: SessionCheckJob | null;
  searchBusy?: boolean;
  sessionObservationEnabled?: boolean;
  onSessionCheckResult?: (token: string, platformId: PlatformId, session: StoreSession) => void;
  onSessionObservation?: (platformId: PlatformId, session: StoreSession) => void;
  onLocationObservation?: (platformId: PlatformId, location: StoreLocation) => void;
  onStoreResult: (
    platformId: PlatformId,
    item: ProductItem | null,
    durationMs?: number,
    candidates?: ProductItem[],
    failureReason?: 'login_required'
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

// Limiting is enabled by default; the Home screen switch restores six active pages.
export const DEFAULT_WEBVIEW_CONCURRENCY = 3;

async function directHttpSearch(
  platformId: PlatformId,
  searchQuery: string,
  signal?: AbortSignal
): Promise<{ best: ProductItem | null; candidates: ProductItem[] } | null> {
  const cleanQ = MatchingEngine.cleanSearchTerm(searchQuery);

  if (platformId === 'amazon_main') {
    const url = `https://www.amazon.in/s?k=${encodeURIComponent(cleanQ)}`;
    try {
      const res = await fetch(url, {
        signal,
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
                quantity: MatchingEngine.extractCardQuantity(title, block),
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
        signal,
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
                quantity: MatchingEngine.extractCardQuantity(title, block),
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
  enabled = true,
  activeStoreIds,
  maxConcurrentWebViews = DEFAULT_WEBVIEW_CONCURRENCY,
  limitMode = 'page',
  sessionJob = null,
  searchBusy = false,
  sessionObservationEnabled = true,
  onSessionCheckResult,
  onSessionObservation,
  onLocationObservation,
  onStoreResult
}) => {
  const webViewRefs = useRef<{ [key: string]: WebView | null }>({});
  const resolvedStores = useRef<Set<PlatformId>>(new Set());
  const activeSearchId = useRef<number>(searchId);
  const startTimeRef = useRef<number>(0);
  const previousUrls = useRef<Record<string, string>>({});
  const httpControllers = useRef<Record<string, AbortController>>({});
  const startedRequests = useRef<Record<string, number>>({});
  const navigatedRequests = useRef<Record<string, number>>({});
  const reusablePages = useRef<Record<string, boolean>>({});
  const warmDisabled = useRef<Record<string, boolean>>({});
  const warmTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const storeTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const scheduleKey = useRef('');
  const [revision, setRevision] = useState(0);
  const requestPolicy = useRef({ limit: 3, mode: 'page' as 'page' | 'extraction' });
  const probe = sessionJob && !searchBusy ? sessionJob : null;
  const probeRef = useRef(probe); probeRef.current = probe;
  const probeNavigation = useRef({token: '', url: '', jobToken: ''});
  const nativeUrls = useRef<Record<string, string>>({});
  const observationGate = useRef({enabled: sessionObservationEnabled, epoch: 0});
  if (observationGate.current.enabled !== sessionObservationEnabled) {
    observationGate.current = {enabled: sessionObservationEnabled, epoch: observationGate.current.epoch + 1};
  }
  const observationEpoch = observationGate.current.epoch;

  const targetStores = STORES.filter(
    (s) => !activeStoreIds || activeStoreIds.length === 0 || activeStoreIds.includes(s.platformId)
  );
  const liveKey = `${searchId}:${searchQuery}:${targetStores.map(store => store.platformId).join(',')}:${enabled}`;
  if (scheduleKey.current !== liveKey) {
    scheduleKey.current = liveKey;
    resolvedStores.current.clear();
    activeSearchId.current = searchId;
    startTimeRef.current = Date.now();
    startedRequests.current = {};
    navigatedRequests.current = {};
    requestPolicy.current = {
      limit: Number.isFinite(maxConcurrentWebViews)
        ? Math.max(1, Math.min(6, Math.floor(maxConcurrentWebViews))) : 6,
      mode: limitMode
    };
  }
  const { limit, mode } = requestPolicy.current;
  const running = targetStores.filter(store =>
    startedRequests.current[store.platformId] === searchId && !resolvedStores.current.has(store.platformId));
  const waiting = targetStores.filter(store =>
    startedRequests.current[store.platformId] !== searchId && !resolvedStores.current.has(store.platformId));
  const eligibleStores = [...running, ...waiting.slice(0, Math.max(0, limit - running.length))];
  const loadingStores = mode === 'extraction' ? targetStores.filter(store => !resolvedStores.current.has(store.platformId)) : eligibleStores;
  // Keep the last mounted documents on cache hits, without navigating them
  // to the cached query. A new live search updates their source in place.
  const renderedRequest = useRef<{ stores: typeof STORES; requests: Record<string, { query: string; id: number; source?: string; warm?: boolean; warmReady?: boolean; session?: SessionCheckJob }> } | null>(null);
  if (enabled && searchQuery.trim()) {
    const requests = renderedRequest.current?.requests || {};
    loadingStores.forEach(store => {
      const old = requests[store.platformId];
      if (old?.id === searchId && !old.session) return;
      const warm = mode === 'page' && !!old && !old.session && old.query !== searchQuery &&
        reusablePages.current[store.platformId] && !warmDisabled.current[store.platformId] && WARM_SEARCH_STORES.includes(store.platformId);
      requests[store.platformId] = {query: searchQuery, id: searchId, warm,
        source: warm ? old.source || store.getUrl(old.query) : store.getUrl(searchQuery)};
    });
    // Retain parked views when temporarily searching one store for a title.
    // Only targetStores enter the scheduler or receive new navigation.
    const mounted = new Set([...(renderedRequest.current?.stores || []), ...targetStores]);
    renderedRequest.current = { stores: STORES.filter(store => mounted.has(store)), requests };
  }
  if (probe) {
    reusablePages.current[probe.platformId] = false;
    const requests = renderedRequest.current?.requests || {};
    requests[probe.platformId] = {query: '', id: 0, session: probe};
    const mounted = new Set([...(renderedRequest.current?.stores || []), ...STORES.filter(store => store.platformId === probe.platformId)]);
    renderedRequest.current = {stores: STORES.filter(store => mounted.has(store)), requests};
  }
  const finishProbe = (job: SessionCheckJob, observation: StoreSession) => {
    if (probeRef.current?.token !== job.token) return;
    probeRef.current = null;
    webViewRefs.current[job.platformId]?.injectJavaScript('window.__lowpSessionObserver?.dispose(); window.__lowpSessionProbe?.dispose(); window.__lowpLocationObserver?.dispose(); true;');
    webViewRefs.current[job.platformId]?.stopLoading();
    if (__DEV__) console.log(`[LowP Session] ${job.platformId}: ${observation.status} (${observation.evidence})`);
    onSessionCheckResult?.(job.token, job.platformId, observation);
  };
  useEffect(() => {
    if (!probe) return;
    const job = probe;
    const url = STORE_SESSION_URLS[job.platformId];
    probeNavigation.current = {token: `${job.token}:nav:initial`, url, jobToken: job.token};
    // Allow the native JavaScript-enabled prop to commit before reloading an
    // interrupted document; otherwise an SPA can parse while JS is still off.
    const reloadTimer = previousUrls.current[job.platformId] === url ? setTimeout(() => {
      if (probeRef.current?.token === job.token) webViewRefs.current[job.platformId]?.reload();
    }, 100) : undefined;
    previousUrls.current[job.platformId] = url;
    if (__DEV__) console.log(`[LowP Session] Checking ${job.platformId}`);
    const timer = setTimeout(() => finishProbe(job, {status:'unknown', evidence:'none', checkedAt:Date.now()}), SESSION_CHECK_TIMEOUT_MS);
    return () => {
      clearTimeout(timer);
      if (reloadTimer) clearTimeout(reloadTimer);
      webViewRefs.current[job.platformId]?.injectJavaScript('window.__lowpSessionObserver?.dispose(); window.__lowpSessionProbe?.dispose(); window.__lowpLocationObserver?.dispose(); true;');
      // Search preemption may already be using this view; do not stop it here.
      if (renderedRequest.current?.requests[job.platformId]?.session?.token === job.token) webViewRefs.current[job.platformId]?.stopLoading();
    };
  }, [probe?.token]);
  const markResolved = (platformId: PlatformId) => {
    if (resolvedStores.current.has(platformId)) return false;
    resolvedStores.current.add(platformId);
    clearTimeout(storeTimers.current[platformId]);
    clearTimeout(warmTimers.current[platformId]);
    delete storeTimers.current[platformId];
    webViewRefs.current[platformId]?.stopLoading();
    setRevision(value => value + 1);
    return true;
  };
  const fallbackSearch = (platformId: PlatformId) => {
    const request = renderedRequest.current?.requests[platformId];
    if (activeSearchId.current !== searchId || !request?.warm || request.warmReady || request.id !== searchId || resolvedStores.current.has(platformId)) return;
    clearTimeout(warmTimers.current[platformId]);
    webViewRefs.current[platformId]?.injectJavaScript('window.__lowpWarmSearch?.dispose(); true;');
    request.warm = false;
    request.source = STORES.find(store => store.platformId === platformId)!.getUrl(searchQuery);
    if (nativeUrls.current[platformId] === request.source) {
      // SPA history may already show the new URL while its old cards remain.
      // React Native can skip a source update to that URL, so force a fresh
      // document after the normal scraper props have committed.
      warmTimers.current[platformId] = setTimeout(() => {
        if (activeSearchId.current === searchId && !resolvedStores.current.has(platformId)) webViewRefs.current[platformId]?.reload();
      }, 100);
    }
    warmDisabled.current[platformId] = true;
    console.log(`[LowP Mobile] Search bar fallback: ${platformId}`);
    setRevision(value => value + 1);
  };

  useEffect(() => {
    if (!enabled || !searchQuery || !searchQuery.trim()) {
      Object.entries(webViewRefs.current).forEach(([id, view]) => {
        if (probeRef.current?.platformId === id) return;
        view?.injectJavaScript('window.__lowpWarmSearch?.dispose(); window.__lowpScraper?.dispose(); true;');
        view?.stopLoading();
      });
      return;
    }

    console.log(`[LowP Mobile] Initiating parallel search for: "${searchQuery}" across ${targetStores.length} stores (WebView concurrency ${limit}, mode ${mode})`);

    return () => {
      Object.values(storeTimers.current).forEach(timer => clearTimeout(timer));
      storeTimers.current = {};
      Object.values(warmTimers.current).forEach(timer => clearTimeout(timer));
      warmTimers.current = {};
      Object.values(webViewRefs.current).forEach(view => view?.injectJavaScript('window.__lowpWarmSearch?.dispose(); true;'));
      Object.values(httpControllers.current).forEach(controller => controller.abort());
      httpControllers.current = {};
    };
  }, [searchId, searchQuery, activeStoreIds, enabled]);

  useEffect(() => {
    if (!enabled || !searchQuery.trim()) return;
    const justNavigated = new Set<PlatformId>();
    loadingStores.forEach(store => {
      const platformId = store.platformId;
      if (navigatedRequests.current[platformId] === searchId) return;
      const url = store.getUrl(searchQuery);
      const request = renderedRequest.current?.requests[platformId];
      reusablePages.current[platformId] = false;
      if (request?.warm) {
        // Give Android time to re-enable JavaScript on the parked document.
        warmTimers.current[platformId] = setTimeout(() => {
          if (activeSearchId.current !== searchId || resolvedStores.current.has(platformId)) return;
          console.log(`[LowP Mobile] Search bar attempt: ${platformId}`);
          webViewRefs.current[platformId]?.injectJavaScript(storeSearchScript(platformId, searchQuery, searchId,
            generateScraperScript(searchQuery, platformId, searchId, __DEV__)));
          // Native deadline also covers script errors and a full navigation
          // caused by Enter, which destroys the in-page timer.
          warmTimers.current[platformId] = setTimeout(() => fallbackSearch(platformId), 3200);
        }, 100);
      } else if (previousUrls.current[platformId] === url) webViewRefs.current[platformId]?.reload();
      previousUrls.current[platformId] = url;
      navigatedRequests.current[platformId] = searchId;
      justNavigated.add(platformId);
    });
    eligibleStores.forEach(store => {
      const platformId = store.platformId;
      if (startedRequests.current[platformId] === searchId) return;
      startedRequests.current[platformId] = searchId;
      if (mode === 'extraction' && !justNavigated.has(platformId)) {
        // A waiting page may have finished loading already. Start its scraper
        // without reloading or replacing that WebView's document.
        const script = generateScraperScript(searchQuery, platformId, searchId, __DEV__);
        webViewRefs.current[platformId]?.injectJavaScript(`if (window.__lowpDocumentRequestId === ${searchId}) { ${script} } true;`);
      }
      console.log(`[LowP Mobile] ${mode === 'page' ? 'WebView' : 'Extraction'} start: ${platformId} (${Date.now() - startTimeRef.current}ms queued)`);
      storeTimers.current[platformId] = setTimeout(() => {
        if (scheduleKey.current !== liveKey || !enabled) return;
        if (markResolved(platformId)) {
          httpControllers.current[platformId]?.abort();
          const elapsed = Date.now() - startTimeRef.current;
          console.log(`[LowP Mobile] Store timeout: ${platformId} (${elapsed}ms)`);
          onStoreResult(platformId, null, elapsed);
        }
      }, 9000);
    });
    for (const id of Object.keys(previousUrls.current)) {
      if (!targetStores.some(store => store.platformId === id)) {
        // Parked views retain their source. Keep its URL too, so resuming an
        // interrupted account check reloads that same stopped document.
        delete startedRequests.current[id];
        delete navigatedRequests.current[id];
      }
    }
  }, [searchId, searchQuery, activeStoreIds, enabled, revision, limit, mode]);

  // HTTP searches do not occupy a page slot. A successful queued HTTP result
  // skips that store's WebView navigation entirely.
  useEffect(() => {
    if (!enabled || !searchQuery.trim()) return;
    let cancelled = false;
    const controllers: AbortController[] = [];
    targetStores.filter(store => store.platformId === 'amazon_main' || store.platformId === 'flipkart').forEach(store => {
      const controller = new AbortController();
      controllers.push(controller);
      httpControllers.current[store.platformId] = controller;
      directHttpSearch(store.platformId, searchQuery, controller.signal).then(result => {
        if (!cancelled && result?.best && activeSearchId.current === searchId && markResolved(store.platformId)) {
          const elapsed = Date.now() - startTimeRef.current;
          console.log(`[LowP Mobile] ${store.platformId} FAST HTTP SUCCESS: "${result.best.title}" at ₹${result.best.price} (${elapsed}ms)`);
          onStoreResult(store.platformId, result.best, elapsed, result.candidates);
        }
      }).catch(() => {});
    });
    return () => { cancelled = true; controllers.forEach(controller => controller.abort()); };
  }, [searchId, searchQuery, activeStoreIds, enabled]);

  const handleMessage = (platformId: PlatformId, event: WebViewMessageEvent) => {
    try {
      const payload = JSON.parse(event.nativeEvent.data);
      if (payload.type === 'LOWP_SEARCH_FALLBACK' || payload.type === 'LOWP_SEARCH_READY') {
        const request = renderedRequest.current?.requests[platformId];
        if (!enabled || payload.platformId !== platformId || payload.searchId !== searchId ||
            activeSearchId.current !== searchId || !request?.warm || request.id !== searchId ||
            resolvedStores.current.has(platformId)) return;
        if (payload.type === 'LOWP_SEARCH_FALLBACK') {
          fallbackSearch(platformId);
        } else {
          clearTimeout(warmTimers.current[platformId]);
          request.warmReady = true;
          console.log(`[LowP Mobile] Search bar ready: ${platformId} (${Date.now() - startTimeRef.current}ms)`);
        }
        return;
      }
      if(payload.type === 'LOWP_LOCATION') {
        const job = probeRef.current;
        const token = job?.platformId === platformId && probeNavigation.current.jobToken === job.token ? probeNavigation.current.token :
          observationGate.current.enabled && searchBusy && startedRequests.current[platformId] === searchId ? `search-session:${searchId}:${platformId}:${observationGate.current.epoch}` : '';
        const location = readLocationMessage(event.nativeEvent.data, platformId, token, nativeUrls.current[platformId] || '');
        if(location) onLocationObservation?.(platformId,location);
        return;
      }
      if (payload.type === 'LOWP_SESSION') {
        const job = probeRef.current;
        if (job?.platformId === platformId && probeNavigation.current.jobToken === job.token) {
          const observation = readSessionMessage(event.nativeEvent.data, platformId, probeNavigation.current.token, probeNavigation.current.url);
          if (__DEV__ && payload.status !== 'unknown') console.log(`[LowP Session] Evidence ${platformId}: ${payload.status} (${observation ? 'validated' : 'stale or invalid'})`);
          if (observation && (observation.status !== 'unknown' || payload.conflicting === true)) finishProbe(job, observation);
        } else if (observationGate.current.enabled && enabled && startedRequests.current[platformId] === searchId &&
            renderedRequest.current?.requests[platformId]?.id === searchId && !renderedRequest.current?.requests[platformId]?.session) {
          const observation = readSessionMessage(event.nativeEvent.data, platformId, `search-session:${searchId}:${platformId}:${observationGate.current.epoch}`, nativeUrls.current[platformId] || '');
          if (observation && (observation.status !== 'unknown' || payload.conflicting === true)) onSessionObservation?.(platformId, observation);
        }
        return;
      }
      if (enabled && payload && payload.type === 'SCRAPE_RESULT' && payload.searchId === searchId &&
          payload.platformId === platformId && activeSearchId.current === searchId &&
          startedRequests.current[platformId] === searchId &&
          (!renderedRequest.current?.requests[platformId]?.warm || renderedRequest.current.requests[platformId].warmReady)) {
        if (markResolved(platformId)) {
          httpControllers.current[platformId]?.abort();
          const elapsed = Date.now() - startTimeRef.current;
          if (__DEV__ && payload.debug?.timing) {
            console.log(`[LowP Mobile] Scraper timing: ${platformId} ${JSON.stringify(payload.debug.timing)}`);
          }
          if (payload.success && payload.data) {
            reusablePages.current[platformId] = true;
            console.log(`[LowP Mobile] ${platformId} SUCCESS: "${payload.data.title}" at ₹${payload.data.price} (${elapsed}ms) [Candidates: ${(payload.candidates || []).map((c: any) => (c.title || "").slice(0, 28)).join(" | ")}]`);
            if (payload.debug && payload.debug.failures && payload.debug.failures.length) {
              console.log(`[LowP Mobile] ${platformId} extraction failures:`, payload.debug.failures);
            }
            onStoreResult(platformId, payload.data, elapsed, payload.candidates);
          } else {
            console.log(`[LowP Mobile] ${platformId} returned 0 candidates (${elapsed}ms)`, payload.debug || {});
            onStoreResult(platformId, null, elapsed, [], payload.debug?.reason === 'login_required' ? 'login_required' : undefined);
          }
        }
      }
    } catch (e) {}
  };

  const request = renderedRequest.current;
  if (!request) {
    return null;
  }

  return (
    <View style={styles.hiddenContainer} pointerEvents="none">
      {request.stores.map((store) => {
        const storeRequest = request.requests[store.platformId];
        const isProbe = !!storeRequest?.session && probe?.token === storeRequest.session.token;
        const targetUrl = storeRequest?.session ? STORE_SESSION_URLS[store.platformId] : storeRequest ? storeRequest.source || store.getUrl(storeRequest.query) : 'about:blank';
        const scraperJs = storeRequest?.warm ? 'true;' : enabled && eligibleStores.includes(store) && storeRequest && !storeRequest.session && storeRequest.id === searchId
          ? generateScraperScript(storeRequest.query, store.platformId, storeRequest.id, __DEV__)
          : 'window.__lowpScraper && window.__lowpScraper.dispose(); true;';
        const key = store.platformId;
        const documentStamp = `window.__lowpDocumentRequestId = ${storeRequest?.id ?? 0};`;
        const guardedScript = `if (window.__lowpDocumentRequestId === ${storeRequest?.id ?? 0}) { ${scraperJs} } true;`;

        return (
          <WebView
            key={key}
            ref={(ref) => {
              webViewRefs.current[store.platformId] = ref;
            }}
            source={{ uri: targetUrl }}
            userAgent={DESKTOP_USER_AGENT}
            style={[styles.hiddenWebView, isProbe && styles.probeWebView]}
            javaScriptEnabled={isProbe || (enabled && !storeRequest?.session && loadingStores.includes(store) &&
              (activeSearchId.current !== searchId || !resolvedStores.current.has(store.platformId)))}
            domStorageEnabled={true}
            cacheEnabled={true}
            sharedCookiesEnabled={true}
            thirdPartyCookiesEnabled={true}
            androidHardwareAccelerationDisabled={false}
            webviewDebuggingEnabled={__DEV__}
            androidLayerType="hardware"
            mediaPlaybackRequiresUserAction={true}
            allowsInlineMediaPlayback={false}
            javaScriptCanOpenWindowsAutomatically={false}
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
            overScrollMode="never"
            injectedJavaScriptBeforeContentLoaded={documentStamp + scraperJs}
            injectedJavaScript={documentStamp + scraperJs}
            onLoadStart={(event) => {
              nativeUrls.current[store.platformId] = event.nativeEvent.url;
              if (isProbe && probeRef.current?.token === storeRequest.session?.token) {
                probeNavigation.current = {jobToken: storeRequest.session!.token, token: `${storeRequest.session!.token}:nav:${Date.now()}:${Math.random()}`, url: event.nativeEvent.url};
                if (isStoreSessionUrl(store.platformId, event.nativeEvent.url)) {
                  const script = sessionProbeScript(store.platformId, probeNavigation.current.token);
                  webViewRefs.current[store.platformId]?.injectJavaScript(`if (location.href === ${JSON.stringify(event.nativeEvent.url)}) { ${script} } true;`);
                }
              }
              if (__DEV__ && enabled && loadingStores.includes(store)) {
                console.log(`[LowP Mobile] Page load start: ${store.platformId} (${Date.now() - startTimeRef.current}ms)`);
              }
            }}
            onLoadProgress={({ nativeEvent }) => {
              if (isProbe && probeRef.current?.token === storeRequest.session?.token && nativeEvent.progress > 0.7 && isStoreSessionUrl(store.platformId, probeNavigation.current.url)) {
                webViewRefs.current[store.platformId]?.injectJavaScript(`if (location.href === ${JSON.stringify(probeNavigation.current.url)}) { ${sessionProbeScript(store.platformId, probeNavigation.current.token)} } true;`);
                return;
              }
              if (nativeEvent.progress > 0.5) {
                webViewRefs.current[store.platformId]?.injectJavaScript(guardedScript);
              }
            }}
            onNavigationStateChange={(state) => {
              nativeUrls.current[store.platformId] = state.url;
              if (isProbe && !state.loading && probeRef.current?.token === storeRequest.session?.token && isStoreSessionUrl(store.platformId, state.url)) {
                probeNavigation.current.url = state.url;
                webViewRefs.current[store.platformId]?.injectJavaScript(sessionProbeScript(store.platformId, probeNavigation.current.token));
              }
            }}
            onLoadEnd={(event) => {
              if (isProbe && probeRef.current?.token === storeRequest.session?.token && isStoreSessionUrl(store.platformId, event.nativeEvent.url)) {
                probeNavigation.current.url = event.nativeEvent.url;
                webViewRefs.current[store.platformId]?.injectJavaScript(sessionProbeScript(store.platformId, probeNavigation.current.token));
                return;
              }
              if (__DEV__ && enabled && loadingStores.includes(store)) {
                console.log(`[LowP Mobile] Page load end: ${store.platformId} (${Date.now() - startTimeRef.current}ms)`);
              }
              webViewRefs.current[store.platformId]?.injectJavaScript(documentStamp + scraperJs);
              if (onSessionObservation && observationGate.current.enabled && observationEpoch === observationGate.current.epoch && enabled && !storeRequest?.session && storeRequest?.id === searchId && isStoreSessionUrl(store.platformId, event.nativeEvent.url)) {
                webViewRefs.current[store.platformId]?.injectJavaScript(sessionObserverScript(store.platformId, `search-session:${searchId}:${store.platformId}:${observationEpoch}`, false));
                webViewRefs.current[store.platformId]?.injectJavaScript(locationObserverScript(store.platformId, `search-session:${searchId}:${store.platformId}:${observationEpoch}`));
              }
            }}
            onMessage={(e) => handleMessage(store.platformId, e)}
            onError={(err) => {
              if (isProbe && probeRef.current?.token === storeRequest.session?.token) {
                finishProbe(storeRequest.session!, {status:'unknown', evidence:'none', checkedAt:Date.now()}); return;
              }
              if (!enabled || !loadingStores.includes(store) || activeSearchId.current !== searchId ||
                  storeRequest?.id !== searchId || navigatedRequests.current[store.platformId] !== searchId ||
                  (err.nativeEvent.url && err.nativeEvent.url !== targetUrl)) return;
              console.log(`[LowP Mobile] ${store.platformId} WebView error:`, err.nativeEvent);
              if (markResolved(store.platformId)) {
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
  },
  probeWebView: {position: 'absolute', top: 0, left: 0, flex: 0, width: 480, height: 640}
});
