import React, {useState} from 'react';
import {Modal, View, Text, TouchableOpacity, ScrollView, TextInput, StyleSheet, KeyboardAvoidingView, Platform} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {PlatformId} from '../types';
import {StoreOffers, StoreOffer} from '../core/StoreOffers';

interface Props {visible: boolean; onClose: () => void; stores: {platformId: PlatformId; platformName: string}[]; offers: StoreOffers; onSave: (id: PlatformId, offer: StoreOffer) => Promise<boolean>;}
export function SettingsModal({visible, onClose, stores, offers, onSave}: Props) {
  const [page, setPage] = useState<'settings' | 'offers'>('settings');
  const [selected, setSelected] = useState<PlatformId | null>(null);
  const [percent, setPercent] = useState('');
  const [tiers, setTiers] = useState<{threshold: string; cashback: string}[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const back = () => {setError(''); if (selected) setSelected(null); else if (page === 'offers') setPage('settings'); else onClose();};
  const openStore = (id: PlatformId) => {setSelected(id); setPercent(String(offers[id]?.cardPercent || 0)); setTiers((offers[id]?.tiers || []).map(tier => ({threshold: String(tier.threshold), cashback: String(tier.cashback)}))); setError('');};
  const save = async () => {
    const number = (text: string) => /^\d+(\.\d{1,2})?$/.test(text.trim()) ? Number(text) : NaN;
    const cardPercent = percent.trim() ? number(percent) : 0;
    const levels = tiers.map(tier => ({threshold: number(tier.threshold), cashback: number(tier.cashback)})).sort((a, b) => a.threshold - b.threshold);
    if (!Number.isFinite(cardPercent) || cardPercent < 0 || cardPercent > 100) {setError('Enter a card discount from 0 to 100%.'); return;}
    if (levels.some((tier, index) => !Number.isFinite(tier.threshold) || tier.threshold <= 0 || !Number.isFinite(tier.cashback) || tier.cashback < 0 || (index > 0 && (tier.threshold <= levels[index - 1].threshold || tier.cashback < levels[index - 1].cashback)))) {setError('Use positive, unique milestones with cashback that stays the same or increases.'); return;}
    if (!selected) return;
    setSaving(true);
    try {if (await onSave(selected, {cardPercent, tiers: levels})) setSelected(null); else setError('Could not save offers. Please try again.');} finally {setSaving(false);}
  };
  return <Modal visible={visible} animationType="slide" onRequestClose={back}><SafeAreaView style={styles.page}>
    <View style={styles.header}><TouchableOpacity accessibilityLabel="Back from settings" style={styles.button} onPress={back}><Text style={styles.blue}>Back</Text></TouchableOpacity><Text style={styles.heading}>{selected ? stores.find(store => store.platformId === selected)?.platformName : page === 'offers' ? 'Store discounts & cashback' : 'Settings'}</Text><TouchableOpacity style={styles.button} onPress={() => {setSelected(null); setPage('settings'); onClose();}}><Text style={styles.blue}>Done</Text></TouchableOpacity></View>
    <KeyboardAvoidingView style={{flex: 1}} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {page === 'settings' ? <TouchableOpacity style={styles.card} accessibilityLabel="Store discounts and cashback settings" onPress={() => setPage('offers')}><Text style={styles.title}>Store discounts & cashback →</Text><Text style={styles.note}>Add card offers and spending milestones for each store.</Text></TouchableOpacity> : !selected ? <>
        <Text style={styles.note}>Offers are saved on this device and applied to comparison basket totals.</Text>
        {stores.map(store => <TouchableOpacity key={store.platformId} style={styles.card} accessibilityLabel={`Configure offers for ${store.platformName}`} onPress={() => openStore(store.platformId)}><Text style={styles.title}>{store.platformName} →</Text><Text style={styles.note}>{offers[store.platformId]?.cardPercent || 0}% card discount · {offers[store.platformId]?.tiers.length || 0} cashback levels</Text></TouchableOpacity>)}
      </> : <View style={styles.card}>
        <Text style={styles.title}>Card offer</Text><Text style={styles.note}>Percentage off the product subtotal. Use 0 for no discount.</Text>
        <TextInput style={styles.input} accessibilityLabel="Card discount percent" keyboardType="decimal-pad" value={percent} onChangeText={setPercent} placeholder="Discount %" />
        <Text style={styles.title}>Cashback milestones</Text><Text style={styles.note}>Based on the subtotal before card discount. The highest eligible cashback applies; levels are not added together. Cashback is deducted from estimated cost, not the checkout payment.</Text>
        {tiers.map((tier, index) => <View key={index} style={styles.tier}><Text style={styles.note}>Level {index + 1}</Text><TextInput style={styles.input} accessibilityLabel={`Cashback milestone ${index + 1}`} keyboardType="decimal-pad" placeholder="Spend at least ₹" value={tier.threshold} onChangeText={text => setTiers(tiers.map((value, i) => i === index ? {...value, threshold: text} : value))} /><TextInput style={styles.input} accessibilityLabel={`Cashback amount ${index + 1}`} keyboardType="decimal-pad" placeholder="Cashback ₹" value={tier.cashback} onChangeText={text => setTiers(tiers.map((value, i) => i === index ? {...value, cashback: text} : value))} /><TouchableOpacity style={styles.button} onPress={() => setTiers(tiers.filter((_, i) => i !== index))}><Text style={styles.blue}>Remove level</Text></TouchableOpacity></View>)}
        <TouchableOpacity style={styles.button} accessibilityLabel="Add cashback level" onPress={() => setTiers([...tiers, {threshold: '', cashback: ''}])}><Text style={styles.blue}>+ Add cashback level</Text></TouchableOpacity>
        {!!error && <Text style={{color: '#B91C1C'}}>{error}</Text>}
        <TouchableOpacity style={styles.save} disabled={saving} accessibilityLabel="Save store offers" onPress={save}><Text style={{color: '#FFFFFF', fontWeight: '600'}}>{saving ? 'Saving…' : 'Save offers'}</Text></TouchableOpacity>
      </View>}
    </ScrollView></KeyboardAvoidingView>
  </SafeAreaView></Modal>;
}
const styles = StyleSheet.create({page: {flex: 1, backgroundColor: '#F8FAFC'}, header: {flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', padding: 12}, heading: {flex: 1, fontWeight: '700', color: '#0F172A', fontSize: 18}, button: {minHeight: 44, justifyContent: 'center', paddingHorizontal: 8}, blue: {color: '#1D4ED8', fontWeight: '600'}, content: {padding: 16, gap: 14, paddingBottom: 40}, card: {backgroundColor: '#FFFFFF', padding: 16, borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0', gap: 10}, title: {fontSize: 16, fontWeight: '600', color: '#0F172A'}, note: {fontSize: 13, lineHeight: 20, color: '#475569'}, input: {borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 8, padding: 12, color: '#0F172A', fontSize: 16}, tier: {borderTopWidth: 1, borderTopColor: '#E2E8F0', paddingTop: 12, gap: 8}, save: {minHeight: 48, backgroundColor: '#2563EB', borderRadius: 8, alignItems: 'center', justifyContent: 'center'}});
