import React from 'react';
import {
  View,
  Text,
  Modal,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Linking,
  Share
} from 'react-native';
import {
  PlatformId,
  StrategyMatrixRow
} from '../types';
import {
  X,
  Sparkles,
  Trash2,
  ExternalLink,
  Share2,
  TrendingDown,
  ShoppingBag,
  CheckCircle2
} from 'lucide-react-native';

const STORES: { id: PlatformId; name: string; color: string }[] = [
  { id: 'amazon_tez', name: 'Amazon Tez', color: '#FF9900' },
  { id: 'instamart', name: 'Instamart', color: '#FC8019' },
  { id: 'zepto', name: 'Zepto', color: '#7C3AED' },
  { id: 'blinkit', name: 'Blinkit', color: '#F8CB46' },
  { id: 'amazon_main', name: 'Amazon.in', color: '#FF9900' },
  { id: 'flipkart', name: 'Flipkart', color: '#2874F0' }
];

interface StrategyMatrixModalProps {
  visible: boolean;
  rows: StrategyMatrixRow[];
  onClose: () => void;
  onRemoveRow: (rowId: string) => void;
  onClearAll: () => void;
}

export const StrategyMatrixModal: React.FC<StrategyMatrixModalProps> = ({
  visible,
  rows,
  onClose,
  onRemoveRow,
  onClearAll
}) => {
  if (!visible) return null;

  // 1. Calculate Single Store Totals
  const storeTotals: Record<PlatformId, { total: number; availableCount: number; missingCount: number }> = {
    amazon_tez: { total: 0, availableCount: 0, missingCount: 0 },
    instamart: { total: 0, availableCount: 0, missingCount: 0 },
    zepto: { total: 0, availableCount: 0, missingCount: 0 },
    blinkit: { total: 0, availableCount: 0, missingCount: 0 },
    amazon_main: { total: 0, availableCount: 0, missingCount: 0 },
    flipkart: { total: 0, availableCount: 0, missingCount: 0 }
  };

  let optimalSplitTotal = 0;
  let totalMrpSum = 0;

  rows.forEach((row) => {
    optimalSplitTotal += row.cheapestPrice > 0 ? row.cheapestPrice : 0;

    STORES.forEach((s) => {
      const cell = row.stores[s.id];
      if (cell && cell.isAvailable && cell.price > 0) {
        storeTotals[s.id].total += cell.price;
        storeTotals[s.id].availableCount += 1;
        totalMrpSum += cell.mrp || cell.price;
      } else {
        storeTotals[s.id].missingCount += 1;
      }
    });
  });

  // Find Best Single Store (with all or most items available)
  let bestSingleStoreId: PlatformId | null = null;
  let minSingleTotal = Infinity;

  STORES.forEach((s) => {
    const st = storeTotals[s.id];
    if (st.availableCount > 0 && st.missingCount === 0) {
      if (st.total < minSingleTotal) {
        minSingleTotal = st.total;
        bestSingleStoreId = s.id;
      }
    }
  });

  // If no store has 100% of items, find store with lowest partial total
  if (!bestSingleStoreId) {
    let maxItems = -1;
    STORES.forEach((s) => {
      const st = storeTotals[s.id];
      if (st.availableCount > maxItems || (st.availableCount === maxItems && st.total < minSingleTotal)) {
        maxItems = st.availableCount;
        minSingleTotal = st.total;
        bestSingleStoreId = s.id;
      }
    });
  }

  const bestSingleStore = STORES.find((s) => s.id === bestSingleStoreId);
  const arbitrageSavings = minSingleTotal < Infinity && optimalSplitTotal > 0 && minSingleTotal > optimalSplitTotal
    ? minSingleTotal - optimalSplitTotal
    : 0;

  const handleShareSummary = async () => {
    if (rows.length === 0) return;

    let text = `🛒 *LowP Strategy Matrix Summary* (${rows.length} items)\n\n`;
    rows.forEach((row, idx) => {
      const cheapestStore = STORES.find((s) => s.id === row.cheapestStoreId);
      text += `${idx + 1}. *${row.query}*: ₹${row.cheapestPrice} on ${cheapestStore?.name || 'Best Store'}\n`;
    });

    text += `\n⚡ *Optimal Split Total*: ₹${optimalSplitTotal}`;
    if (bestSingleStore) {
      text += `\n🏬 *Best Single Store*: ${bestSingleStore.name} (₹${minSingleTotal})`;
    }
    if (arbitrageSavings > 0) {
      text += `\n💰 *Arbitrage Savings*: Save ₹${arbitrageSavings} (${((arbitrageSavings / minSingleTotal) * 100).toFixed(1)}%) with multi-store split!`;
    }
    text += `\n\nCompared real-time with LowP`;

    try {
      await Share.share({ message: text });
    } catch (e) {}
  };

  const handleOpenLink = (url?: string) => {
    if (url && url !== '#') {
      Linking.openURL(url).catch(() => {});
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View style={styles.iconCircle}>
              <ShoppingBag size={20} color="#10B981" />
            </View>
            <View>
              <Text style={styles.headerTitle}>Strategy Matrix</Text>
              <Text style={styles.headerSubtitle}>
                {rows.length} {rows.length === 1 ? 'Item' : 'Items'} in Basket • Multi-Store Arbitrage
              </Text>
            </View>
          </View>

          <View style={styles.headerRight}>
            {rows.length > 0 && (
              <TouchableOpacity
                style={styles.shareBtn}
                onPress={handleShareSummary}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Share2 size={16} color="#38BDF8" />
              </TouchableOpacity>
            )}

            {rows.length > 0 && (
              <TouchableOpacity
                style={styles.clearBtn}
                onPress={onClearAll}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Trash2 size={16} color="#EF4444" />
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={styles.closeBtn}
              onPress={onClose}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <X size={20} color="#94A3B8" />
            </TouchableOpacity>
          </View>
        </View>

        {rows.length === 0 ? (
          <View style={styles.emptyState}>
            <ShoppingBag size={48} color="#475569" />
            <Text style={styles.emptyTitle}>Your Basket is Empty</Text>
            <Text style={styles.emptySub}>
              Search for items (e.g. Paneer 200g, Amul Butter 500g, Maggi) and tap "+ Add to Cart" to build your multi-store comparison matrix!
            </Text>
            <TouchableOpacity style={styles.emptyActionBtn} onPress={onClose}>
              <Text style={styles.emptyActionBtnText}>Search Groceries</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <ScrollView style={styles.scrollContainer} showsVerticalScrollIndicator={false}>
            {/* Strategy Summary Cards */}
            <View style={styles.summaryRow}>
              {/* Optimal Split Card */}
              <View style={[styles.summaryCard, styles.optimalCard]}>
                <View style={styles.summaryCardHeader}>
                  <Sparkles size={14} color="#10B981" />
                  <Text style={styles.optimalCardTitle}>Optimal Split Total</Text>
                </View>
                <Text style={styles.optimalPrice}>₹{optimalSplitTotal}</Text>
                {arbitrageSavings > 0 ? (
                  <View style={styles.savingsTag}>
                    <TrendingDown size={12} color="#10B981" />
                    <Text style={styles.savingsTagText}>
                      Save ₹{arbitrageSavings} ({((arbitrageSavings / minSingleTotal) * 100).toFixed(0)}%) vs single store
                    </Text>
                  </View>
                ) : (
                  <Text style={styles.summaryCardSub}>Cheapest multi-store combination</Text>
                )}
              </View>

              {/* Best Single Store Card */}
              {bestSingleStore && (
                <View style={styles.summaryCard}>
                  <View style={styles.summaryCardHeader}>
                    <CheckCircle2 size={14} color="#38BDF8" />
                    <Text style={styles.summaryCardTitle}>Best Single Store</Text>
                  </View>
                  <Text style={styles.summaryCardPrice}>₹{minSingleTotal}</Text>
                  <Text style={[styles.storePillText, { color: bestSingleStore.color, fontWeight: '700' }]}>
                    {bestSingleStore.name}
                  </Text>
                </View>
              )}
            </View>

            {/* Matrix Table */}
            <View style={styles.matrixWrapper}>
              <ScrollView horizontal showsHorizontalScrollIndicator={true}>
                <View>
                  {/* Table Column Headers */}
                  <View style={styles.tableHeaderRow}>
                    <View style={[styles.cell, styles.itemHeaderCell]}>
                      <Text style={styles.tableHeaderText}>Search Item</Text>
                    </View>
                    {STORES.map((s) => (
                      <View key={s.id} style={[styles.cell, styles.storeHeaderCell]}>
                        <View style={[styles.storeDot, { backgroundColor: s.color }]} />
                        <Text style={[styles.storeHeaderText, { color: s.color }]} numberOfLines={1}>
                          {s.name}
                        </Text>
                      </View>
                    ))}
                  </View>

                  {/* Table Body (Rows) */}
                  {rows.map((row, rowIdx) => (
                    <View
                      key={row.id}
                      style={[
                        styles.tableRow,
                        rowIdx % 2 === 1 && styles.tableRowAlt
                      ]}
                    >
                      {/* Item Title Cell */}
                      <View style={[styles.cell, styles.itemCell]}>
                        <View style={styles.itemTitleContainer}>
                          <Text style={styles.itemQueryText} numberOfLines={2}>
                            {row.query}
                          </Text>
                          <TouchableOpacity
                            style={styles.rowDeleteBtn}
                            onPress={() => onRemoveRow(row.id)}
                            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                          >
                            <Trash2 size={13} color="#64748B" />
                          </TouchableOpacity>
                        </View>
                      </View>

                      {/* Store Cells */}
                      {STORES.map((s) => {
                        const cell = row.stores[s.id];
                        const isCheapest = cell && cell.isCheapestInRow && cell.price > 0;

                        return (
                          <TouchableOpacity
                            key={s.id}
                            style={[
                              styles.cell,
                              styles.storeCell,
                              isCheapest && styles.cheapestCell
                            ]}
                            onPress={() => handleOpenLink(cell?.productUrl)}
                            activeOpacity={0.7}
                          >
                            {cell && cell.isAvailable && cell.price > 0 ? (
                              <View style={styles.cellContent}>
                                {isCheapest && (
                                  <View style={styles.cheapestBadge}>
                                    <Text style={styles.cheapestBadgeText}>🏆 Lowest</Text>
                                  </View>
                                )}
                                <Text
                                  style={[
                                    styles.cellPrice,
                                    isCheapest && styles.cheapestCellPrice
                                  ]}
                                >
                                  ₹{cell.price}
                                </Text>

                                {cell.item?.title ? (
                                  <Text style={styles.cellItemTitle} numberOfLines={1}>
                                    {cell.item.title}
                                  </Text>
                                ) : null}

                                <View style={styles.cellFooter}>
                                  <ExternalLink size={10} color="#64748B" />
                                </View>
                              </View>
                            ) : (
                              <View style={styles.unavailableCell}>
                                <Text style={styles.unavailableText}>—</Text>
                                <Text style={styles.unavailableSub}>Out of Stock</Text>
                              </View>
                            )}
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  ))}

                  {/* Table Footer: Column Totals */}
                  <View style={styles.tableFooterRow}>
                    <View style={[styles.cell, styles.itemHeaderCell]}>
                      <Text style={styles.footerLabel}>Basket Total</Text>
                      <Text style={styles.footerSub}>Single Store</Text>
                    </View>

                    {STORES.map((s) => {
                      const st = storeTotals[s.id];
                      const isBestStore = s.id === bestSingleStoreId;

                      return (
                        <View
                          key={s.id}
                          style={[
                            styles.cell,
                            styles.footerStoreCell,
                            isBestStore && styles.bestStoreFooterCell
                          ]}
                        >
                          {isBestStore && (
                            <View style={styles.bestStoreBadge}>
                              <Text style={styles.bestStoreBadgeText}>Best Single</Text>
                            </View>
                          )}
                          <Text
                            style={[
                              styles.footerPrice,
                              isBestStore && styles.bestStoreFooterPrice
                            ]}
                          >
                            ₹{st.total}
                          </Text>
                          <Text style={styles.footerItemCount}>
                            {st.availableCount}/{rows.length} items
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                </View>
              </ScrollView>
            </View>

            {/* Bottom Actions */}
            <View style={styles.bottomActions}>
              <TouchableOpacity style={styles.continueShoppingBtn} onPress={onClose}>
                <Text style={styles.continueShoppingText}>+ Add More Items to Basket</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        )}
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B1120'
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#0F172A',
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B'
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#F8FAFC'
  },
  headerSubtitle: {
    fontSize: 11,
    color: '#94A3B8'
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12
  },
  shareBtn: {
    padding: 6,
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    borderRadius: 8
  },
  clearBtn: {
    padding: 6,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderRadius: 8
  },
  closeBtn: {
    padding: 6,
    backgroundColor: '#1E293B',
    borderRadius: 8
  },
  scrollContainer: {
    flex: 1,
    padding: 14
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14
  },
  summaryCard: {
    flex: 1,
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#334155'
  },
  optimalCard: {
    borderColor: '#10B981',
    backgroundColor: 'rgba(16, 185, 129, 0.08)'
  },
  summaryCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 4
  },
  optimalCardTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#10B981',
    textTransform: 'uppercase'
  },
  summaryCardTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#38BDF8',
    textTransform: 'uppercase'
  },
  optimalPrice: {
    fontSize: 22,
    fontWeight: '900',
    color: '#10B981'
  },
  summaryCardPrice: {
    fontSize: 20,
    fontWeight: '800',
    color: '#F8FAFC'
  },
  summaryCardSub: {
    fontSize: 10,
    color: '#94A3B8',
    marginTop: 2
  },
  savingsTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: 4
  },
  savingsTagText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#10B981'
  },
  storePillText: {
    fontSize: 12,
    marginTop: 2
  },
  matrixWrapper: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    overflow: 'hidden',
    marginBottom: 16
  },
  tableHeaderRow: {
    flexDirection: 'row',
    backgroundColor: '#0F172A',
    borderBottomWidth: 1,
    borderBottomColor: '#334155'
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
    backgroundColor: '#1E293B'
  },
  tableRowAlt: {
    backgroundColor: '#172033'
  },
  tableFooterRow: {
    flexDirection: 'row',
    backgroundColor: '#0F172A',
    borderTopWidth: 2,
    borderTopColor: '#334155'
  },
  cell: {
    padding: 10,
    justifyContent: 'center'
  },
  itemHeaderCell: {
    width: 140,
    borderRightWidth: 1,
    borderRightColor: '#334155'
  },
  storeHeaderCell: {
    width: 125,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRightWidth: 1,
    borderRightColor: '#334155'
  },
  storeDot: {
    width: 8,
    height: 8,
    borderRadius: 4
  },
  tableHeaderText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#94A3B8',
    textTransform: 'uppercase'
  },
  storeHeaderText: {
    fontSize: 12,
    fontWeight: '800'
  },
  itemCell: {
    width: 140,
    borderRightWidth: 1,
    borderRightColor: '#334155'
  },
  itemTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 4
  },
  itemQueryText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
    color: '#F8FAFC'
  },
  rowDeleteBtn: {
    padding: 4
  },
  storeCell: {
    width: 125,
    borderRightWidth: 1,
    borderRightColor: '#334155'
  },
  cheapestCell: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderColor: '#10B981'
  },
  cellContent: {
    gap: 2
  },
  cheapestBadge: {
    backgroundColor: '#10B981',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
    alignSelf: 'flex-start',
    marginBottom: 2
  },
  cheapestBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#0F172A',
    textTransform: 'uppercase'
  },
  cellPrice: {
    fontSize: 15,
    fontWeight: '800',
    color: '#F8FAFC'
  },
  cheapestCellPrice: {
    color: '#10B981'
  },
  cellItemTitle: {
    fontSize: 10,
    color: '#94A3B8'
  },
  cellFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2
  },
  unavailableCell: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2
  },
  unavailableText: {
    fontSize: 14,
    color: '#64748B'
  },
  unavailableSub: {
    fontSize: 9,
    color: '#475569'
  },
  footerLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: '#F8FAFC'
  },
  footerSub: {
    fontSize: 10,
    color: '#64748B'
  },
  footerStoreCell: {
    width: 125,
    borderRightWidth: 1,
    borderRightColor: '#334155',
    alignItems: 'flex-start'
  },
  bestStoreFooterCell: {
    backgroundColor: 'rgba(16, 185, 129, 0.12)'
  },
  bestStoreBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#10B981',
    marginBottom: 2
  },
  bestStoreBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#10B981',
    textTransform: 'uppercase'
  },
  footerPrice: {
    fontSize: 15,
    fontWeight: '900',
    color: '#F8FAFC'
  },
  bestStoreFooterPrice: {
    color: '#10B981'
  },
  footerItemCount: {
    fontSize: 10,
    color: '#94A3B8',
    marginTop: 1
  },
  bottomActions: {
    marginTop: 6,
    marginBottom: 24
  },
  continueShoppingBtn: {
    backgroundColor: '#10B981',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center'
  },
  continueShoppingText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A'
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 12
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#F8FAFC',
    marginTop: 8
  },
  emptySub: {
    fontSize: 13,
    color: '#94A3B8',
    textAlign: 'center',
    lineHeight: 18
  },
  emptyActionBtn: {
    marginTop: 12,
    backgroundColor: '#10B981',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10
  },
  emptyActionBtnText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A'
  }
});
