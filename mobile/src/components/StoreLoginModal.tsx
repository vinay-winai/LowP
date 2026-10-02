import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  Alert
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { PlatformId } from '../types';
import { X, RefreshCw, ArrowLeft } from 'lucide-react-native';
import { StoreSession, StoreLocation, SESSION_LABELS, isStoreSessionUrl, readSessionMessage, sessionObserverScript, locationObserverScript, readLocationMessage } from '../core/StoreSession';
import {addressHelperScript, readAddressHelpMessage, addressHelpLabel, addressPin, normalizePinInput, isValidPin} from '../core/StoreAddress';

interface StoreLoginModalProps {
  visible: boolean;
  platformId: PlatformId | null;
  onClose: () => void;
  session: StoreSession;
  onSessionChange: (platformId: PlatformId, session: StoreSession) => void;
  purpose?: 'account' | 'address';
  addressQuery?: string;
  locationIsSet?: boolean;
  onLocationChange: (id: PlatformId, location: StoreLocation) => void;
}

const STORE_CONFIG: Record<
  PlatformId,
  { name: string; url: string; color: string }
> = {
  amazon_tez: {
    name: 'Amazon Now (Tez)',
    url: 'https://www.amazon.in/tez/browse',
    color: '#FF9900'
  },
  instamart: {
    name: 'Swiggy Instamart',
    url: 'https://www.swiggy.com/instamart',
    color: '#FC8019'
  },
  zepto: {
    name: 'Zepto',
    url: 'https://www.zepto.com',
    color: '#7C3AED'
  },
  blinkit: {
    name: 'Blinkit',
    url: 'https://blinkit.com',
    color: '#F8CB46'
  },
  amazon_main: {
    name: 'Amazon.in',
    url: 'https://www.amazon.in',
    color: '#FF9900'
  },
  flipkart: {
    name: 'Flipkart',
    url: 'https://www.flipkart.com',
    color: '#2874F0'
  }
};

