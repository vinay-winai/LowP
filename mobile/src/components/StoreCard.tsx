import React from 'react';
import { View, Text, Image, StyleSheet, TouchableOpacity, Linking, ActivityIndicator } from 'react-native';
import { StoreResult } from '../types';
import {productSearchTitle} from '../core/ProductSearch';

interface StoreCardProps {
  store: StoreResult;
  isLoading: boolean;
  selectionDisabled?: boolean;
  onSelectCandidate: (index: number) => void;
  onSearchTitle: (title: string) => void;
  selectionMode?: 'compare' | 'title';
  onOpenLink?: (url: string, title: string, color?: string) => void;
}

export const StoreCard: React.FC<StoreCardProps> = ({ store, isLoading, selectionDisabled, onSelectCandidate, onSearchTitle, onOpenLink, selectionMode = 'compare' }) => {
  const candidates = (store.candidates?.length ? store.candidates : store.item ? [store.item] : []).slice(0, 3);
  const open = (url: string, title: string) => {
    if (!url || url === '#') return;
    if (onOpenLink) onOpenLink(url, title, store.logoColor);
    else Linking.openURL(url).catch(() => {});
  };
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={[styles.dot, { backgroundColor: store.logoColor }]} />
        <Text style={styles.name}>{store.platformName}</Text>
        {isLoading ? <ActivityIndicator size="small" color="#2563EB" /> :
          store.responseTimeMs !== undefined ? <Text style={styles.time}>{(store.responseTimeMs / 1000).toFixed(2)}s</Text> : null}
      </View>
      {candidates.map((item, index) => (
        <View key={`${item.id}_${index}`} style={styles.row}>
          <View style={styles.product}>
            <TouchableOpacity disabled={selectionDisabled} accessibilityRole="button" accessibilityLabel={`${selectionMode === 'title' ? 'Use title' : 'Compare'} ${item.title}, ₹${item.price}, from ${store.platformName}`} onPress={() => onSelectCandidate(index)}>
            {item.image?.startsWith('https://') ? <Image source={{ uri: item.image }} style={styles.image} resizeMode="contain" /> :
              <View style={[styles.image, styles.placeholder]}><Text style={styles.muted}>Item</Text></View>}
            </TouchableOpacity>
            <View style={styles.details}>
              <View style={styles.titleRow}><TouchableOpacity style={{flex: 1}} disabled={selectionDisabled} accessibilityRole="button" accessibilityLabel={`${selectionMode === 'title' ? 'Use title' : 'Compare'} ${item.title}, ₹${item.price}, from ${store.platformName}`} onPress={() => onSelectCandidate(index)}><Text style={styles.title} numberOfLines={3}>{item.title}</Text></TouchableOpacity><TouchableOpacity style={styles.titleSearch} disabled={selectionDisabled} accessibilityRole="button" accessibilityLabel={`Search for ${productSearchTitle(item)}`} onPress={() => onSearchTitle(productSearchTitle(item))}><Text style={styles.compare}>{selectionMode === 'title' ? 'Use title' : 'Search'}</Text></TouchableOpacity></View>
              <TouchableOpacity disabled={selectionDisabled} onPress={() => onSelectCandidate(index)}>
              {!!item.quantity && <Text style={styles.muted}>{item.quantity}</Text>}
              {selectionMode === 'compare' && store.comparisonMatch && index === 0 && <Text style={styles.compare}>In your comparison</Text>}
              <View style={styles.priceRow}>
                <Text style={styles.price}>₹{item.price}</Text>
                <Text style={styles.compare}>{selectionMode === 'title' ? (selectionDisabled ? 'Finding titles…' : 'Use this title →') : selectionDisabled ? 'Compare after search' : 'Compare this →'}</Text>
              </View>
              </TouchableOpacity>
            </View>
          </View>
          <TouchableOpacity style={styles.link} accessibilityRole="link" accessibilityLabel={`View ${item.title} on ${store.platformName}`}
            onPress={() => open(item.productUrl || store.searchUrl || store.productUrl, item.title)}>
            <Text style={styles.linkText}>View in store ↗</Text>
          </TouchableOpacity>
        </View>
      ))}
      {!candidates.length && <View style={styles.empty}>
        <Text style={styles.muted}>{isLoading ? 'Finding products…' : store.statusMessage === 'Ready to search' ? 'Ready to search' : store.statusMessage === 'Sign in required' ? 'This store requires sign-in to search. Open it from Store Sync, sign in, then try again.' : 'No products returned. Try again or enable Limit searches. Check your account and delivery location.'}</Text>
        {!isLoading && store.searchUrl && <TouchableOpacity style={styles.link} onPress={() => open(store.searchUrl!, store.platformName)}>
          <Text style={styles.linkText}>Search in store ↗</Text>
        </TouchableOpacity>}
      </View>}
    </View>
  );
};
const styles = StyleSheet.create({
  titleRow: {flexDirection: 'row', alignItems: 'flex-start', gap: 6}, titleSearch: {minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'center'},
  card: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12, marginBottom: 12, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14, backgroundColor: '#F8FAFC' },
  dot: { width: 8, height: 8, borderRadius: 4 }, name: { flex: 1, color: '#0F172A', fontWeight: '700', fontSize: 14 },
  time: { color: '#64748B', fontSize: 11 }, row: { borderTopWidth: 1, borderTopColor: '#E2E8F0', padding: 14 },
  product: { flexDirection: 'row', gap: 12, minHeight: 76 }, image: { width: 64, height: 64, borderRadius: 8, backgroundColor: '#F8FAFC' },
  placeholder: { alignItems: 'center', justifyContent: 'center' }, details: { flex: 1 },
  title: { color: '#0F172A', fontSize: 14, fontWeight: '500', lineHeight: 20 }, muted: { color: '#64748B', fontSize: 12, lineHeight: 18 },
  priceRow: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 8 },
  price: { color: '#0F172A', fontSize: 18, fontWeight: '700' }, compare: { color: '#1D4ED8', fontSize: 12, fontWeight: '600' },
  link: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-end' }, linkText: { color: '#475569', fontSize: 12 },
  empty: { padding: 14 }
});
