import React, { useState } from 'react';
import { View, Text, Modal, StyleSheet, TouchableOpacity, ScrollView, Linking, Share, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StrategyMatrixRow, PlatformId } from '../types';
import { ComparisonEdit, parseComparisonPrice, refreshComparison } from '../core/ProductComparison';
import { StoreOffers, comparisonBaskets, calculateOffer } from '../core/StoreOffers';

interface Props { visible: boolean; rows: StrategyMatrixRow[]; offers: StoreOffers; onClose: () => void; onRemoveRow: (id: string) => void; onClearAll: () => void; onEditCell: (rowId: string, platform: PlatformId, edit: ComparisonEdit) => void; }
function OfferBreakdown({basket}: {basket: ReturnType<typeof calculateOffer>}) {
  return <View>
    {!!basket.discount && <Text style={styles.match}>{basket.cardPercent}% card discount applied · ₹{basket.discount} subtracted</Text>}
    {!!basket.cashback && <Text style={styles.match}>₹{basket.reachedThreshold} milestone reached · ₹{basket.cashback} cashback subtracted</Text>}
    {(basket.discount > 0 || basket.cashback > 0) && <Text style={styles.note}>Product subtotal ₹{basket.subtotal} · Pay ₹{basket.payable} · Cost after cashback ₹{basket.effectiveTotal}</Text>}
    {basket.next && <Text style={styles.note}>₹{basket.next.remaining} more to reach ₹{basket.next.threshold} for an additional ₹{basket.next.additional} cashback.</Text>}
  </View>;
}
export const StrategyMatrixModal: React.FC<Props> = ({ visible, rows: savedRows, offers, onClose, onRemoveRow, onClearAll, onEditCell }) => {
  const rows = savedRows.map(refreshComparison);
  const [editor, setEditor] = useState<{rowId: string; platform: PlatformId; mode: 'swap' | 'price'} | null>(null);
  const [priceInput, setPriceInput] = useState('');
  const [priceError, setPriceError] = useState('');
  const editingRow = rows.find(row => row.id === editor?.rowId);
  const editingCell = editor && editingRow ? editingRow.stores[editor.platform] : null;
  const {complete, incomplete} = comparisonBaskets(rows, offers);
  return <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}><Text style={styles.heading}>Price comparison</Text><Text style={styles.muted}>{rows.length} selected {rows.length === 1 ? 'product' : 'products'}</Text></View>
        <TouchableOpacity style={styles.button} accessibilityLabel="Close price comparison" onPress={onClose}><Text style={styles.blue}>Done</Text></TouchableOpacity>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        {!rows.length ? <View style={styles.card}><Text style={styles.title}>Choose a product first</Text><Text style={styles.note}>Search, then tap one of the products in a store. Similar products from the other stores will appear here.</Text></View> : <>
          <View style={styles.card}><Text style={styles.title}>Complete store baskets</Text>
            {!complete.length && <Text style={styles.note}>No store has every selected item included in its total.</Text>}
            {complete.map((basket, index) => <View key={basket.id} style={[styles.cell, index === 0 && styles.best]}><View style={styles.cellHeader}><Text style={styles.store}>{basket.name}{index === 0 ? ' · Lowest total' : ''}</Text><Text style={styles.price}>₹{basket.effectiveTotal}</Text></View><OfferBreakdown basket={basket} /></View>)}
            <Text style={styles.note}>Product prices only. Delivery fees and checkout offers may differ. Check each match before buying.</Text>
          </View>
          {!!incomplete.length && <View style={styles.card}><Text style={styles.title}>Incomplete stores</Text>{incomplete.map(basket => <View key={basket.id} style={styles.cell}><View style={styles.cellHeader}><Text style={styles.store}>{basket.name} · {basket.count}/{rows.length} items included</Text><Text style={styles.price}>₹{basket.effectiveTotal}</Text></View><Text style={styles.muted}>Partial total after offers</Text><OfferBreakdown basket={basket} />{basket.missing.map((item, index) => <Text key={index} style={styles.note}>{item.excluded ? 'Excluded: ' : 'Missing: '}{item.title}{item.excluded ? ' · Price differs by more than 20%' : ''}</Text>)}</View>)}</View>}
          {rows.map(row => <View key={row.id} style={styles.card}>
            <View style={styles.rowHeader}><View style={{ flex: 1 }}><Text style={styles.title}>{row.query}</Text><Text style={styles.muted}>Selected from {row.anchorStoreId ? row.stores[row.anchorStoreId]?.platformName : 'search results'}</Text></View>
              <TouchableOpacity style={styles.button} accessibilityLabel={`Remove ${row.query}`} onPress={() => onRemoveRow(row.id)}><Text style={styles.muted}>Remove</Text></TouchableOpacity></View>
            {Object.values(row.stores).map(cell => <View key={cell.platformId} style={[styles.cell, cell.isCheapestInRow && styles.best]}>
              <TouchableOpacity disabled={!cell.candidates?.length} accessibilityRole="button"
                accessibilityLabel={`${cell.item ? 'Change' : 'Choose'} product for ${cell.platformName}`}
                onPress={() => setEditor({rowId: row.id, platform: cell.platformId, mode: 'swap'})}>
                <View style={styles.cellHeader}><Text style={styles.store}>{cell.platformName}</Text><Text style={styles.price}>{cell.isAvailable ? `₹${cell.price}` : '—'}</Text></View>
                <Text style={styles.muted}>{cell.item ? `${cell.item.title}${cell.item.quantity ? ` · ${cell.item.quantity}` : ''}` : 'No item selected'}</Text>
                {cell.isAvailable && <Text style={styles.match}>{cell.manuallySelected ? 'Selected by you' : cell.platformId === row.anchorStoreId ? 'Your selection' : 'Suggested match'}{cell.comparisonKind === 'different_pack' ? ' · Different pack size' : cell.comparisonKind === 'size_unknown' ? ' · Size not verified' : ''}{cell.isCheapestInRow ? ' · Lowest included price' : ''}</Text>}
                {cell.isAvailable && cell.isComparable === false && <Text style={styles.note}>Price differs by {Number((cell.priceDifferencePercent || 0).toFixed(1))}% from your selected item · Excluded from totals</Text>}
                {cell.includeInTotals && <Text style={styles.match}>Included in totals by you</Text>}
                {cell.originalPrice !== undefined && <Text style={styles.muted}>Edited price · Store price ₹{cell.originalPrice}</Text>}
              </TouchableOpacity>
              <View style={styles.actions}>
                {!!cell.candidates?.length && <TouchableOpacity style={styles.action} accessibilityLabel={`Swap item for ${cell.platformName}`} onPress={() => setEditor({rowId: row.id, platform: cell.platformId, mode: 'swap'})}><Text style={styles.blue}>{cell.item ? 'Swap item' : 'Choose item'}</Text></TouchableOpacity>}
                {cell.isAvailable && <>
                  {cell.isComparable === false && <TouchableOpacity style={styles.action} accessibilityLabel={`Include ${cell.platformName} item in totals`} onPress={() => onEditCell(row.id, cell.platformId, {kind: 'include'})}><Text style={styles.blue}>Include in totals</Text></TouchableOpacity>}
                  <TouchableOpacity style={styles.action} accessibilityLabel={`Edit price for ${cell.platformName}`} onPress={() => { setPriceInput(String(cell.price)); setPriceError(''); setEditor({rowId: row.id, platform: cell.platformId, mode: 'price'}); }}><Text style={styles.blue}>Edit price</Text></TouchableOpacity>
                  <TouchableOpacity style={styles.action} accessibilityLabel={`Remove item from ${cell.platformName}`} onPress={() => onEditCell(row.id, cell.platformId, {kind: 'remove'})}><Text style={styles.muted}>Remove item</Text></TouchableOpacity>
                  {cell.productUrl && cell.productUrl !== '#' && <TouchableOpacity style={styles.action} accessibilityRole="link" accessibilityLabel={`View ${cell.item?.title || cell.platformName} in store`} onPress={() => Linking.openURL(cell.productUrl).catch(() => {})}><Text style={styles.blue}>View in store ↗</Text></TouchableOpacity>}
                </>}
              </View>
            </View>)}
          </View>)}
          <TouchableOpacity style={styles.button} onPress={() => Share.share({ message: rows.map(row => `${row.query}\n${Object.values(row.stores).map(cell => `${cell.platformName}: ${cell.isAvailable ? `₹${cell.price} — ${cell.item?.title}` : 'No close match'}`).join('\n')}`).join('\n\n') + '\n\nProduct prices only; check matches and checkout fees.' }).catch(() => {})}><Text style={styles.blue}>Share comparison</Text></TouchableOpacity>
          <TouchableOpacity style={styles.button} onPress={onClearAll}><Text style={styles.muted}>Clear all comparisons</Text></TouchableOpacity>
        </>}
      </ScrollView>
      <Modal visible={visible && !!editor && !!editingCell} transparent animationType="fade" onRequestClose={() => setEditor(null)}>
        <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.editor}>
            <View style={styles.rowHeader}><Text style={[styles.title, {flex: 1}]}>{editor?.mode === 'swap' ? 'Choose a product' : 'Edit product price'}</Text><TouchableOpacity style={styles.button} accessibilityLabel="Cancel comparison edit" onPress={() => setEditor(null)}><Text style={styles.blue}>Cancel</Text></TouchableOpacity></View>
            <Text style={styles.muted}>{editingCell?.platformName}</Text>
            {editor?.mode === 'swap' ? <ScrollView>
              {editingCell?.candidates?.slice(0, 3).map((item, index) => {
                const selected = !!editingCell.item && editingCell.item.title === item.title && editingCell.item.quantity === item.quantity && (!editingCell.item.id || editingCell.item.id === item.id);
                return <TouchableOpacity key={index} style={[styles.choice, selected && styles.best]} accessibilityState={{selected}} accessibilityLabel={`Use ${item.title}, ₹${item.price}${selected ? ', current selection' : ''}`} onPress={() => { if (editor) onEditCell(editor.rowId, editor.platform, {kind: 'swap', index}); setEditor(null); }}>
                  <Text style={styles.title}>{item.title}</Text><Text style={styles.muted}>{item.quantity || 'Size not listed'}</Text><Text style={styles.price}>₹{item.price}</Text>{selected && <Text style={styles.match}>Current selection</Text>}
                </TouchableOpacity>;
              })}
            </ScrollView> : <>
              <Text style={[styles.note, {marginBottom: 12}]}>{editingCell?.item?.title}</Text>
              <TextInput style={styles.priceInput} accessibilityLabel="Comparison product price" keyboardType="decimal-pad" value={priceInput} onChangeText={value => {setPriceInput(value); setPriceError('');}} autoFocus selectTextOnFocus />
              {!!priceError && <Text style={styles.error}>{priceError}</Text>}
              <TouchableOpacity style={styles.save} accessibilityLabel="Save comparison price" onPress={() => { const price = parseComparisonPrice(priceInput); if (price === null) {setPriceError('Enter a price above zero, with up to two decimal places.'); return;} if (editor) onEditCell(editor.rowId, editor.platform, {kind: 'price', price}); setEditor(null); }}><Text style={styles.footerText}>Save price</Text></TouchableOpacity>
            </>}
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <TouchableOpacity style={styles.footer} onPress={onClose}><Text style={styles.footerText}>Search another product</Text></TouchableOpacity>
    </SafeAreaView>
  </Modal>;
};
const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 }, action: { minHeight: 44, justifyContent: 'center' },
  overlay: { flex: 1, justifyContent: 'center', padding: 20, backgroundColor: 'rgba(15,23,42,0.35)' },
  editor: { backgroundColor: '#FFFFFF', borderRadius: 12, padding: 16, maxHeight: '80%' }, choice: { borderTopWidth: 1, borderTopColor: '#E2E8F0', padding: 12, gap: 6 },
  priceInput: { color: '#0F172A', borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 8, padding: 12, fontSize: 20 }, error: { color: '#B91C1C', marginTop: 8 }, save: { backgroundColor: '#2563EB', borderRadius: 8, padding: 14, alignItems: 'center', marginTop: 16 },
  container: { flex: 1, backgroundColor: '#F8FAFC' }, header: { flexDirection: 'row', alignItems: 'center', padding: 16, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  heading: { fontSize: 20, fontWeight: '700', color: '#0F172A' }, muted: { fontSize: 12, color: '#64748B', lineHeight: 18 }, blue: { color: '#1D4ED8', fontWeight: '600', fontSize: 14 },
  content: { padding: 16, paddingBottom: 24 }, card: { padding: 16, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12, marginBottom: 14 },
  title: { fontSize: 16, color: '#0F172A', fontWeight: '600', lineHeight: 23 }, total: { fontSize: 28, color: '#0F172A', fontWeight: '700', marginVertical: 6 }, note: { fontSize: 12, color: '#475569', lineHeight: 19, marginTop: 8 },
  rowHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 }, button: { minHeight: 44, paddingHorizontal: 8, justifyContent: 'center', alignItems: 'center' },
  cell: { padding: 12, borderTopWidth: 1, borderTopColor: '#E2E8F0', gap: 5 }, best: { backgroundColor: '#F0FDF4' },
  cellHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, store: { flex: 1, fontSize: 13, fontWeight: '600', color: '#0F172A' }, price: { fontSize: 17, fontWeight: '700', color: '#0F172A' },
  match: { color: '#166534', fontSize: 11, lineHeight: 17 }, footer: { margin: 16, padding: 14, borderRadius: 10, alignItems: 'center', backgroundColor: '#2563EB' }, footerText: { color: '#FFFFFF', fontWeight: '600', fontSize: 14 }
});
