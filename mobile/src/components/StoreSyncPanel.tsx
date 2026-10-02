import React, {useEffect, useRef, useState} from 'react';
import {Alert, Animated, Easing, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {ChevronDown, CircleAlert, MapPin, RefreshCw, X} from 'lucide-react-native';
import {PlatformId} from '../types';
import {currentSession, SESSION_LABELS, StoreSession, StoreLocation, LOCATION_LABELS, SESSION_TTL_MS} from '../core/StoreSession';
import {FALLBACK_ADDRESS_STORAGE_KEY, addressPin, normalizePinInput, isValidPin} from '../core/StoreAddress';

interface Props {
  stores: {platformId: PlatformId; platformName: string}[];
  sessions: Partial<Record<PlatformId, StoreSession>>;
  syncing: boolean;
  paused: boolean;
  pendingCount: number;
  onRefresh: () => void;
  onOpenStore: (id: PlatformId) => void;
  onSetAddress: (id: PlatformId, address: string) => void;
  locations: Partial<Record<PlatformId, StoreLocation>>;
  searchBusy?: boolean;
  storeWindowOpen?: boolean;
}

export const StoreSyncPanel: React.FC<Props> = ({stores, sessions, locations, syncing, paused, pendingCount, onRefresh, onOpenStore, onSetAddress, searchBusy = false, storeWindowOpen = false}) => {
  const [expanded, setExpanded] = useState(false);
  const [address, setAddress] = useState('');
  const [savedAddress, setSavedAddress] = useState('');
  const [addressReady, setAddressReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const rotation = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!syncing) {rotation.stopAnimation(); rotation.setValue(0); return;}
    const animation = Animated.loop(Animated.timing(rotation, {toValue: 1, duration: 1100, easing: Easing.linear, useNativeDriver: true}));
    animation.start();
    return () => animation.stop();
  }, [syncing, rotation]);
  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(FALLBACK_ADDRESS_STORAGE_KEY).then(raw => {
      if (active) {const value = addressPin(raw || ''); setAddress(value); setSavedAddress(value);}
    }).catch(() => {}).finally(() => {if (active) setAddressReady(true);});
    return () => {active = false;};
  }, []);
  const save = async () => {
    const value = address;
    if (!isValidPin(value)) {setError('Enter a valid six-digit PIN code.'); Alert.alert('Enter the PIN code', 'Enter a valid six-digit PIN code to set the store location.'); return false;}
    setSaving(true); setError('');
    try {await AsyncStorage.setItem(FALLBACK_ADDRESS_STORAGE_KEY, value); setSavedAddress(value); setAddress(value); return true;}
    catch {setError('Could not save the address. Please try again.'); return false;}
    finally {setSaving(false);}
  };
  const status = syncing ? `Checking accounts · ${pendingCount} left` : paused ? 'Checks paused' : 'Accounts & delivery location';
  const unverifiedCount = stores.filter(store => currentSession(sessions[store.platformId]).status !== 'signed_in').length;
  const showWarning = pendingCount === 0 && !syncing && unverifiedCount > 0;
  return <>
    <TouchableOpacity style={styles.syncButton} accessibilityRole="button" accessibilityLabel={`Sync stores, ${status}${showWarning ? `, ${unverifiedCount} stores not confirmed signed in` : ''}`}
      accessibilityState={{expanded, busy: syncing}} onPress={() => setExpanded(true)}>
      <Animated.View style={{transform: [{rotate: rotation.interpolate({inputRange: [0, 1], outputRange: ['0deg', '360deg']})}]}}>
        <RefreshCw size={17} color={syncing ? '#1D4ED8' : '#475569'} />
      </Animated.View>
      <Text style={styles.syncLabel}>Sync</Text>
      {showWarning && <CircleAlert size={17} color="#B45309" />}
      <ChevronDown size={14} color="#64748B" />
    </TouchableOpacity>
    <Modal visible={expanded && !storeWindowOpen} transparent animationType="slide" onRequestClose={() => setExpanded(false)}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.overlay}>
        <TouchableOpacity style={StyleSheet.absoluteFill} accessibilityLabel="Close store sync" onPress={() => setExpanded(false)} />
        <View style={styles.sheet}>
          <View style={styles.headingRow}><View style={{flex: 1}}><Text style={styles.heading}>Store sync</Text><Text style={styles.hint} accessibilityLiveRegion="polite">{status}</Text></View>
            <TouchableOpacity style={styles.headerSyncButton} accessibilityRole="button" accessibilityLabel="Check all store accounts again" accessibilityState={{busy: syncing, disabled: syncing}} disabled={syncing} onPress={onRefresh}>
              <Animated.View style={{transform: [{rotate: rotation.interpolate({inputRange: [0, 1], outputRange: ['0deg', '360deg']})}]}}><RefreshCw size={17} color="#1D4ED8" /></Animated.View>
              <Text style={styles.actionText}>{syncing ? 'Syncing…' : 'Sync'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.iconButton} accessibilityLabel="Close store sync" onPress={() => setExpanded(false)}><X size={21} color="#475569" /></TouchableOpacity>
          </View>
          <ScrollView style={{flex:1}} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
            <View style={styles.addressBox}>
              <View style={styles.addressHeading}><MapPin size={17} color="#475569" /><Text style={styles.label}>PIN code to search</Text></View>
              <Text style={styles.hint}>Each store shows its own address matches; you choose the right one.</Text>
              <TextInput style={styles.input} accessibilityLabel="Delivery PIN code" placeholder="6-digit PIN code"
                placeholderTextColor="#94A3B8" value={address} editable={addressReady && !saving} maxLength={6} keyboardType="number-pad"
                onChangeText={value => {setAddress(normalizePinInput(value)); setError('');}} />
              <View style={styles.saveRow}><Text style={styles.hint}>{savedAddress && address === savedAddress ? 'Saved on this device' : 'Enter a six-digit PIN code.'}</Text>
                <TouchableOpacity style={styles.textButton} accessibilityLabel="Save delivery PIN code" disabled={!addressReady || saving} onPress={() => {void save();}}>
                  <Text style={styles.actionText}>{saving ? 'Saving…' : 'Save'}</Text>
                </TouchableOpacity>
              </View>
              {!!error && <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text>}
            </View>
            {stores.map(store => {
              const session = currentSession(sessions[store.platformId]);
              const color = session.status === 'signed_in' ? '#15803D' : session.status === 'signed_out' ? '#92400E' : '#64748B';
              const location = locations[store.platformId];
              const locationStatus = location && Date.now() >= location.checkedAt && Date.now() - location.checkedAt < SESSION_TTL_MS ? location.status : 'unknown';
              const locationAction = locationStatus === 'set' ? 'Reset location' : 'Set location';
              return <View key={store.platformId} style={styles.storeRow}>
                <TouchableOpacity style={styles.storeInfo} accessibilityLabel={`${store.platformName}, ${SESSION_LABELS[session.status]}. Open store.`}
                  onPress={() => onOpenStore(store.platformId)}>
                  <View style={[styles.dot, {backgroundColor: color}]} /><View style={{flex: 1}}><Text style={styles.storeName}>{store.platformName}</Text>
                    <Text style={[styles.storeStatus, {color}]}>{SESSION_LABELS[session.status]}</Text>
                    <Text style={styles.hint}>{LOCATION_LABELS[locationStatus]}</Text></View>
                </TouchableOpacity>
                <View><TouchableOpacity style={styles.textButton} accessibilityLabel={`${locationAction} for ${store.platformName}`}
                  disabled={!addressReady || saving}
                  onPress={async () => {if (await save()) onSetAddress(store.platformId, address);}}>
                  <Text style={[styles.actionText, (!addressReady || saving) && styles.disabledText]}>{locationAction}</Text>
                </TouchableOpacity>
                </View>
              </View>;
            })}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  </>;
};

