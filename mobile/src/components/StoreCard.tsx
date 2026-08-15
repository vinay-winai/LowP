import React from 'react';
import { View, Text, Image, StyleSheet, TouchableOpacity, Linking } from 'react-native';
import { StoreResult } from '../types';
import { ExternalLink, CheckCircle2, XCircle, Sparkles } from 'lucide-react-native';

interface StoreCardProps {
  store: StoreResult;
  isLoading: boolean;
}

export const StoreCard: React.FC<StoreCardProps> = ({ store, isLoading }) => {
  const hasPrice = store.isAvailable && store.priceBreakdown && store.priceBreakdown.finalPayable > 0;
  const isBlinkit = store.platformId === 'blinkit';
  const pillTextColor = isBlinkit ? '#111827' : '#FFFFFF';

  const handleOpenStore = () => {
    if (store.productUrl && store.productUrl !== '#') {
      Linking.openURL(store.productUrl).catch(() => {});
    }
  };

  return (
    <View style={[styles.card, store.isLowestPrice && styles.lowestPriceCard]}>
      {/* Header Bar */}
      <View style={styles.cardHeader}>
        <View style={[styles.storeBadge, { backgroundColor: store.logoColor }]}>
          <Text style={[styles.storeBadgeText, { color: pillTextColor }]}>
            {store.platformName}
          </Text>
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
              </View>
            ) : (
              <View style={styles.outOfStockRow}>
                <XCircle size={13} color="#94A3B8" />
                <Text style={styles.outOfStockText}>Unavailable</Text>
              </View>
            )}
          </View>
        </View>
      </View>

      {/* Body */}
      {hasPrice && store.item ? (
        <View style={styles.cardBody}>
          <View style={styles.productRow}>
            <Image
              source={{ uri: store.item.image || 'https://via.placeholder.com/60' }}
              style={styles.productImage}
              resizeMode="cover"
            />
            <View style={styles.productDetails}>
              <Text style={styles.productTitle} numberOfLines={2}>
                {store.item.title}
              </Text>
              <Text style={styles.productSubtitle} numberOfLines={1}>
                {store.item.brand} • {store.item.quantity}
              </Text>
            </View>
          </View>

          {/* Pricing Row */}
          <View style={styles.pricingRow}>
            <View style={styles.priceContainer}>
              <Text style={styles.currencySymbol}>₹</Text>
              <Text style={styles.priceValue}>{store.priceBreakdown!.finalPayable}</Text>
              {store.item.mrp > store.item.price && (
                <Text style={styles.mrpText}>MRP ₹{store.item.mrp}</Text>
              )}
            </View>

            {store.priceBreakdown!.savings > 0 && (
              <View style={styles.savingsPill}>
                <Text style={styles.savingsText}>
                  Save ₹{store.priceBreakdown!.savings} ({store.priceBreakdown!.discountPercent}% OFF)
                </Text>
              </View>
            )}

            <TouchableOpacity style={styles.openButton} onPress={handleOpenStore}>
              <ExternalLink size={14} color="#38BDF8" />
              <Text style={styles.openButtonText}>View</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <View style={styles.emptyBody}>
          <Text style={styles.emptyText}>
            {isLoading ? 'Fetching live store price...' : 'No matching items found in this store zone'}
          </Text>
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
  outOfStockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4
  },
  outOfStockText: {
    color: '#94A3B8',
    fontSize: 12
  },
  cardBody: {
    paddingTop: 10
  },
  productRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center'
  },
  productImage: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: '#334155'
  },
  productDetails: {
    flex: 1
  },
  productTitle: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 18
  },
  productSubtitle: {
    color: '#94A3B8',
    fontSize: 12,
    marginTop: 2
  },
  pricingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(51, 65, 85, 0.4)'
  },
  priceContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 2
  },
  currencySymbol: {
    color: '#10B981',
    fontSize: 16,
    fontWeight: '700'
  },
  priceValue: {
    color: '#F8FAFC',
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.5
  },
  mrpText: {
    color: '#64748B',
    fontSize: 13,
    textDecorationLine: 'line-through',
    marginLeft: 6
  },
  savingsPill: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)'
  },
  savingsText: {
    color: '#10B981',
    fontSize: 11,
    fontWeight: '700'
  },
  openButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(56, 189, 248, 0.1)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.3)'
  },
  openButtonText: {
    color: '#38BDF8',
    fontSize: 12,
    fontWeight: '700'
  },
  emptyBody: {
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center'
  },
  emptyText: {
    color: '#64748B',
    fontSize: 13,
    fontStyle: 'italic'
  }
});
