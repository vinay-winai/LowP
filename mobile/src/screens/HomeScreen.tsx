import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  StatusBar,
  ActivityIndicator,
  Modal,
  Linking,
  Switch
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StoreCard } from '../components/StoreCard';
import { BackgroundScrapers } from '../components/BackgroundScrapers';
import { StoreLoginModal } from '../components/StoreLoginModal';
import { StrategyMatrixModal } from '../components/StrategyMatrixModal';
import { SettingsModal } from '../components/SettingsModal';
import {StoreSyncPanel} from '../components/StoreSyncPanel';
import { StoreOffers, StoreOffer, OFFERS_STORAGE_KEY, normalizeOffer } from '../core/StoreOffers';
import { compareProduct, reshuffleMatches, refreshComparison, editComparisonCell, ComparisonEdit } from '../core/ProductComparison';
import { enrichFlipkartQuantities } from '../core/ProductDetails';
import {productSearchTitle} from '../core/ProductSearch';
import {useSessionChecks} from '../core/useSessionChecks';
import { MatchingEngine } from '../core/MatchingEngine';
import { StoreSession, StoreLocation, SESSION_TTL_MS, currentSession, updateStoreSession, updateStoreLocation } from '../core/StoreSession';
import {
  PlatformId,
  StoreCollection,
  ProductItem,
  StoreResult,
  StrategyMatrixRow,
} from '../types';
import {
  Search,
  X,
  Store,
  Clock,
  Table,
  Check,
  Plus,
  Edit2,
  Trash2,
  Layers,
  Settings
} from 'lucide-react-native';

export const getStoreSearchUrl = (platformId: PlatformId, query: string): string => {
  const cleanQ = encodeURIComponent((query || '').trim());
  switch (platformId) {
    case 'amazon_tez':
      return `https://www.amazon.in/tez/browse/search?searchKeyword=${cleanQ}`;
    case 'instamart':
      return `https://www.swiggy.com/instamart/search?custom_back=true&query=${cleanQ}`;
    case 'zepto':
      return `https://www.zepto.com/search?query=${cleanQ}`;
    case 'blinkit':
      return `https://blinkit.com/s/?q=${cleanQ}`;
    case 'amazon_main':
      return `https://www.amazon.in/s?k=${cleanQ}`;
    case 'flipkart':
      return `https://www.flipkart.com/search?q=${cleanQ}`;
    default:
      return '#';
  }
};

export const ALL_STORE_TEMPLATES: Record<PlatformId, StoreResult> = {
  amazon_tez: {
    platformId: 'amazon_tez',
    platformName: 'Amazon Now (Tez)',
    logoColor: '#FF9900',
    isAvailable: false,
    statusMessage: 'Ready to search',
    item: null,
    priceBreakdown: null,
    productUrl: '#',
    isLowestPrice: false
  },
  instamart: {
    platformId: 'instamart',
    platformName: 'Swiggy Instamart',
    logoColor: '#FC8019',
    isAvailable: false,
    statusMessage: 'Ready to search',
    item: null,
    priceBreakdown: null,
    productUrl: '#',
    isLowestPrice: false
  },
  zepto: {
    platformId: 'zepto',
    platformName: 'Zepto',
    logoColor: '#7C3AED',
    isAvailable: false,
    statusMessage: 'Ready to search',
    item: null,
    priceBreakdown: null,
    productUrl: '#',
    isLowestPrice: false
  },
  blinkit: {
    platformId: 'blinkit',
    platformName: 'Blinkit',
    logoColor: '#F8CB46',
    isAvailable: false,
    statusMessage: 'Ready to search',
    item: null,
    priceBreakdown: null,
    productUrl: '#',
    isLowestPrice: false
  },
  amazon_main: {
    platformId: 'amazon_main',
    platformName: 'Amazon.in',
    logoColor: '#FF9900',
    isAvailable: false,
    statusMessage: 'Ready to search',
    item: null,
    priceBreakdown: null,
    productUrl: '#',
    isLowestPrice: false
  },
  flipkart: {
    platformId: 'flipkart',
    platformName: 'Flipkart',
    logoColor: '#2874F0',
    isAvailable: false,
    statusMessage: 'Ready to search',
    item: null,
    priceBreakdown: null,
    productUrl: '#',
    isLowestPrice: false
  }
};

export const DEFAULT_COLLECTIONS: StoreCollection[] = [
  {
    id: '10_min_pack',
    name: '10 min pack',
    emoji: '⚡',
    storeIds: ['amazon_tez', 'instamart', 'zepto', 'blinkit']
  },
  {
    id: 'big_online_pack',
    name: 'Big Online Pack',
    emoji: '📦',
    storeIds: ['amazon_main', 'flipkart']
  }
];

export const MAX_COLLECTIONS = 7;

const SEARCH_CACHE_TTL_MS = 90000;
const SEARCH_CACHE_MAX_ENTRIES = 30;
const SEARCH_LIMIT_STORAGE_KEY = 'lowp_limit_parallel_searches';
const SEARCH_OPTIONS_STORAGE_KEY = 'lowp_search_limit_options_v1';

const QUICK_TAGS = [
  'Paneer 200g',
  'Amul Butter 500g',
  'Basmati Rice 1kg',
  'Milk 1L',
  'Fortune Oil 1L'
];

const COLLECTIONS_STORAGE_KEY = 'lowp_collections_v1';
const ACTIVE_COLLECTION_STORAGE_KEY = 'lowp_active_collection_v1';
const KNOWN_STORE_IDS: PlatformId[] = [
  'amazon_tez',
  'instamart',
  'zepto',
  'blinkit',
  'amazon_main',
  'flipkart'
];

// Validate persisted packs so a corrupt / foreign entry can never break the
// collections bar or the scraper set after a relaunch. Drops the retired
// "all_stores" pack, dedupes by id, clamps to the 7-pack maximum.
function sanitizeCollections(raw: unknown): StoreCollection[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const clean: StoreCollection[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const rec = entry as Record<string, unknown>;
    if (typeof rec.id !== 'string' || !rec.id || typeof rec.name !== 'string' || !rec.name) continue;
    if (rec.id === 'all_stores') continue;
    if (seen.has(rec.id)) continue;
    if (!Array.isArray(rec.storeIds)) continue;
    const storeIds = (rec.storeIds as unknown[]).filter(
      (id): id is PlatformId => typeof id === 'string' && (KNOWN_STORE_IDS as string[]).includes(id)
    );
    if (storeIds.length === 0) continue;
    seen.add(rec.id);
    clean.push({
      id: rec.id,
      name: rec.name,
      emoji: typeof rec.emoji === 'string' ? rec.emoji : '📁',
      storeIds,
      isCustom: rec.isCustom === true ? true : undefined
    });
    if (clean.length >= MAX_COLLECTIONS) break;
  }
  return clean.length > 0 ? clean : null;
}