const styles = StyleSheet.create({
  syncButton: {minHeight: 44, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 7, borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 9, backgroundColor: '#FFFFFF'},
  syncLabel: {fontSize: 13, fontWeight: '600', color: '#334155'},
  overlay: {flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(15,23,42,0.3)'},
  sheet: {height: '88%', backgroundColor: '#FFFFFF', borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingBottom: 24},
  headingRow: {padding: 18, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#E2E8F0'},
  heading: {fontSize: 20, fontWeight: '700', color: '#0F172A', marginBottom: 4},
  iconButton: {minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center'},
  content: {padding: 16, paddingBottom: 8},
  hint: {fontSize: 12, lineHeight: 18, color: '#64748B', flexShrink: 1},
  label: {fontSize: 14, fontWeight: '600', color: '#334155'},
  addressBox: {padding: 12, backgroundColor: '#F8FAFC', borderRadius: 10, marginBottom: 12, gap: 8},
  addressHeading: {flexDirection: 'row', alignItems: 'center', gap: 7},
  input: {minHeight: 64, maxHeight: 110, borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 8, padding: 10, color: '#0F172A', backgroundColor: '#FFFFFF', textAlignVertical: 'top'},
  saveRow: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10},
  textButton: {minHeight: 44, paddingHorizontal: 10, justifyContent: 'center'},
  actionText: {color: '#1D4ED8', fontWeight: '600', fontSize: 13},
  disabledText: {color: '#94A3B8'},
  error: {fontSize: 12, color: '#B91C1C'},
  storeRow: {flexDirection: 'row', alignItems: 'center', minHeight: 64, borderBottomWidth: 1, borderBottomColor: '#F1F5F9'},
  storeInfo: {flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10},
  dot: {width: 8, height: 8, borderRadius: 4},
  storeName: {fontSize: 14, fontWeight: '600', color: '#334155'},
  storeStatus: {fontSize: 12, marginTop: 4},
  headerSyncButton: {minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 12, marginRight: 8, backgroundColor: '#EFF6FF', borderWidth: 1, borderColor: '#BFDBFE', borderRadius: 8}
});
