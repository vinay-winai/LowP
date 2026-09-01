import React, { useState, useEffect, useRef } from 'react';
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
  Linking
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StoreCard } from '../components/StoreCard';
import { BackgroundScrapers } from '../components/BackgroundScrapers';
import { StoreLoginModal } from '../components/StoreLoginModal';
import { StrategyMatrixModal } from '../components/StrategyMatrixModal';
import { MatchingEngine } from '../core/MatchingEngine';
import {
  PlatformId,
  StoreCollection,
  ProductItem,
  StoreResult,
  StrategyMatrixRow,
  MatrixStoreCell
} from '../types';
import {
  Search,
  X,
  Sparkles,
  Store,
  RefreshCw,
  Clock,
  ShoppingCart,
  Table,
  Check,
  Plus,
  Edit2,
  Trash2,
  Layers
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
  },
  {
    id: 'all_stores',
    name: 'All Stores',
    emoji: '🛒',
    storeIds: ['amazon_tez', 'instamart', 'zepto', 'blinkit', 'amazon_main', 'flipkart']
  }
];

const SEARCH_CACHE_TTL_MS = 90000;
const SEARCH_CACHE_MAX_ENTRIES = 30;

const QUICK_TAGS = [
  'Paneer 200g',
  'Amul Butter 500g',
  'Basmati Rice 1kg',
  'Milk 1L',
  'Fortune Oil 1L'
];

