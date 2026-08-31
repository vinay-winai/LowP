import React from 'react';
import { View, Text, Image, StyleSheet, TouchableOpacity, Linking } from 'react-native';
import { StoreResult } from '../types';
import { ExternalLink, CheckCircle2, XCircle, Sparkles, ChevronLeft, ChevronRight, Search } from 'lucide-react-native';

interface StoreCardProps {
  store: StoreResult;
  isLoading: boolean;
  onCycleCandidate?: (direction: 'next' | 'prev') => void;
}

export const StoreCard: React.FC<StoreCardProps> = ({ store, isLoading, onCycleCandidate }) => {
  const hasPrice = store.isAvailable && store.priceBreakdown && store.priceBreakdown.finalPayable > 0;
  const isBlinkit = store.platformId === 'blinkit';
  const pillTextColor = isBlinkit ? '#111827' : '#FFFFFF';

  const candidatesCount = store.candidates ? store.candidates.length : (store.item ? 1 : 0);
  const currentIdx = store.selectedIndex || 0;
  const hasMultipleMatches = candidatesCount > 1;

  const productUrl = store.productUrl || store.globalUrl || store.searchUrl;
  const globalUrl = store.globalUrl || store.searchUrl || store.productUrl;
  const hasDistinctGlobal = globalUrl && productUrl && globalUrl !== productUrl;

  const handleOpenProduct = () => {
    if (productUrl && productUrl !== '#') {
      Linking.openURL(productUrl).catch(() => {});
    }
  };

  const handleOpenSearch = () => {
    if (globalUrl && globalUrl !== '#') {
      Linking.openURL(globalUrl).catch(() => {});
    }
  };

  return (
    <View style={[styles.card, store.isLowestPrice && styles.lowestPriceCard]}>
      {/* Header Bar */}
      <View style={styles.cardHeader}>
        <View style={styles.headerLeft}>
          <View style={[styles.storeBadge, { backgroundColor: store.logoColor }]}>
            <Text style={[styles.storeBadgeText, { color: pillTextColor }]}>
              {store.platformName}
            </Text>
          </View>

          {hasMultipleMatches && (
            <View style={styles.matchPill}>
              <Text style={styles.matchPillText}>
                Match {currentIdx + 1}/{candidatesCount}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.headerRight}>
          {store.isLowestPrice && hasPrice && (
            <View style={styles.lowestPriceBadge}>
              <Sparkles size={12} color="#92400E" />
              <Text style={styles.lowestPriceBadgeText}>Lowest Price</Text>
            </View>
          )}

          <View style={styles.statusIndicator}>
            {isLoading ? (
              <Text style={styles.searchingText}>Searching...</Text>
            ) : store.isAvailable ? (
              <View style={styles.inStockRow}>
                <CheckCircle2 size={13} color="#10B981" />
                <Text style={styles.inStockText}>Available</Text>
                {store.responseTimeMs !== undefined && (
                  <Text style={styles.responseTimeText}>• {(store.responseTimeMs / 1000).toFixed(2)}s</Text>
                )}
              </View>
            ) : (
              <View style={styles.outOfStockRow}>
                <XCircle size={13} color="#94A3B8" />
                <Text style={styles.outOfStockText}>
                  Unavailable{store.responseTimeMs !== undefined ? ` • ${(store.responseTimeMs / 1000).toFixed(2)}s` : ''}
                </Text>
              </View>
            )}
          </View>
        </View>
      </View>

      {/* Body */}
      {hasPrice && store.item ? (
        <View style={styles.cardBody}>
          <View style={styles.productRow}>
            {store.item.image &&
            store.item.image.startsWith('https://') ? (
              <Image
                source={{ uri: store.item.image }}
                style={styles.productImage}
                resizeMode="cover"
              />
            ) : (
              // No valid remote image: render a neutral placeholder instead
              // of firing failed/external requests (assets paths are not
              // valid RN uris and placeholder.com is a network round-trip).
              <View style={[styles.productImage, styles.productImagePlaceholder]}>
                <Text style={styles.productImagePlaceholderText}>🛒</Text>
              </View>
            )}
            <View style={styles.productDetails}>
              <Text style={styles.productTitle} numberOfLines={2}>
                {store.item.title}
              </Text>
              <Text style={styles.productSubtitle} numberOfLines={1}>
                {store.item.brand} • {store.item.quantity}
              </Text>
            </View>

            {/* Side Cycle Arrows */}
            {hasMultipleMatches && (
              <View style={styles.sideCycleContainer}>
                <TouchableOpacity
                  style={styles.cycleArrowButton}
                  onPress={() => onCycleCandidate?.('prev')}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 5 }}
                >
                  <ChevronLeft size={16} color="#94A3B8" />
                </TouchableOpacity>

                <View style={styles.cycleIndicatorPill}>
                  <Text style={styles.cycleIndicatorText}>
                    {currentIdx + 1}/{candidatesCount}
                  </Text>
                </View>

                <TouchableOpacity
                  style={styles.cycleArrowButton}
                  onPress={() => onCycleCandidate?.('next')}
                  hitSlop={{ top: 10, bottom: 10, left: 5, right: 10 }}
                >
                  <ChevronRight size={16} color="#38BDF8" />
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* Pricing Row */}
          <View style={styles.pricingRow}>
            <View style={styles.priceContainer}>
              <Text style={styles.currencySymbol}>₹</Text>
              <Text style={styles.priceValue}>{store.priceBreakdown!.finalPayable}</Text>
            </View>

            <View style={styles.actionButtonsRow}>
              {hasDistinctGlobal && (
                <TouchableOpacity style={styles.searchButton} onPress={handleOpenSearch}>
                  <Search size={12} color="#94A3B8" />
                  <Text style={styles.searchButtonText}>Search</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.openButton} onPress={handleOpenProduct}>
                <ExternalLink size={13} color="#38BDF8" />
                <Text style={styles.openButtonText}>View</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      ) : (
        <View style={styles.emptyBody}>
          <Text style={styles.emptyText}>
            {isLoading ? 'Fetching live store price...' : 'No matching items found in this store zone'}
          </Text>
          {!isLoading && globalUrl && globalUrl !== '#' && (
            <TouchableOpacity style={styles.emptySearchButton} onPress={handleOpenSearch}>
              <Search size={12} color="#38BDF8" />
              <Text style={styles.emptySearchButtonText}>Search on {store.platformName}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#1E293B',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#334155'
  },
  lowestPriceCard: {
    borderColor: '#F59E0B',
    borderWidth: 1.5,
    backgroundColor: '#1E293B'
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(51, 65, 85, 0.6)'
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  storeBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6
  },
  storeBadgeText: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.2
  },
  matchPill: {
    backgroundColor: '#334155',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 10
  },
  matchPillText: {
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: '700'
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  lowestPriceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FDE68A',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12
  },
  lowestPriceBadgeText: {
    color: '#92400E',
    fontSize: 11,
    fontWeight: '800'
  },
  statusIndicator: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  searchingText: {
    color: '#38BDF8',
    fontSize: 12,
    fontWeight: '500'
  },
  inStockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4
  },
  inStockText: {
    color: '#10B981',
    fontSize: 12,
    fontWeight: '600'
  },
  responseTimeText: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '500'
  },
  outOfStockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4
  },
  outOfStockText: {
    color: '#64748B',
    fontSize: 12
  },
  cardBody: {
    paddingTop: 12
  },
  productRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12
  },
  productImage: {
    width: 54,
    height: 54,
    borderRadius: 8,
    backgroundColor: '#0F172A'
  },
  productImagePlaceholder: {
    alignItems: 'center',
    justifyContent: 'center'
  },
  productImagePlaceholderText: {
    fontSize: 22
  },
  productDetails: {
    flex: 1
  },
  productTitle: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 19
  },
  productSubtitle: {
    color: '#94A3B8',
    fontSize: 12,
    marginTop: 3
  },
  sideCycleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    borderRadius: 20,
    paddingHorizontal: 4,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: '#334155',
    gap: 2
  },
  cycleArrowButton: {
    padding: 3,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center'
  },
  cycleIndicatorPill: {
    paddingHorizontal: 3
  },
  cycleIndicatorText: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '700'
  },
  pricingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(51, 65, 85, 0.4)'
  },
  priceContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 2
  },
  currencySymbol: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '700'
  },
  priceValue: {
    color: '#F8FAFC',
    fontSize: 20,
    fontWeight: '800'
  },
  actionButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6
  },
  searchButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)'
  },
  searchButtonText: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '600'
  },
  openButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(56, 189, 248, 0.12)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.3)'
  },
  openButtonText: {
    color: '#38BDF8',
    fontSize: 12,
    fontWeight: '600'
  },
  emptyBody: {
    paddingVertical: 14,
    alignItems: 'center'
  },
  emptyText: {
    color: '#64748B',
    fontSize: 13,
    textAlign: 'center'
  },
  emptySearchButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 8,
    backgroundColor: 'rgba(56, 189, 248, 0.08)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.2)'
  },
  emptySearchButtonText: {
    color: '#38BDF8',
    fontSize: 11,
    fontWeight: '600'
  }
});