export const HomeScreen: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSearch, setActiveSearch] = useState('');
  const [searchId, setSearchId] = useState(0);
  const currentSearchIdRef = useRef(0);
  const [scrapersEnabled, setScrapersEnabled] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [limitParallelSearches, setLimitParallelSearches] = useState(true);
  const [searchLimitCount, setSearchLimitCount] = useState(3);
  const [parallelPageLoading, setParallelPageLoading] = useState(false);
  const [searchOptionsVisible, setSearchOptionsVisible] = useState(false);
  const [collections, setCollections] = useState<StoreCollection[]>(DEFAULT_COLLECTIONS);
  const [activeCollectionId, setActiveCollectionId] = useState<string>('10_min_pack');
  const [collectionModalVisible, setCollectionModalVisible] = useState(false);
  const [editingCollection, setEditingCollection] = useState<StoreCollection | null>(null);
  const [customNameInput, setCustomNameInput] = useState('');
  const [selectedStoreIds, setSelectedStoreIds] = useState<PlatformId[]>(['amazon_tez', 'instamart', 'zepto', 'blinkit']);

  const currentCollection = collections.find((c) => c.id === activeCollectionId) || DEFAULT_COLLECTIONS[0];
  const [stores, setStores] = useState<StoreResult[]>(() =>
    currentCollection.storeIds.map((id) => ({ ...ALL_STORE_TEMPLATES[id] }))
  );
  const [searchDuration, setSearchDuration] = useState<number | null>(null);
  const [loginModalVisible, setLoginModalVisible] = useState(false);
  const [selectedLoginStore, setSelectedLoginStore] = useState<PlatformId | null>(null);
  const [storeWindowPurpose, setStoreWindowPurpose] = useState<'account' | 'address'>('account');
  const [storeLocations, setStoreLocations] = useState<Partial<Record<PlatformId, StoreLocation>>>({});
  const handleLocationChange = (id: PlatformId, location: StoreLocation) => setStoreLocations(previous => updateStoreLocation(previous,id,location));
  const [storeAddressQuery, setStoreAddressQuery] = useState('');
  const [, refreshSessionAge] = useState(0);
  const [matrixRows, setMatrixRows] = useState<StrategyMatrixRow[]>([]);
  const [matrixModalVisible, setMatrixModalVisible] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [titleStore, setTitleStore] = useState<PlatformId | null>(null);
  const [titlePickerVisible, setTitlePickerVisible] = useState(false);
  const [titleQuery, setTitleQuery] = useState('');
  const [titlePreferenceReady, setTitlePreferenceReady] = useState(false);
  const [searchedFrom, setSearchedFrom] = useState<PlatformId | null>(null);
  const [activeSearchStores, setActiveSearchStores] = useState<PlatformId[] | null>(null);
  const searchStoreIds = useMemo(() => activeSearchStores || currentCollection.storeIds, [activeSearchStores, currentCollection.storeIds]);
  useEffect(() => {
    let active = true;
    AsyncStorage.getItem('lowp_find_title_store_v1').then(id => {
      if (active && id && Object.prototype.hasOwnProperty.call(ALL_STORE_TEMPLATES, id)) setTitleStore(id as PlatformId);
    }).catch(() => {}).finally(() => {if (active) setTitlePreferenceReady(true);});
    return () => {active = false;};
  }, []);
  useEffect(() => {
    if (titlePreferenceReady) AsyncStorage.setItem('lowp_find_title_store_v1', titleStore || '').catch(() => {});
  }, [titleStore, titlePreferenceReady]);
  const [storeOffers, setStoreOffers] = useState<StoreOffers>({});
  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(OFFERS_STORAGE_KEY).then(raw => {
      if (!raw || !active) return;
      const saved = JSON.parse(raw);
      const restored: StoreOffers = {};
      for (const id of Object.keys(ALL_STORE_TEMPLATES) as PlatformId[]) {
        if (saved?.[id] && Array.isArray(saved[id].tiers)) restored[id] = normalizeOffer(saved[id]);
      }
      setStoreOffers(restored);
    }).catch(() => {});
    return () => {active = false;};
  }, []);
  const saveStoreOffer = async (id: PlatformId, offer: StoreOffer) => {
    const next = {...storeOffers, [id]: normalizeOffer(offer)};
    try {await AsyncStorage.setItem(OFFERS_STORAGE_KEY, JSON.stringify(next)); setStoreOffers(next); return true;} catch {return false;}
  };


  const pendingStores = useRef<Set<PlatformId>>(new Set());
  const searchStartTime = useRef<number>(0);
  // Gated until the persisted packs have been restored once, so the initial
  // default state never overwrites the user's saved packs on relaunch.
  const [collectionsReady, setCollectionsReady] = useState(false);
  const sessionChecks = useSessionChecks(isLoading || loginModalVisible, collectionsReady);
  const {sessions: storeSessions, setSessions: setStoreSessions} = sessionChecks;
  const collectionsScrollRef = useRef<ScrollView>(null);

  // Exact-term result cache: key is RAW typed query (case/space
  // normalized only). "milk" and "milk 1l" are different searches. Entries
  // live 90s — prices are stable minute-to-minute, repeats return instantly.
  const searchCacheRef = useRef<Map<string, { ts: number; stores: StoreResult[] }>>(new Map());
  const activeCacheKeyRef = useRef<string | null>(null);
  const latestStoresRef = useRef<StoreResult[] | null>(null);
  const arrivalSeqRef = useRef(0);

  useEffect(() => {
    const timer = setInterval(() => refreshSessionAge((value) => value + 1), 15000);
    return () => clearInterval(timer);
  }, []);

  const handleSessionChange = (platformId: PlatformId, observation: StoreSession) => {
    sessionChecks.observe(platformId, observation);
  };

  const handleCloseStore = () => {
    setLoginModalVisible(false);
    if (!selectedLoginStore) return;
    setStoreSessions((previous) => {
      const last = previous[selectedLoginStore];
      return last?.status === 'checking'
        ? updateStoreSession(previous, selectedLoginStore, { status: 'unknown', evidence: 'none', checkedAt: 0 })
        : previous;
    });
    // Login and delivery-address changes may change the next search's prices.
    // Closing a store does not itself start a search or confirm authentication.
    const changedStores = selectedLoginStore === 'amazon_main' || selectedLoginStore === 'amazon_tez'
      ? ['amazon_main', 'amazon_tez'] : [selectedLoginStore];
    for (const key of searchCacheRef.current.keys()) {
      if (changedStores.some((id) => key.split('#').pop()?.split(',').includes(id))) searchCacheRef.current.delete(key);
    }
  };

  useEffect(() => {

    // Pre-warm DNS and TLS connections to store domains on app mount
    const origins = [
      'https://www.amazon.in/',
      'https://www.swiggy.com/',
      'https://www.zepto.com/',
      'https://blinkit.com/',
      'https://www.flipkart.com/'
    ];
    origins.forEach((url) => {
      fetch(url, { method: 'HEAD', mode: 'no-cors' }).catch(() => {});
    });
  }, []);

  // Restore user-created store packs exactly once on launch.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [savedColsRaw, savedActiveId, savedSearchLimit, savedSearchOptions] = await Promise.all([
          AsyncStorage.getItem(COLLECTIONS_STORAGE_KEY),
          AsyncStorage.getItem(ACTIVE_COLLECTION_STORAGE_KEY),
          AsyncStorage.getItem(SEARCH_LIMIT_STORAGE_KEY),
          AsyncStorage.getItem(SEARCH_OPTIONS_STORAGE_KEY)
        ]);
        if (cancelled) return;
        setLimitParallelSearches(savedSearchLimit !== 'false');
        if (savedSearchOptions) {
          try {
            const options = JSON.parse(savedSearchOptions);
            setSearchLimitCount([1, 2, 3].includes(options.count) ? options.count : 3);
            setParallelPageLoading(options.parallelPageLoading === true);
          } catch { /* Invalid preferences retain the default of three full page slots. */ }
        }
        let nextCols: StoreCollection[] | null = null;
        if (savedColsRaw) {
          try {
            nextCols = sanitizeCollections(JSON.parse(savedColsRaw));
          } catch {
            nextCols = null;
          }
        }
        if (nextCols && nextCols.length > 0) {
          setCollections(nextCols);
          const validActive =
            savedActiveId && nextCols.some((c) => c.id === savedActiveId)
              ? savedActiveId
              : nextCols[0].id;
          setActiveCollectionId(validActive);
          const targetCol =
            nextCols.find((c) => c.id === validActive) || nextCols[0];
          setStores(
            targetCol.storeIds.map((id) => ({ ...ALL_STORE_TEMPLATES[id] }))
          );
        } else if (savedActiveId) {
          // Packs missing but an active id survived: honour it when it names
          // a built-in pack so the previously selected tab is restored.
          const builtin = DEFAULT_COLLECTIONS.find((c) => c.id === savedActiveId);
          if (builtin) {
            setActiveCollectionId(builtin.id);
            setStores(builtin.storeIds.map((id) => ({ ...ALL_STORE_TEMPLATES[id] })));
          }
        }
      } catch {
        // Corrupt storage must never block launch; defaults stay in place.
      } finally {
        if (!cancelled) setCollectionsReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist packs and the selected pack — only after the initial restore, so
  // the in-memory defaults can't wipe saved packs on a fresh launch.
  useEffect(() => {
    if (!collectionsReady) return;
    AsyncStorage.setItem(COLLECTIONS_STORAGE_KEY, JSON.stringify(collections)).catch(() => {});
  }, [collections, collectionsReady]);

  useEffect(() => {
    if (!collectionsReady) return;
    AsyncStorage.setItem(ACTIVE_COLLECTION_STORAGE_KEY, activeCollectionId).catch(() => {});
  }, [activeCollectionId, collectionsReady]);

  useEffect(() => {
    if (!collectionsReady) return;
    AsyncStorage.setItem(SEARCH_OPTIONS_STORAGE_KEY, JSON.stringify({
      count: searchLimitCount, parallelPageLoading
    })).catch(() => {});
  }, [searchLimitCount, parallelPageLoading, collectionsReady]);

  const handleSelectCollection = (colId: string) => {
    setActiveCollectionId(colId);
    const targetCol = collections.find((c) => c.id === colId) || DEFAULT_COLLECTIONS[0];
    setStores(targetCol.storeIds.map((id) => ({ ...ALL_STORE_TEMPLATES[id] })));
    if (activeSearch) {
      handleTriggerSearch(activeSearch, targetCol.storeIds);
    }
  };

  const handleOpenCollectionModal = (col: StoreCollection | null = null) => {
    if (!col && collections.length >= MAX_COLLECTIONS) return;
    setEditingCollection(col);
    setCustomNameInput(col ? col.name : '');
    setSelectedStoreIds(col ? col.storeIds : ['amazon_tez', 'instamart', 'zepto', 'blinkit']);
    setCollectionModalVisible(true);
  };

  const handleSaveCollection = () => {
    const name = customNameInput.trim();
    if (!name || selectedStoreIds.length === 0) return;

    if (editingCollection) {
      setCollections((prev) =>
        prev.map((c) => (c.id === editingCollection.id ? { ...c, name, storeIds: selectedStoreIds } : c))
      );
    } else {
      if (collections.length >= MAX_COLLECTIONS) return;
      const newCol: StoreCollection = {
        id: `custom_${Date.now()}`,
        name,
        emoji: '📁',
        storeIds: selectedStoreIds,
        isCustom: true
      };
      setCollections((prev) =>
        prev.length >= MAX_COLLECTIONS ? prev : [...prev, newCol]
      );
      setActiveCollectionId(newCol.id);
      setStores(newCol.storeIds.map((id) => ({ ...ALL_STORE_TEMPLATES[id] })));
      // The new pack is appended at the end of a horizontal strip — scroll it
      // into view so it doesn't look like it was never added.
      setTimeout(() => {
        try {
          collectionsScrollRef.current?.scrollToEnd({ animated: true });
        } catch {}
      }, 100);
    }
    setCollectionModalVisible(false);
    if (activeSearch) {
      handleTriggerSearch(activeSearch, selectedStoreIds);
    }
  };

  const handleDeleteCollection = (colId: string) => {
    if (collections.length <= 1) return;
    const remaining = collections.filter((c) => c.id !== colId);
    setCollections(remaining);
    if (activeCollectionId === colId) {
      const fallback = remaining[0] || DEFAULT_COLLECTIONS[0];
      setActiveCollectionId(fallback.id);
      setStores(fallback.storeIds.map((id) => ({ ...ALL_STORE_TEMPLATES[id] })));
    }
    setCollectionModalVisible(false);
  };

  const handleTriggerSearch = (query: string, storeOverride?: PlatformId[], titleSelection = !storeOverride && !!titleStore) => {
    const clean = MatchingEngine.cleanSearchTerm(query);
    if (!clean) return;

    const colStoreIds = storeOverride || (titleStore ? [titleStore] : currentCollection.storeIds);
    setActiveSearchStores(colStoreIds);
    setSearchedFrom(titleSelection ? colStoreIds[0] : null);
    const cacheTerm = query.trim().toLowerCase();
    const cacheKey = `${cacheTerm}#${colStoreIds.slice().sort().join(',')}`;
    activeCacheKeyRef.current = cacheKey;
    searchStartTime.current = Date.now();
    currentSearchIdRef.current += 1;
    setSearchId(currentSearchIdRef.current);

    const hit = searchCacheRef.current.get(cacheKey);
    if (hit && Date.now() - hit.ts <= SEARCH_CACHE_TTL_MS) {
      // Cache hit: restore snapshot without remounting WebViews
      setActiveSearch(clean);
      setScrapersEnabled(false);
      setIsLoading(false);
      setSearchDuration(Date.now() - searchStartTime.current);
      pendingStores.current.clear();
      const restored = hit.stores.map((s) => ({ ...s }));
      latestStoresRef.current = restored;
      setStores(restored);
      return;
    }

    setActiveSearch(clean);
    setScrapersEnabled(true);
    setIsLoading(true);
    setSearchDuration(null);
    arrivalSeqRef.current = 0;

    pendingStores.current = new Set(colStoreIds);

    setStores(
      colStoreIds.map((id) => {
        const searchUrl = getStoreSearchUrl(id, clean);
        return {
          ...ALL_STORE_TEMPLATES[id],
          statusMessage: 'Searching...',
          isAvailable: false,
          item: null,
          priceBreakdown: null,
          productUrl: searchUrl,
          globalUrl: searchUrl,
          searchUrl: searchUrl,
          responseTimeMs: undefined
        };
      })
    );
  };

  const searchProductTitle = (title: string) => {
    setSearchQuery(title);
    handleTriggerSearch(title, currentCollection.storeIds);
  };
  const cancelTitleSearch = () => {
    setTitleStore(null);
    setSearchedFrom(null);
    setActiveSearchStores(null);
    currentSearchIdRef.current += 1;
    setSearchId(currentSearchIdRef.current);
    setScrapersEnabled(false);
    pendingStores.current.clear();
    setIsLoading(false);
    setActiveSearch('');
    setSearchDuration(null);
    setStores(currentCollection.storeIds.map(id => ({...ALL_STORE_TEMPLATES[id]})));
  };

  const handleStoreResult = (
    platformId: PlatformId,
    item: ProductItem | null,
    durationMs?: number,
    candidates?: ProductItem[],
    failureReason?: 'login_required'
  ) => {
    pendingStores.current.delete(platformId);

    setStores((prev) => {
      const updated = prev.map((store) => {
        if (store.platformId !== platformId) return store;

        const storeSearchUrl = getStoreSearchUrl(platformId, activeSearch || searchQuery);
        const storeCandidates = (candidates && candidates.length > 0 ? candidates : (item ? [item] : [])).map((c) => ({
          ...c,
          globalUrl: c.globalUrl || storeSearchUrl,
          searchUrl: c.searchUrl || storeSearchUrl
        }));
        const activeItem = item || storeCandidates[0] || null;

        if (!activeItem) {
          return {
            ...store,
            isAvailable: false,
            statusMessage: failureReason === 'login_required' ? 'Sign in required' : 'Not available for this location',
            item: null,
            candidates: [],
            selectedIndex: 0,
            priceBreakdown: null,
            productUrl: storeSearchUrl,
            globalUrl: storeSearchUrl,
            searchUrl: storeSearchUrl,
            responseTimeMs: durationMs,
            arrivedSeq: ++arrivalSeqRef.current
          };
        }

        const priceBreakdown = MatchingEngine.calculateTotalCost(activeItem);
        return {
          ...store,
          isAvailable: true,
          statusMessage: 'Available',
          item: activeItem,
          candidates: storeCandidates,
          selectedIndex: 0,
          priceBreakdown,
          productUrl: activeItem.productUrl || storeSearchUrl,
          globalUrl: activeItem.globalUrl || storeSearchUrl,
          searchUrl: activeItem.searchUrl || storeSearchUrl,
          responseTimeMs: durationMs,
          arrivedSeq: ++arrivalSeqRef.current
        };
      });

      const annotated = MatchingEngine.annotateBestOffers(updated);
      // FIFO ordering like the Chrome extension: stores that finished
      // earlier float to the top; unresolved stores keep their original
      // relative order below them.
      const ordered = annotated
        .map((s, idx) => ({ s, idx }))
        .sort((a, b) => {
          const sa = a.s.arrivedSeq ?? Number.MAX_SAFE_INTEGER;
          const sb = b.s.arrivedSeq ?? Number.MAX_SAFE_INTEGER;
          if (sa !== sb) return sa - sb;
          return a.idx - b.idx;
        })
        .map(({ s }) => s);

      latestStoresRef.current = ordered;
      return ordered;
    });

    if (pendingStores.current.size === 0) {
      setIsLoading(false);
      const totalTime = Date.now() - searchStartTime.current;
      setSearchDuration(totalTime);
      console.log(`[LowP Mobile] All results appeared in ${totalTime}ms (${(totalTime / 1000).toFixed(2)}s)`);
      // Cache persistence happens in the isLoading effect below — writing
      // here would race ahead of the state updater and drop the
      // last-resolving store (usually Amazon) from the snapshot.
    }
  };

  // Persist the finished result set once React has committed the final store
  // state (runs after the render that applied the last store result).
  useEffect(() => {
    if (isLoading) return;
    const cacheKey = activeCacheKeyRef.current;
    const snapshot = latestStoresRef.current;
    if (!cacheKey || !snapshot) return;

    const map = searchCacheRef.current;
    map.set(cacheKey, { ts: Date.now(), stores: snapshot });
    if (map.size > SEARCH_CACHE_MAX_ENTRIES) {
      const oldest = Array.from(map.entries()).sort((a, b) => a[1].ts - b[1].ts);
      while (map.size > SEARCH_CACHE_MAX_ENTRIES) {
        const oldestEntry = oldest.shift();
        if (oldestEntry) map.delete(oldestEntry[0]);
      }
    }
  }, [isLoading]);

  useEffect(() => {
    if (isLoading || !activeSearch || !searchId) return;
    const flipkart = stores.find(store => store.platformId === 'flipkart');
    if (!flipkart?.candidates?.length) return;
    const controller = new AbortController();
    const cacheKey = activeCacheKeyRef.current;
    enrichFlipkartQuantities(flipkart.candidates, controller.signal, (item, quantity) => {
      if (controller.signal.aborted || currentSearchIdRef.current !== searchId) return;
      if (__DEV__) console.log(`[LowP Mobile] Flipkart product quantity: "${item.title}" (${quantity})`);
      const patch = (product: ProductItem | null) => product &&
        ((item.id && product.id === item.id) || (product.title === item.title && product.productUrl === item.productUrl))
        ? { ...product, quantity } : product;
      setStores(previous => {
        const updated = previous.map(store => store.platformId === 'flipkart'
          ? { ...store, item: patch(store.item), candidates: store.candidates?.map(candidate => patch(candidate)!) } : store);
        latestStoresRef.current = updated;
        const cached = cacheKey ? searchCacheRef.current.get(cacheKey) : null;
        if (cached && cacheKey) searchCacheRef.current.set(cacheKey, { ...cached, stores: updated });
        return updated;
      });
      setMatrixRows(previous => previous.map(row => {
        const cell = row.stores.flipkart;
        return cell ? refreshComparison({ ...row,
          anchorItem: row.anchorStoreId === 'flipkart' ? patch(row.anchorItem || cell.item) || undefined : row.anchorItem,
          stores: { ...row.stores, flipkart: {
          ...cell, item: patch(cell.item), candidates: cell.candidates?.map(candidate => patch(candidate)!)
        } } }) : row;
      }));
    }).catch(() => {});
    return () => controller.abort();
  }, [isLoading, searchId]);

  const handleSelectCandidate = (store: StoreResult, index: number) => {
    if (isLoading) return;
    const item = (store.candidates?.length ? store.candidates : store.item ? [store.item] : [])[index];
    if (!item) return;
    const row = compareProduct(store, item, stores, activeSearch);
    setStores(previous => reshuffleMatches(previous, row));
    setMatrixRows(previous => [...previous.filter(existing => existing.selectionKey !== row.selectionKey), row]);
    setMatrixModalVisible(true);
  };

  const handleRemoveMatrixRow = (rowId: string) => {
    const remaining = matrixRows.filter(row => row.id !== rowId);
    setMatrixRows(remaining);
    setStores(previous => remaining.length ? reshuffleMatches(previous, remaining[remaining.length - 1])
      : previous.map(store => ({ ...store, comparisonMatch: false })));
  };

  const handleEditComparison = (rowId: string, platform: PlatformId, edit: ComparisonEdit) => {
    setMatrixRows(previous => previous.map(row => row.id === rowId ? editComparisonCell(row, platform, edit) : row));
  };

  const handleClearMatrix = () => {
    setMatrixRows([]);
    setStores(previous => previous.map(store => ({ ...store, comparisonMatch: false })));
  };


  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#F8FAFC" />

      {/* Top Header */}
      <View style={styles.header}>
        <View style={styles.brandRow}>
          <View style={styles.logoBadge}>
            <Text style={styles.logoBadgeText}>⚡</Text>
          </View>
          <View>
            <Text style={styles.logoTitle}>LowP</Text>
            <Text style={styles.logoSub}>Find products. Compare prices.</Text>
          </View>
        </View>

        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.settingsButton} accessibilityRole="button" accessibilityLabel="Open settings" onPress={() => setSettingsVisible(true)}><Settings size={21} color="#475569" /></TouchableOpacity>
          {!searchedFrom && <TouchableOpacity
            style={[styles.matrixHeaderBtn, matrixRows.length > 0 && styles.matrixHeaderBtnActive]}
            onPress={() => setMatrixModalVisible(true)}
          >
            <Table size={13} color={matrixRows.length > 0 ? '#15803D' : '#64748B'} />
            <Text style={[styles.matrixHeaderBtnText, matrixRows.length > 0 && styles.matrixHeaderBtnTextActive]}>
              Comparison {matrixRows.length > 0 ? `(${matrixRows.length})` : ''}
            </Text>
          </TouchableOpacity>}
        </View>
      </View>

      {/* Main Search Box & Strategy Matrix Action Bar */}
      <View style={styles.searchSection}>
        <View style={styles.searchBox}>
          <Search size={18} color="#64748B" style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Product, brand or pack size"
            accessibilityLabel="Search products"
            placeholderTextColor="#64748B"
            value={searchQuery}
            onChangeText={setSearchQuery}
            onSubmitEditing={() => handleTriggerSearch(searchQuery)}
            returnKeyType="search"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity
              onPress={() => setSearchQuery('')}
              style={styles.clearSearchBtn}
            >
              <X size={16} color="#64748B" />
            </TouchableOpacity>
          )}
          <TouchableOpacity style={[styles.titleModeToggle, titleStore && styles.titleModeActive]} accessibilityRole="button" accessibilityLabel={titleStore ? `Find title, selected store ${ALL_STORE_TEMPLATES[titleStore].platformName}` : 'Get good search title'} onPress={() => {setTitleQuery(searchQuery); setTitlePickerVisible(true);}}>
            <Text style={styles.titleModeLabel}>Find title ▾</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.searchSubmitBtn}
            onPress={() => handleTriggerSearch(searchQuery)}
          >
            {isLoading ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.searchSubmitBtnText}>Search</Text>
            )}
          </TouchableOpacity>
        </View>

        {titleStore && <View style={styles.titleModeBanner}>
          <View style={{flex: 1, minWidth: 0}}>
            <Text style={styles.titleModeBannerTitle}>Find title is on</Text>
            <Text style={styles.titleModeBannerDetail}>Searching only {ALL_STORE_TEMPLATES[titleStore].platformName}</Text>
          </View>
          <TouchableOpacity style={styles.titleModeOffButton} accessibilityRole="button" accessibilityLabel="Turn off find title" onPress={cancelTitleSearch}>
            <X size={16} color="#FFFFFF" />
            <Text style={styles.titleModeOffText}>Turn off</Text>
          </TouchableOpacity>
        </View>}
        {/* Quick Tag Chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.quickTagsRow}
        >
          {QUICK_TAGS.map((tag) => (
            <TouchableOpacity
              key={tag}
              style={styles.tagChip}
              onPress={() => {
                setSearchQuery(tag);
                handleTriggerSearch(tag);
              }}
            >
              <Text style={styles.tagChipText}>{tag}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Store Collections Tab Bar */}
      <View style={styles.collectionsSection}>
        <ScrollView
          ref={collectionsScrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.collectionsRow}
        >
          {collections.map((col) => {
            const isActive = col.id === activeCollectionId;
            return (
              <TouchableOpacity
                key={col.id}
                style={[styles.collectionPill, isActive && styles.collectionPillActive]}
                onPress={() => handleSelectCollection(col.id)}
              >
                <Text style={styles.collectionEmoji}>{col.emoji || '📁'}</Text>
                <Text style={[styles.collectionPillText, isActive && styles.collectionPillTextActive]}>
                  {col.name}
                </Text>
                <TouchableOpacity
                  onPress={() => handleOpenCollectionModal(col)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={{ marginLeft: 4 }}
                  accessibilityLabel={`Edit ${col.name}`}
                >
                  <Edit2 size={11} color={isActive ? '#15803D' : '#64748B'} />
                </TouchableOpacity>
              </TouchableOpacity>
            );
          })}
          <TouchableOpacity
            style={[
              styles.addCollectionBtn,
              collections.length >= MAX_COLLECTIONS && styles.addCollectionBtnDisabled
            ]}
            onPress={() => handleOpenCollectionModal(null)}
            disabled={collections.length >= MAX_COLLECTIONS}
          >
            <Plus size={13} color={collections.length >= MAX_COLLECTIONS ? '#475569' : '#15803D'} />
            <Text style={styles.addCollectionBtnText}>
              Pack {collections.length}/{MAX_COLLECTIONS}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </View>

      {/* Connected Stores Bar */}
      <View style={styles.connectedStoresSection}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <StoreSyncPanel stores={Object.values(ALL_STORE_TEMPLATES)} sessions={storeSessions} locations={storeLocations} searchBusy={isLoading} storeWindowOpen={loginModalVisible}
            syncing={sessionChecks.syncing} paused={sessionChecks.paused} pendingCount={sessionChecks.pendingCount}
            onRefresh={sessionChecks.refresh}
            onOpenStore={id => {setStoreWindowPurpose('account'); setStoreAddressQuery(''); setSelectedLoginStore(id); setLoginModalVisible(true);}}
            onSetAddress={(id, address) => {setStoreWindowPurpose('address'); setStoreAddressQuery(address); setSelectedLoginStore(id); setLoginModalVisible(true);}}
          />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <TouchableOpacity
              accessibilityLabel="Search performance options"
              disabled={isLoading}
              onPress={() => setSearchOptionsVisible(true)}
            >
              <Text style={{ color: '#1D4ED8', fontSize: 12, padding: 6 }}>Options</Text>
            </TouchableOpacity>
            <Text style={{ color: '#475569', fontSize: 12 }}>Limit searches</Text>
            <Switch
              accessibilityLabel="Limit parallel searches"
              value={limitParallelSearches}
              disabled={isLoading}
              trackColor={{ false: '#E2E8F0', true: '#BFDBFE' }}
              thumbColor={limitParallelSearches ? '#1D4ED8' : '#64748B'}
              onValueChange={(value) => {
                setLimitParallelSearches(value);
                searchCacheRef.current.clear();
                AsyncStorage.setItem(SEARCH_LIMIT_STORAGE_KEY, String(value)).catch(() => {});
              }}
            />
          </View>
        </View>
      </View>

      {/* Results Section */}
      <ScrollView
        contentContainerStyle={styles.resultsContainer}
        showsVerticalScrollIndicator={false}
      >
        {activeSearch ? (
          <View style={styles.searchMetaRow}>
            <Text style={styles.searchMetaText}>
              Results for <Text style={styles.searchMetaQuery}>"{activeSearch}"</Text>
              {searchedFrom ? `\nSearched from ${ALL_STORE_TEMPLATES[searchedFrom].platformName}` : ''}
            </Text>
            {isLoading ? (
              <View style={styles.timeBadgeLoading}>
                <ActivityIndicator size="small" color="#1D4ED8" style={{ marginRight: 4 }} />
                <Text style={styles.timeBadgeLoadingText}>{searchedFrom ? 'Searching…' : 'Comparing live…'}</Text>
              </View>
            ) : searchDuration ? (
              <View style={styles.timeBadgeSuccess}>
                <Clock size={12} color="#15803D" />
                <Text style={styles.timeBadgeSuccessText}>{(searchDuration / 1000).toFixed(2)}s</Text>
              </View>
            ) : null}
          </View>
        ) : null}

        <Text style={{ color: '#475569', fontSize: 13, lineHeight: 19, marginBottom: 14 }}>
          {searchedFrom ? (isLoading ? 'Finding product titles in one store…' : 'Choose a product to use its title and size for your pack search.') : activeSearch ? (isLoading ? 'Finding products across your stores…' : 'Tap a product to compare similar items across stores.') : 'Search a product, choose a match, then compare prices across stores.'}
        </Text>

        {activeSearch && stores.map((store) => (
          <StoreCard
            key={store.platformId}
            store={store}
            isLoading={isLoading && store.statusMessage === 'Searching...'}
            selectionDisabled={isLoading}
            selectionMode={searchedFrom ? 'title' : 'compare'}
            onSelectCandidate={(index) => {if (searchedFrom) {const item = (store.candidates?.length ? store.candidates : store.item ? [store.item] : [])[index]; if (item) searchProductTitle(productSearchTitle(item));} else handleSelectCandidate(store, index);}}
            onSearchTitle={searchProductTitle}
            onOpenLink={(url) => {
              if (url && url !== '#') {
                Linking.openURL(url).catch(() => {});
              }
            }}
          />
        ))}
      </ScrollView>

      {/* In-Memory Headless WebViews */}
      <BackgroundScrapers
        searchQuery={activeSearch}
        searchId={searchId}
        enabled={scrapersEnabled}
        maxConcurrentWebViews={limitParallelSearches ? searchLimitCount : 6}
        limitMode={limitParallelSearches && parallelPageLoading ? 'extraction' : 'page'}
        activeStoreIds={searchStoreIds}
        sessionJob={sessionChecks.job}
        searchBusy={isLoading}
        sessionObservationEnabled={sessionChecks.appActive && !loginModalVisible}
        onSessionCheckResult={sessionChecks.finish}
        onSessionObservation={handleSessionChange}
        onLocationObservation={handleLocationChange}
        onStoreResult={(...args) => {
          if (currentSearchIdRef.current === searchId) handleStoreResult(...args);
        }}
      />

      <Modal visible={titlePickerVisible} animationType="slide" onRequestClose={() => setTitlePickerVisible(false)}><SafeAreaView style={{flex: 1, backgroundColor: '#F8FAFC', padding: 16}}><View style={{flexDirection: 'row', alignItems: 'center', marginBottom: 16}}><Text style={{flex: 1, fontSize: 20, fontWeight: '700', color: '#0F172A'}}>Get good search title</Text><TouchableOpacity style={{minHeight: 44, justifyContent: 'center'}} onPress={() => setTitlePickerVisible(false)}><Text style={{color: '#1D4ED8'}}>Cancel</Text></TouchableOpacity></View><Text style={{color: '#475569', marginBottom: 12}}>Choose the store for Find title. This choice stays active until you turn it off.</Text><TextInput accessibilityLabel="Product name for title search" style={{backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 8, padding: 12, color: '#0F172A', marginBottom: 16}} value={titleQuery} onChangeText={setTitleQuery} placeholder="e.g. Amul butter" placeholderTextColor="#64748B" /><ScrollView keyboardShouldPersistTaps="handled">{Object.values(ALL_STORE_TEMPLATES).map(store => <TouchableOpacity key={store.platformId} accessibilityLabel={`Find product title in ${store.platformName}`} accessibilityState={{selected: titleStore === store.platformId}} style={{padding: 16, borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 10, marginBottom: 12, backgroundColor: titleStore === store.platformId ? '#F0FDF4' : '#FFFFFF'}} onPress={() => {setTitleStore(store.platformId); setSearchQuery(titleQuery); setTitlePickerVisible(false); if (MatchingEngine.cleanSearchTerm(titleQuery)) handleTriggerSearch(titleQuery, [store.platformId], true);}}><Text style={{color: '#1D4ED8', fontWeight: '600'}}>{titleStore === store.platformId ? 'Selected: ' : ''}{store.platformName} →</Text></TouchableOpacity>)}</ScrollView></SafeAreaView></Modal>

      <Modal visible={searchOptionsVisible} transparent animationType="fade" onRequestClose={() => setSearchOptionsVisible(false)}>
        <View style={{ flex: 1, justifyContent: 'center', backgroundColor: '#00000099', padding: 24 }}>
          <View style={{ backgroundColor: '#F8FAFC', borderRadius: 16, padding: 20, gap: 16 }}>
            <Text style={{ color: '#F1F5F9', fontSize: 18, fontWeight: '600' }}>Search performance</Text>
            <Text style={{ color: '#475569' }}>Concurrent stores</Text>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              {[1, 2, 3].map(count => (
                <TouchableOpacity
                  key={count}
                  accessibilityLabel={`Concurrent stores ${count}`}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: searchLimitCount === count }}
                  onPress={() => { setSearchLimitCount(count); searchCacheRef.current.clear(); }}
                  style={{ flex: 1, padding: 12, alignItems: 'center', borderRadius: 8,
                    backgroundColor: searchLimitCount === count ? '#BFDBFE' : '#FFFFFF' }}
                >
                  <Text style={{ color: '#F1F5F9', fontSize: 16 }}>{count}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ color: '#475569' }}>Load pages in parallel</Text>
              <Switch
                accessibilityLabel="Load pages in parallel"
                value={parallelPageLoading}
                trackColor={{ false: '#E2E8F0', true: '#BFDBFE' }}
                thumbColor={parallelPageLoading ? '#1D4ED8' : '#64748B'}
                onValueChange={(value) => { setParallelPageLoading(value); searchCacheRef.current.clear(); }}
              />
            </View>
            <Text style={{ color: '#64748B', fontSize: 12 }}>
              {parallelPageLoading ? 'All pages load together. Only result extraction is limited.'
                : 'Page loading and result extraction share the store limit.'}
            </Text>
            <TouchableOpacity accessibilityLabel="Close search performance options" onPress={() => setSearchOptionsVisible(false)}>
              <Text style={{ color: '#1D4ED8', padding: 10, textAlign: 'right', fontWeight: '600' }}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>



      {/* Store Login Modal */}
      <StoreLoginModal
        visible={loginModalVisible}
        platformId={selectedLoginStore}
        session={currentSession(selectedLoginStore ? storeSessions[selectedLoginStore] : undefined)}
        onClose={handleCloseStore}
        onSessionChange={handleSessionChange}
        purpose={storeWindowPurpose}
        addressQuery={storeAddressQuery}
        locationIsSet={!!selectedLoginStore && storeLocations[selectedLoginStore]?.status === 'set' && Date.now() >= storeLocations[selectedLoginStore]!.checkedAt && Date.now() - storeLocations[selectedLoginStore]!.checkedAt < SESSION_TTL_MS}
        onLocationChange={handleLocationChange}
      />

      {/* Custom Collection Builder Modal */}
      <Modal
        visible={collectionModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setCollectionModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.collectionModalCard}>
            <View style={styles.collectionModalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Layers size={18} color="#15803D" />
                <Text style={styles.collectionModalTitle}>
                  {editingCollection ? 'Edit Collection' : 'Create Store Collection'}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setCollectionModalVisible(false)}>
                <X size={18} color="#64748B" />
              </TouchableOpacity>
            </View>

            <View style={styles.collectionModalBody}>
              <Text style={styles.inputLabel}>Collection Name</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="e.g. Quick Groceries, Gadget Pack..."
                placeholderTextColor="#64748B"
                value={customNameInput}
                onChangeText={setCustomNameInput}
              />

              <Text style={[styles.inputLabel, { marginTop: 14 }]}>Select Stores</Text>
              <View style={styles.storeSelectionGrid}>
                {Object.keys(ALL_STORE_TEMPLATES).map((key) => {
                  const s = ALL_STORE_TEMPLATES[key as PlatformId];
                  const isSelected = selectedStoreIds.includes(s.platformId);
                  return (
                    <TouchableOpacity
                      key={s.platformId}
                      style={[
                        styles.storeCheckboxItem,
                        isSelected && styles.storeCheckboxItemActive
                      ]}
                      onPress={() => {
                        setSelectedStoreIds((prev) =>
                          isSelected
                            ? prev.filter((id) => id !== s.platformId)
                            : [...prev, s.platformId]
                        );
                      }}
                    >
                      <View style={[styles.storeDot, { backgroundColor: s.logoColor }]} />
                      <Text style={[styles.storeCheckboxText, isSelected && styles.storeCheckboxTextActive]}>
                        {s.platformName}
                      </Text>
                      {isSelected && <Check size={14} color="#15803D" style={{ marginLeft: 'auto' }} />}
                    </TouchableOpacity>
                  );
                })}
              </View>

              <View style={styles.collectionModalFooter}>
                {editingCollection && collections.length > 1 ? (
                  <TouchableOpacity
                    style={styles.deleteModalBtn}
                    onPress={() => handleDeleteCollection(editingCollection.id)}
                  >
                    <Trash2 size={14} color="#EF4444" />
                    <Text style={styles.deleteModalBtnText}>Delete</Text>
                  </TouchableOpacity>
                ) : <View style={{ flex: 1 }} />}

                <TouchableOpacity
                  style={[
                    styles.saveModalBtn,
                    (!customNameInput.trim() || selectedStoreIds.length === 0) && styles.saveModalBtnDisabled
                  ]}
                  disabled={!customNameInput.trim() || selectedStoreIds.length === 0}
                  onPress={handleSaveCollection}
                >
                  <Text style={styles.saveModalBtnText}>Save Collection</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>

      {/* Strategy Matrix Modal */}
      <StrategyMatrixModal
        visible={matrixModalVisible}
        offers={storeOffers}
        rows={matrixRows}
        onClose={() => setMatrixModalVisible(false)}
        onRemoveRow={handleRemoveMatrixRow}
        onEditCell={handleEditComparison}
        onClearAll={handleClearMatrix}
      />
      <SettingsModal visible={settingsVisible} onClose={() => setSettingsVisible(false)} stores={Object.values(ALL_STORE_TEMPLATES)} offers={storeOffers} onSave={saveStoreOffer} />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  settingsButton: {width: 44, height: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 9},
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC'
  },
  header: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#FFFFFF'
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10
  },
  logoBadge: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#15803D',
    alignItems: 'center',
    justifyContent: 'center'
  },
  logoBadgeText: {
    fontSize: 16
  },
  logoTitle: {
    color: '#0F172A',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: -0.5
  },
  logoSub: {
    color: '#64748B',
    fontSize: 10
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap'
  },
  matrixHeaderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0'
  },
  matrixHeaderBtnActive: {
    borderColor: '#15803D',
    backgroundColor: 'rgba(16, 185, 129, 0.12)'
  },
  matrixHeaderBtnText: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '700'
  },
  matrixHeaderBtnTextActive: {
    color: '#15803D'
  },

  connectedStoresSection: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 4
  },
  connectedStoresLabel: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 6
  },
  storesRow: {
    flexDirection: 'row',
    gap: 8
  },
  storePill: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1
  },
  storeDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5
  },
  storePillText: {
    color: '#0F172A',
    fontSize: 11,
    fontWeight: '600'
  },
  storeSessionText: {
    fontSize: 10,
    marginTop: 2
  },
  searchSection: {
    paddingHorizontal: 16,
    paddingVertical: 10
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingLeft: 12,
    paddingRight: 6,
    height: 48
  },
  titleModeToggle: {alignItems: 'center', justifyContent: 'center', minHeight: 36, paddingHorizontal: 8, borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 6},
  titleModeActive: {backgroundColor: '#EFF6FF', borderColor: '#2563EB'},
  titleModeLabel: {color: '#475569', fontSize: 11},
  titleModeBanner: {flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, marginTop: 10, backgroundColor: '#EFF6FF', borderWidth: 1, borderColor: '#93C5FD', borderRadius: 10},
  titleModeBannerTitle: {color: '#1E3A8A', fontSize: 14, fontWeight: '700'},
  titleModeBannerDetail: {color: '#475569', fontSize: 12, marginTop: 3},
  titleModeOffButton: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44, paddingHorizontal: 14, backgroundColor: '#1D4ED8', borderRadius: 8},
  titleModeOffText: {color: '#FFFFFF', fontSize: 14, fontWeight: '700'},
  searchIcon: {
    marginRight: 6
  },
  searchInput: {
    flex: 1,
    color: '#0F172A',
    fontSize: 14,
    fontWeight: '500'
  },
  clearSearchBtn: {
    padding: 6
  },
  searchSubmitBtn: {
    backgroundColor: '#2563EB',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    marginLeft: 6
  },
  searchSubmitBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800'
  },
  quickTagsRow: {
    flexDirection: 'row',
    gap: 8,
    paddingTop: 8
  },
  tagChip: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0'
  },
  tagChipText: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '500'
  },
  resultsContainer: {
    paddingHorizontal: 16,
    paddingBottom: 24
  },
  searchMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    marginTop: 4
  },
  searchMetaText: {
    color: '#64748B',
    fontSize: 13,
    flex: 1
  },
  searchMetaQuery: {
    color: '#0F172A',
    fontWeight: '700'
  },
  timeBadgeLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(56, 189, 248, 0.1)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.3)'
  },
  timeBadgeLoadingText: {
    color: '#1D4ED8',
    fontSize: 12,
    fontWeight: '600'
  },
  timeBadgeSuccess: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)'
  },
  timeBadgeSuccessText: {
    color: '#15803D',
    fontSize: 12,
    fontWeight: '700'
  },
  collectionsSection: {
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#FFFFFF'
  },
  collectionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  collectionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0'
  },
  collectionPillActive: {
    borderColor: '#15803D',
    backgroundColor: 'rgba(16, 185, 129, 0.12)'
  },
  collectionEmoji: {
    fontSize: 12
  },
  collectionPillText: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '600'
  },
  collectionPillTextActive: {
    color: '#15803D',
    fontWeight: '700'
  },
  addCollectionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'transparent',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderStyle: 'dashed'
  },
  addCollectionBtnDisabled: {
    opacity: 0.45,
    borderColor: '#475569'
  },
  addCollectionBtnText: {
    color: '#15803D',
    fontSize: 11,
    fontWeight: '700'
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16
  },
  collectionModalCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    overflow: 'hidden'
  },
  collectionModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#FFFFFF'
  },
  collectionModalTitle: {
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '800'
  },
  collectionModalBody: {
    padding: 16
  },
  inputLabel: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6
  },
  modalInput: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    color: '#0F172A',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14
  },
  storeSelectionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4
  },
  storeCheckboxItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    width: '48%'
  },
  storeCheckboxItemActive: {
    borderColor: '#15803D',
    backgroundColor: 'rgba(16, 185, 129, 0.12)'
  },
  storeCheckboxText: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '600',
    flex: 1
  },
  storeCheckboxTextActive: {
    color: '#0F172A',
    fontWeight: '700'
  },
  collectionModalFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#FFFFFF'
  },
  saveModalBtn: {
    backgroundColor: '#15803D',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center'
  },
  saveModalBtnDisabled: {
    opacity: 0.4
  },
  saveModalBtnText: {
    color: '#0F172A',
    fontSize: 13,
    fontWeight: '800'
  },
  deleteModalBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)'
  },
  deleteModalBtnText: {
    color: '#EF4444',
    fontSize: 12,
    fontWeight: '700'
  }
});