export const HomeScreen: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSearch, setActiveSearch] = useState('');
  const [searchId, setSearchId] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
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
  const [matrixRows, setMatrixRows] = useState<StrategyMatrixRow[]>([]);
  const [matrixModalVisible, setMatrixModalVisible] = useState(false);
  const [addedToast, setAddedToast] = useState(false);

  const pendingStores = useRef<Set<PlatformId>>(new Set());
  const searchStartTime = useRef<number>(0);

  // Exact-term result cache: key is RAW typed query (case/space
  // normalized only). "milk" and "milk 1l" are different searches. Entries
  // live 90s — prices are stable minute-to-minute, repeats return instantly.
  const searchCacheRef = useRef<Map<string, { ts: number; stores: StoreResult[] }>>(new Map());
  const activeCacheKeyRef = useRef<string | null>(null);
  const latestStoresRef = useRef<StoreResult[] | null>(null);
  const arrivalSeqRef = useRef(0);

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

  const handleSelectCollection = (colId: string) => {
    setActiveCollectionId(colId);
    const targetCol = collections.find((c) => c.id === colId) || DEFAULT_COLLECTIONS[0];
    setStores(targetCol.storeIds.map((id) => ({ ...ALL_STORE_TEMPLATES[id] })));
    if (activeSearch) {
      handleTriggerSearch(activeSearch, targetCol.storeIds);
    }
  };

  const handleOpenCollectionModal = (col: StoreCollection | null = null) => {
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
      const newCol: StoreCollection = {
        id: `custom_${Date.now()}`,
        name,
        emoji: '📁',
        storeIds: selectedStoreIds,
        isCustom: true
      };
      setCollections((prev) => [...prev, newCol]);
      setActiveCollectionId(newCol.id);
      setStores(newCol.storeIds.map((id) => ({ ...ALL_STORE_TEMPLATES[id] })));
    }
    setCollectionModalVisible(false);
    if (activeSearch) {
      handleTriggerSearch(activeSearch, selectedStoreIds);
    }
  };

  const handleDeleteCollection = (colId: string) => {
    setCollections((prev) => prev.filter((c) => c.id !== colId));
    if (activeCollectionId === colId) {
      setActiveCollectionId('10_min_pack');
      setStores(DEFAULT_COLLECTIONS[0].storeIds.map((id) => ({ ...ALL_STORE_TEMPLATES[id] })));
    }
    setCollectionModalVisible(false);
  };

  const handleTriggerSearch = (query: string, storeOverride?: PlatformId[]) => {
    const clean = MatchingEngine.cleanSearchTerm(query);
    if (!clean) return;

    const colStoreIds = storeOverride || currentCollection.storeIds;
    const cacheTerm = query.trim().toLowerCase();
    const cacheKey = `${cacheTerm}#${colStoreIds.slice().sort().join(',')}`;
    activeCacheKeyRef.current = cacheKey;
    searchStartTime.current = Date.now();

    const hit = searchCacheRef.current.get(cacheKey);
    if (hit && Date.now() - hit.ts <= SEARCH_CACHE_TTL_MS) {
      // Cache hit: restore snapshot without remounting WebViews
      setActiveSearch(clean);
      setIsLoading(false);
      setSearchDuration(Date.now() - searchStartTime.current);
      pendingStores.current.clear();
      setStores(hit.stores.map((s) => ({ ...s })));
      return;
    }

    setActiveSearch(clean);
    setSearchId((prev) => prev + 1);
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

  const handleStoreResult = (
    platformId: PlatformId,
    item: ProductItem | null,
    durationMs?: number,
    candidates?: ProductItem[]
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
            statusMessage: 'Not available for this location',
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

  const handleCycleCandidate = (platformId: PlatformId, direction: 'next' | 'prev') => {
    setStores((prev) => {
      const updated = prev.map((store) => {
        if (store.platformId !== platformId) return store;
        if (!store.candidates || store.candidates.length <= 1) return store;

        const total = store.candidates.length;
        const currentIdx = store.selectedIndex || 0;
        const nextIdx = direction === 'next' ? (currentIdx + 1) % total : (currentIdx - 1 + total) % total;
        const nextItem = store.candidates[nextIdx];
        const nextCost = MatchingEngine.calculateTotalCost(nextItem);
        const storeSearchUrl = getStoreSearchUrl(platformId, activeSearch || searchQuery);

        return {
          ...store,
          item: nextItem,
          selectedIndex: nextIdx,
          priceBreakdown: nextCost,
          productUrl: nextItem.productUrl || storeSearchUrl,
          globalUrl: nextItem.globalUrl || storeSearchUrl,
          searchUrl: nextItem.searchUrl || storeSearchUrl
        };
      });

      return MatchingEngine.annotateBestOffers(updated);
    });
  };

  const handleAddToMatrix = () => {
    if (!activeSearch) return;

    const availableStores = stores.filter(
      (s) => s.isAvailable && s.priceBreakdown && s.priceBreakdown.finalPayable > 0
    );
    if (availableStores.length === 0) return;

    let minPrice = Infinity;
    let cheapestStoreId: PlatformId | null = null;

    availableStores.forEach((s) => {
      const p = s.priceBreakdown!.finalPayable;
      if (p < minPrice) {
        minPrice = p;
        cheapestStoreId = s.platformId;
      }
    });

    const storeCells: Record<PlatformId, MatrixStoreCell> = {
      amazon_tez: {
        platformId: 'amazon_tez',
        platformName: 'Amazon Now (Tez)',
        isAvailable: false,
        item: null,
        price: 0,
        mrp: 0,
        productUrl: '#',
        isCheapestInRow: false
      },
      instamart: {
        platformId: 'instamart',
        platformName: 'Swiggy Instamart',
        isAvailable: false,
        item: null,
        price: 0,
        mrp: 0,
        productUrl: '#',
        isCheapestInRow: false
      },
      zepto: {
        platformId: 'zepto',
        platformName: 'Zepto',
        isAvailable: false,
        item: null,
        price: 0,
        mrp: 0,
        productUrl: '#',
        isCheapestInRow: false
      },
      blinkit: {
        platformId: 'blinkit',
        platformName: 'Blinkit',
        isAvailable: false,
        item: null,
        price: 0,
        mrp: 0,
        productUrl: '#',
        isCheapestInRow: false
      },
      amazon_main: {
        platformId: 'amazon_main',
        platformName: 'Amazon.in',
        isAvailable: false,
        item: null,
        price: 0,
        mrp: 0,
        productUrl: '#',
        isCheapestInRow: false
      },
      flipkart: {
        platformId: 'flipkart',
        platformName: 'Flipkart',
        isAvailable: false,
        item: null,
        price: 0,
        mrp: 0,
        productUrl: '#',
        isCheapestInRow: false
      }
    };

    stores.forEach((s) => {
      const hasPrice = Boolean(s.isAvailable && s.priceBreakdown && s.priceBreakdown.finalPayable > 0);
      storeCells[s.platformId] = {
        platformId: s.platformId,
        platformName: s.platformName,
        isAvailable: hasPrice,
        item: s.item,
        price: hasPrice ? s.priceBreakdown!.finalPayable : 0,
        mrp: hasPrice ? (s.item?.mrp || s.priceBreakdown!.finalPayable) : 0,
        productUrl: s.productUrl,
        isCheapestInRow: s.platformId === cheapestStoreId
      };
    });

    const newRow: StrategyMatrixRow = {
      id: `matrix_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      query: activeSearch,
      addedAt: Date.now(),
      stores: storeCells,
      cheapestPrice: minPrice < Infinity ? minPrice : 0,
      cheapestStoreId
    };

    setMatrixRows((prev) => [...prev, newRow]);
    setAddedToast(true);
    setTimeout(() => setAddedToast(false), 2500);
  };

  const handleRemoveMatrixRow = (rowId: string) => {
    setMatrixRows((prev) => prev.filter((r) => r.id !== rowId));
  };

  const handleClearMatrix = () => {
    setMatrixRows([]);
  };

  const lowestStore = stores.find((s) => s.isLowestPrice && s.priceBreakdown);
  const hasAvailableResults = stores.some((s) => s.isAvailable && s.priceBreakdown && s.priceBreakdown.finalPayable > 0);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0F172A" />

      {/* Top Header */}
      <View style={styles.header}>
        <View style={styles.brandRow}>
          <View style={styles.logoBadge}>
            <Text style={styles.logoBadgeText}>⚡</Text>
          </View>
          <View>
            <Text style={styles.logoTitle}>LowP</Text>
            <Text style={styles.logoSub}>Hyperlocal Real-Time Comparator</Text>
          </View>
        </View>

        <View style={styles.headerActions}>
          <TouchableOpacity
            style={[styles.matrixHeaderBtn, matrixRows.length > 0 && styles.matrixHeaderBtnActive]}
            onPress={() => setMatrixModalVisible(true)}
          >
            <Table size={13} color={matrixRows.length > 0 ? '#10B981' : '#94A3B8'} />
            <Text style={[styles.matrixHeaderBtnText, matrixRows.length > 0 && styles.matrixHeaderBtnTextActive]}>
              Matrix {matrixRows.length > 0 ? `(${matrixRows.length})` : ''}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Store Collections Tab Bar */}
      <View style={styles.collectionsSection}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.collectionsRow}>
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
                {col.isCustom && (
                  <TouchableOpacity
                    onPress={() => handleOpenCollectionModal(col)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    style={{ marginLeft: 4 }}
                  >
                    <Edit2 size={11} color={isActive ? '#10B981' : '#94A3B8'} />
                  </TouchableOpacity>
                )}
              </TouchableOpacity>
            );
          })}
          <TouchableOpacity
            style={styles.addCollectionBtn}
            onPress={() => handleOpenCollectionModal(null)}
          >
            <Plus size={13} color="#10B981" />
            <Text style={styles.addCollectionBtnText}>Pack</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>

      {/* Connected Stores Bar */}
      <View style={styles.connectedStoresSection}>
        <Text style={styles.connectedStoresLabel}>Stores:</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.storesRow}>
          {Object.keys(ALL_STORE_TEMPLATES).map((key) => {
            const s = ALL_STORE_TEMPLATES[key as PlatformId];
            return (
              <TouchableOpacity
                key={s.platformId}
                style={[styles.storePill, { borderColor: s.logoColor }]}
                onPress={() => {
                  setSelectedLoginStore(s.platformId);
                  setLoginModalVisible(true);
                }}
              >
                <View style={[styles.storeDot, { backgroundColor: s.logoColor }]} />
                <Text style={styles.storePillText}>{s.platformName}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Main Search Box & Strategy Matrix Action Bar */}
      <View style={styles.searchSection}>
        <View style={styles.searchBox}>
          <Search size={18} color="#64748B" style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search groceries (e.g. paneer, butter 500g)..."
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
              <X size={16} color="#94A3B8" />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.searchSubmitBtn}
            onPress={() => handleTriggerSearch(searchQuery)}
          >
            {isLoading ? (
              <ActivityIndicator size="small" color="#0F172A" />
            ) : (
              <Text style={styles.searchSubmitBtnText}>Compare</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Strategy Matrix & Cart Action Controls */}
        <View style={styles.cartActionBar}>
          <TouchableOpacity
            style={[
              styles.addToCartBtn,
              hasAvailableResults && styles.addToCartBtnActive
            ]}
            onPress={handleAddToMatrix}
            disabled={!hasAvailableResults || isLoading}
          >
            {addedToast ? (
              <Check size={14} color="#0F172A" />
            ) : (
              <ShoppingCart size={14} color={hasAvailableResults ? "#0F172A" : "#64748B"} />
            )}
            <Text
              style={[
                styles.addToCartBtnText,
                hasAvailableResults && styles.addToCartBtnTextActive
              ]}
            >
              {addedToast ? "Added to Matrix!" : "+ Add to Strategy Matrix"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.viewMatrixBtn,
              matrixRows.length > 0 && styles.viewMatrixBtnActive
            ]}
            onPress={() => setMatrixModalVisible(true)}
          >
            <Table size={14} color={matrixRows.length > 0 ? "#10B981" : "#94A3B8"} />
            <Text
              style={[
                styles.viewMatrixBtnText,
                matrixRows.length > 0 && styles.viewMatrixBtnTextActive
              ]}
            >
              View Matrix ({matrixRows.length})
            </Text>
          </TouchableOpacity>
        </View>

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

      {/* Results Section */}
      <ScrollView
        contentContainerStyle={styles.resultsContainer}
        showsVerticalScrollIndicator={false}
      >
        {activeSearch ? (
          <View style={styles.searchMetaRow}>
            <Text style={styles.searchMetaText}>
              Results for <Text style={styles.searchMetaQuery}>"{activeSearch}"</Text>
            </Text>
            {isLoading ? (
              <View style={styles.timeBadgeLoading}>
                <ActivityIndicator size="small" color="#38BDF8" style={{ marginRight: 4 }} />
                <Text style={styles.timeBadgeLoadingText}>Comparing live...</Text>
              </View>
            ) : searchDuration ? (
              <View style={styles.timeBadgeSuccess}>
                <Clock size={12} color="#10B981" />
                <Text style={styles.timeBadgeSuccessText}>{(searchDuration / 1000).toFixed(2)}s</Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {lowestStore && (
          <View style={styles.savingsBanner}>
            <View style={styles.savingsBannerContent}>
              <Sparkles size={16} color="#92400E" />
              <Text style={styles.savingsBannerText}>
                <Text style={styles.boldText}>{lowestStore.platformName}</Text> offers the lowest price at{' '}
                <Text style={styles.priceHighlight}>₹{lowestStore.priceBreakdown?.finalPayable}</Text>!
              </Text>
            </View>
            <TouchableOpacity
              style={styles.bannerAddBtn}
              onPress={handleAddToMatrix}
            >
              <Text style={styles.bannerAddBtnText}>+ Matrix</Text>
            </TouchableOpacity>
          </View>
        )}

        {stores.map((store) => (
          <StoreCard
            key={store.platformId}
            store={store}
            isLoading={isLoading}
            onCycleCandidate={(dir) => handleCycleCandidate(store.platformId, dir)}
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
        activeStoreIds={currentCollection.storeIds}
        onStoreResult={handleStoreResult}
      />



      {/* Store Login Modal */}
      <StoreLoginModal
        visible={loginModalVisible}
        platformId={selectedLoginStore}
        onClose={() => setLoginModalVisible(false)}
        onLoginComplete={() => {
          if (activeSearch) handleTriggerSearch(activeSearch);
        }}
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
                <Layers size={18} color="#10B981" />
                <Text style={styles.collectionModalTitle}>
                  {editingCollection ? 'Edit Collection' : 'Create Store Collection'}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setCollectionModalVisible(false)}>
                <X size={18} color="#94A3B8" />
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
                      {isSelected && <Check size={14} color="#10B981" style={{ marginLeft: 'auto' }} />}
                    </TouchableOpacity>
                  );
                })}
              </View>

              <View style={styles.collectionModalFooter}>
                {editingCollection && editingCollection.isCustom ? (
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
        rows={matrixRows}
        onClose={() => setMatrixModalVisible(false)}
        onRemoveRow={handleRemoveMatrixRow}
        onClearAll={handleClearMatrix}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A'
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B'
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
    backgroundColor: '#10B981',
    alignItems: 'center',
    justifyContent: 'center'
  },
  logoBadgeText: {
    fontSize: 16
  },
  logoTitle: {
    color: '#F8FAFC',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: -0.5
  },
  logoSub: {
    color: '#94A3B8',
    fontSize: 10
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  matrixHeaderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#1E293B',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#334155'
  },
  matrixHeaderBtnActive: {
    borderColor: '#10B981',
    backgroundColor: 'rgba(16, 185, 129, 0.12)'
  },
  matrixHeaderBtnText: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '700'
  },
  matrixHeaderBtnTextActive: {
    color: '#10B981'
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#1E293B',
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
    color: '#F8FAFC',
    fontSize: 11,
    fontWeight: '600'
  },
  searchSection: {
    paddingHorizontal: 16,
    paddingVertical: 10
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    paddingLeft: 12,
    paddingRight: 6,
    height: 48
  },
  searchIcon: {
    marginRight: 6
  },
  searchInput: {
    flex: 1,
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '500'
  },
  clearSearchBtn: {
    padding: 6
  },
  searchSubmitBtn: {
    backgroundColor: '#10B981',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    marginLeft: 6
  },
  searchSubmitBtnText: {
    color: '#0F172A',
    fontSize: 13,
    fontWeight: '800'
  },
  cartActionBar: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8
  },
  addToCartBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#1E293B',
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155'
  },
  addToCartBtnActive: {
    backgroundColor: '#10B981',
    borderColor: '#10B981'
  },
  addToCartBtnText: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '700'
  },
  addToCartBtnTextActive: {
    color: '#0F172A',
    fontWeight: '800'
  },
  viewMatrixBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#1E293B',
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155'
  },
  viewMatrixBtnActive: {
    borderColor: 'rgba(16, 185, 129, 0.4)',
    backgroundColor: 'rgba(16, 185, 129, 0.12)'
  },
  viewMatrixBtnText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '700'
  },
  viewMatrixBtnTextActive: {
    color: '#10B981'
  },
  quickTagsRow: {
    flexDirection: 'row',
    gap: 8,
    paddingTop: 8
  },
  tagChip: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#334155'
  },
  tagChipText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '500'
  },
  resultsContainer: {
    paddingHorizontal: 16,
    paddingBottom: 24
  },
  savingsBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    backgroundColor: '#FEF3C7',
    padding: 12,
    borderRadius: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#FDE68A'
  },
  savingsBannerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1
  },
  savingsBannerText: {
    color: '#92400E',
    fontSize: 12,
    flex: 1
  },
  bannerAddBtn: {
    backgroundColor: '#92400E',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6
  },
  bannerAddBtnText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800'
  },
  boldText: {
    fontWeight: '800'
  },
  priceHighlight: {
    fontWeight: '900',
    color: '#78350F'
  },
  searchMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    marginTop: 4
  },
  searchMetaText: {
    color: '#94A3B8',
    fontSize: 13,
    flex: 1
  },
  searchMetaQuery: {
    color: '#F8FAFC',
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
    color: '#38BDF8',
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
    color: '#10B981',
    fontSize: 12,
    fontWeight: '700'
  },
  collectionsSection: {
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B'
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
    backgroundColor: '#1E293B',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#334155'
  },
  collectionPillActive: {
    borderColor: '#10B981',
    backgroundColor: 'rgba(16, 185, 129, 0.12)'
  },
  collectionEmoji: {
    fontSize: 12
  },
  collectionPillText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600'
  },
  collectionPillTextActive: {
    color: '#10B981',
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
    borderColor: '#334155',
    borderStyle: 'dashed'
  },
  addCollectionBtnText: {
    color: '#10B981',
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
    backgroundColor: '#0F172A',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#334155',
    overflow: 'hidden'
  },
  collectionModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B'
  },
  collectionModalTitle: {
    color: '#F8FAFC',
    fontSize: 15,
    fontWeight: '800'
  },
  collectionModalBody: {
    padding: 16
  },
  inputLabel: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6
  },
  modalInput: {
    backgroundColor: '#1E293B',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    color: '#F8FAFC',
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
    backgroundColor: '#1E293B',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    width: '48%'
  },
  storeCheckboxItemActive: {
    borderColor: '#10B981',
    backgroundColor: 'rgba(16, 185, 129, 0.12)'
  },
  storeCheckboxText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
    flex: 1
  },
  storeCheckboxTextActive: {
    color: '#F8FAFC',
    fontWeight: '700'
  },
  collectionModalFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#1E293B'
  },
  saveModalBtn: {
    backgroundColor: '#10B981',
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
