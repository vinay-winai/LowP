import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  StatusBar,
  ActivityIndicator
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { StoreCard } from '../components/StoreCard';
import { BackgroundScrapers } from '../components/BackgroundScrapers';
import { LocationModal } from '../components/LocationModal';
import { StoreLoginModal } from '../components/StoreLoginModal';
import { MatchingEngine } from '../core/MatchingEngine';
import { LocationService, DEFAULT_LOCATION } from '../core/LocationService';
import {
  PlatformId,
  LocationProfile,
  ProductItem,
  StoreResult,
  StoreAccountStatus
} from '../types';
import { Search, MapPin, X, Sparkles, Store, RefreshCw } from 'lucide-react-native';

const INITIAL_STORES: StoreResult[] = [
  {
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
  {
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
  {
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
  {
    platformId: 'blinkit',
    platformName: 'Blinkit',
    logoColor: '#F8CB46',
    isAvailable: false,
    statusMessage: 'Ready to search',
    item: null,
    priceBreakdown: null,
    productUrl: '#',
    isLowestPrice: false
  }
];

const QUICK_TAGS = [
  'Paneer 200g',
  'Amul Butter 500g',
  'Basmati Rice 1kg',
  'Milk 1L',
  'Fortune Oil 1L'
];

export const HomeScreen: React.FC = () => {
  const [activeLocation, setActiveLocation] = useState<LocationProfile>(DEFAULT_LOCATION);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSearch, setActiveSearch] = useState('');
  const [searchId, setSearchId] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [stores, setStores] = useState<StoreResult[]>(INITIAL_STORES);
  const [locationModalVisible, setLocationModalVisible] = useState(false);
  const [loginModalVisible, setLoginModalVisible] = useState(false);
  const [selectedLoginStore, setSelectedLoginStore] = useState<PlatformId | null>(null);

  const pendingStores = useRef<Set<PlatformId>>(new Set());

  useEffect(() => {
    LocationService.getActiveLocation().then(setActiveLocation);
  }, []);

  const handleTriggerSearch = (query: string) => {
    const clean = MatchingEngine.cleanSearchTerm(query);
    if (!clean) return;

    setActiveSearch(clean);
    setSearchId((prev) => prev + 1);
    setIsLoading(true);

    pendingStores.current = new Set(['amazon_tez', 'instamart', 'zepto', 'blinkit']);

    setStores(
      INITIAL_STORES.map((s) => ({
        ...s,
        statusMessage: 'Searching...',
        isAvailable: false,
        item: null,
        priceBreakdown: null
      }))
    );
  };

  const handleStoreResult = (platformId: PlatformId, item: ProductItem | null) => {
    pendingStores.current.delete(platformId);

    setStores((prev) => {
      const updated = prev.map((store) => {
        if (store.platformId !== platformId) return store;

        if (!item) {
          return {
            ...store,
            isAvailable: false,
            statusMessage: 'Not available for this location',
            item: null,
            priceBreakdown: null
          };
        }

        const priceBreakdown = MatchingEngine.calculateTotalCost(item);
        return {
          ...store,
          isAvailable: true,
          statusMessage: 'Available',
          item,
          priceBreakdown,
          productUrl: item.productUrl || store.productUrl
        };
      });

      return MatchingEngine.annotateBestOffers(updated);
    });

    if (pendingStores.current.size === 0) {
      setIsLoading(false);
    }
  };

  const lowestStore = stores.find((s) => s.isLowestPrice && s.priceBreakdown);

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

        <TouchableOpacity
          style={styles.locationPill}
          onPress={() => setLocationModalVisible(true)}
        >
          <MapPin size={13} color="#10B981" />
          <Text style={styles.locationPillText} numberOfLines={1}>
            {activeLocation.name.split(' ')[0]} ({activeLocation.pincode})
          </Text>
        </TouchableOpacity>
      </View>

      {/* Connected Stores Bar */}
      <View style={styles.connectedStoresSection}>
        <Text style={styles.connectedStoresLabel}>Stores (Tap to Login/Sync):</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.storesRow}>
          {INITIAL_STORES.map((s) => (
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
          ))}
        </ScrollView>
      </View>

      {/* Main Search Box */}
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
        {lowestStore && (
          <View style={styles.savingsBanner}>
            <Sparkles size={16} color="#92400E" />
            <Text style={styles.savingsBannerText}>
              <Text style={styles.boldText}>{lowestStore.platformName}</Text> offers the lowest price at{' '}
              <Text style={styles.priceHighlight}>₹{lowestStore.priceBreakdown?.finalPayable}</Text>!
            </Text>
          </View>
        )}

        {stores.map((store) => (
          <StoreCard key={store.platformId} store={store} isLoading={isLoading} />
        ))}
      </ScrollView>

      {/* In-Memory Headless WebViews */}
      <BackgroundScrapers
        searchQuery={activeSearch}
        searchId={searchId}
        onStoreResult={handleStoreResult}
      />

      {/* Location Modal */}
      <LocationModal
        visible={locationModalVisible}
        activeLocation={activeLocation}
        onClose={() => setLocationModalVisible(false)}
        onSelectLocation={(loc) => {
          setActiveLocation(loc);
          if (activeSearch) handleTriggerSearch(activeSearch);
        }}
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
  locationPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#1E293B',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#334155',
    maxWidth: 150
  },
  locationPillText: {
    color: '#F8FAFC',
    fontSize: 11,
    fontWeight: '700'
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
  quickTagsRow: {
    flexDirection: 'row',
    gap: 8,
    paddingTop: 10
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
    gap: 8,
    backgroundColor: '#FEF3C7',
    padding: 12,
    borderRadius: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#FDE68A'
  },
  savingsBannerText: {
    color: '#92400E',
    fontSize: 13,
    flex: 1
  },
  boldText: {
    fontWeight: '800'
  },
  priceHighlight: {
    fontWeight: '900',
    color: '#78350F'
  }
});