export const StoreLoginModal: React.FC<StoreLoginModalProps> = ({
  visible,
  platformId,
  onClose,
  session,
  onSessionChange,
  purpose = 'account',
  addressQuery = '',
  locationIsSet = false,
  onLocationChange
}) => {
  const [loading, setLoading] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const webViewRef = useRef<WebView>(null);
  const navigationToken = useRef('');
  const navigationUrl = useRef('');
  const observedToken = useRef('');
  const [address, setAddress] = useState(addressPin(addressQuery));
  const [addressMessage, setAddressMessage] = useState('Each store has its own matches. Choose the correct location in the store below.');
  const addressAttempted = useRef(false);
  const addressOperationToken = useRef('');
  const addressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const addressPages = useRef<Partial<Record<PlatformId, string>>>({});
  const initialPage = useMemo(() => platformId ? (purpose === 'address' && platformId !== 'flipkart' && platformId !== 'instamart' ? addressPages.current[platformId] || STORE_CONFIG[platformId].url : STORE_CONFIG[platformId].url) : '', [visible, platformId, purpose]);
  useEffect(() => {
    if (addressTimer.current) clearTimeout(addressTimer.current);
    addressOperationToken.current = '';
    if (visible) {setAddress(addressPin(addressQuery)); addressAttempted.current = false; setAddressMessage('Each store has its own matches. Choose the correct location in the store below.');}
    return () => {addressOperationToken.current = ''; if (addressTimer.current) clearTimeout(addressTimer.current);};
  }, [visible, platformId, purpose, addressQuery]);
  const fillAddress = () => {
    if (!platformId || !navigationToken.current || !isStoreSessionUrl(platformId, navigationUrl.current)) return;
    const query = address;
    if (!isValidPin(query)) {setAddressMessage('Enter a valid six-digit PIN code.'); Alert.alert('Enter the PIN code', 'Enter a valid six-digit PIN code to search for the store location.'); return;}
    addressAttempted.current = true;
    const token = `address:${platformId}:${Date.now()}:${Math.random()}`;
    addressOperationToken.current = token;
    if (addressTimer.current) clearTimeout(addressTimer.current);
    addressTimer.current = setTimeout(() => {
      if (addressOperationToken.current !== token) return;
      addressOperationToken.current = '';
      webViewRef.current?.injectJavaScript('window.__lowpAddressHelper?.dispose(); true;');
      setAddressMessage(addressHelpLabel(platformId, 'manual'));
    }, 8000);
    setAddressMessage('Opening the store’s location search…');
    webViewRef.current?.injectJavaScript(addressHelperScript(platformId, addressOperationToken.current, query));
  };

  if (!visible || !platformId || !STORE_CONFIG[platformId]) return null;

  const config = STORE_CONFIG[platformId];
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            {canGoBack && (
              <TouchableOpacity
                style={styles.backButton}
                onPress={() => webViewRef.current?.goBack()}
              >
                <ArrowLeft size={20} color="#0F172A" />
              </TouchableOpacity>
            )}
            <View style={[styles.storeIndicator, { backgroundColor: config.color }]} />
            <Text style={styles.title} numberOfLines={1}>
              {purpose === 'address' ? locationIsSet ? 'Reset location ·' : 'Set location ·' : 'Connect'} {config.name}
            </Text>
          </View>

          <View style={styles.headerActions}>
            {loading && <ActivityIndicator size="small" color={config.color} style={styles.loadingSpinner} />}

            <TouchableOpacity
              style={styles.iconButton}
              onPress={() => webViewRef.current?.reload()}
            >
              <RefreshCw size={18} color="#64748B" />
            </TouchableOpacity>

            <TouchableOpacity accessibilityLabel="Close store" style={styles.iconButton} onPress={onClose}>
              <X size={20} color="#64748B" />
            </TouchableOpacity>
          </View>
        </View>

        {purpose === 'address' && <View style={styles.addressHelp}>
          <View style={styles.addressRow}><TextInput accessibilityLabel="PIN code search for this store" style={styles.addressInput}
            value={address} onChangeText={value => {addressOperationToken.current = ''; if (addressTimer.current) clearTimeout(addressTimer.current); webViewRef.current?.injectJavaScript('window.__lowpAddressHelper?.dispose(); true;'); setAddress(normalizePinInput(value)); setAddressMessage('Tap Fill address to search for this PIN code in the store.');}} maxLength={6} keyboardType="number-pad" placeholder="6-digit PIN code" placeholderTextColor="#94A3B8" />
            <TouchableOpacity accessibilityLabel="Fill store address search" disabled={loading} style={styles.fillButton} onPress={fillAddress}>
              <Text style={{color: loading ? '#94A3B8' : '#1D4ED8', fontWeight: '600', fontSize: 12}}>Fill address</Text>
            </TouchableOpacity>
          </View><Text style={styles.addressHint} accessibilityLiveRegion="polite">{addressMessage}</Text>
        </View>}

        {/* Security Banner */}
        <View style={styles.securityBanner}>
          <Text style={styles.securityText}>
            🔒 Log in or set your location directly in the store. Your session and address are saved in your device storage.
          </Text>
          <Text style={styles.sessionText} accessibilityLiveRegion="polite">
            {SESSION_LABELS[session.status]}
            {session.status === 'unknown' ? platformId === 'amazon_tez'
              ? ' · Tap Deliver to to check sign-in status.'
              : ' · Open Account to check sign-in status.' : ''}
          </Text>
        </View>

        {/* Loading Progress Bar */}
        {loading && <View style={[styles.progressBar, { backgroundColor: config.color }]} />}

        {/* Interactive Web View */}
        <View style={styles.webViewContainer}>
          <WebView
            key={platformId}
            ref={webViewRef}
            source={{ uri: initialPage || config.url }}
            style={styles.webView}
            javaScriptEnabled={true}
            domStorageEnabled={true}
            sharedCookiesEnabled={true}
            thirdPartyCookiesEnabled={true}
            allowsBackForwardNavigationGestures={true}
            setSupportMultipleWindows={false}
            javaScriptCanOpenWindowsAutomatically={true}
            onNavigationStateChange={(navState) => {
              if (isStoreSessionUrl(platformId, navState.url)) {
                navigationUrl.current = navState.url;
                if (purpose === 'address') addressPages.current[platformId] = navState.url;
              }
              setCanGoBack(navState.canGoBack);
              setLoading(navState.loading);
              if (!navState.loading && isStoreSessionUrl(platformId, navState.url)) {
                webViewRef.current?.injectJavaScript(locationObserverScript(platformId, navigationToken.current, true));
                webViewRef.current?.injectJavaScript(sessionObserverScript(platformId, navigationToken.current));
              }
            }}
            onLoadStart={(event) => {
              navigationToken.current = `${platformId}:${Date.now()}:${Math.random()}`;
              navigationUrl.current = event.nativeEvent.url;
              observedToken.current = '';
              setLoading(true);
              if (purpose === 'account') onSessionChange(platformId, { status: 'checking', evidence: 'none', checkedAt: Date.now() });
              // Android emits load-start for some SPA transitions without a matching
              // load-end. Refresh the observer in the surviving document as well.
              if (isStoreSessionUrl(platformId, event.nativeEvent.url)) {
                webViewRef.current?.injectJavaScript(locationObserverScript(platformId, navigationToken.current, true));
                webViewRef.current?.injectJavaScript(sessionObserverScript(platformId, navigationToken.current));
              }
            }}
            onLoadEnd={(event) => {
              setLoading(false);
              if (event.nativeEvent.url !== navigationUrl.current) return;
              if (purpose !== 'address' && observedToken.current !== navigationToken.current) {
                onSessionChange(platformId, { status: 'unknown', evidence: 'none', checkedAt: Date.now() });
              }
              if (isStoreSessionUrl(platformId, event.nativeEvent.url)) {
                webViewRef.current?.injectJavaScript(sessionObserverScript(platformId, navigationToken.current));
                if (purpose === 'address' && !addressAttempted.current) fillAddress();
              }
            }}
            onMessage={(event) => {
              const location = readLocationMessage(event.nativeEvent.data, platformId, navigationToken.current, event.nativeEvent.url);
              if(location) {onLocationChange(platformId,location); return;}
              const addressResult = readAddressHelpMessage(event.nativeEvent.data, platformId, addressOperationToken.current, event.nativeEvent.url);
              if (addressResult) {if (addressTimer.current) clearTimeout(addressTimer.current); addressOperationToken.current = ''; setAddressMessage(addressHelpLabel(platformId, addressResult)); return;}
              const observation = readSessionMessage(event.nativeEvent.data, platformId,
                navigationToken.current, event.nativeEvent.url);
              if (observation) {
                observedToken.current = navigationToken.current;
                const conflicting = observation.status === 'unknown' && JSON.parse(event.nativeEvent.data).conflicting === true;
                if (purpose !== 'address' || observation.status !== 'unknown' || conflicting) onSessionChange(platformId, observation);
              }
            }}
            onError={() => {
              setLoading(false);
              navigationToken.current = '';
              addressOperationToken.current = '';
              if (addressTimer.current) clearTimeout(addressTimer.current);
              if (purpose === 'account') onSessionChange(platformId, { status: 'unknown', evidence: 'none', checkedAt: Date.now() });
              else setAddressMessage('Could not load this store. Reload it to try setting the location again.');
            }}
          />
        </View>
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  addressHelp: {paddingHorizontal: 16, paddingVertical: 10, gap: 6, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#E2E8F0'},
  addressRow: {flexDirection: 'row', alignItems: 'center', gap: 8},
  addressInput: {flex: 1, minHeight: 44, borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 8, paddingHorizontal: 10, color: '#0F172A', fontSize: 13},
  fillButton: {minHeight: 44, paddingHorizontal: 8, justifyContent: 'center'},
  addressHint: {color: '#64748B', fontSize: 12, lineHeight: 18},
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC'
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    backgroundColor: '#FFFFFF'
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1
  },
  backButton: {
    paddingRight: 4
  },
  storeIndicator: {
    width: 10,
    height: 10,
    borderRadius: 5
  },
  title: {
    color: '#0F172A',
    fontSize: 16,
    fontWeight: '700',
    flexShrink: 1
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10
  },
  loadingSpinner: {
    marginRight: 2
  },
  iconButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center'
  },
  securityBanner: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0'
  },
  securityText: {
    color: '#64748B',
    fontSize: 12,
    lineHeight: 16
  },
  sessionText: {
    color: '#475569',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 6
  },
  progressBar: {
    height: 2,
    width: '100%'
  },
  webViewContainer: {
    flex: 1,
    backgroundColor: '#FFFFFF'
  },
  webView: {
    flex: 1
  }
});
