import React, { useState, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { PlatformId } from '../types';
import { X, RefreshCw, ArrowLeft, ShieldCheck } from 'lucide-react-native';

interface StoreLoginModalProps {
  visible: boolean;
  platformId: PlatformId | null;
  onClose: () => void;
  onLoginComplete: (platformId: PlatformId) => void;
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
  onLoginComplete
}) => {
  const [loading, setLoading] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const webViewRef = useRef<WebView>(null);

  if (!platformId || !STORE_CONFIG[platformId]) return null;

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
                <ArrowLeft size={20} color="#F8FAFC" />
              </TouchableOpacity>
            )}
            <View style={[styles.storeIndicator, { backgroundColor: config.color }]} />
            <Text style={styles.title} numberOfLines={1}>
              Connect {config.name}
            </Text>
          </View>

          <View style={styles.headerActions}>
            {loading && <ActivityIndicator size="small" color={config.color} style={styles.loadingSpinner} />}

            <TouchableOpacity
              style={styles.iconButton}
              onPress={() => webViewRef.current?.reload()}
            >
              <RefreshCw size={18} color="#94A3B8" />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.doneButton}
              onPress={() => {
                onLoginComplete(platformId);
                onClose();
              }}
            >
              <ShieldCheck size={16} color="#10B981" />
              <Text style={styles.doneButtonText}>Done</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.iconButton} onPress={onClose}>
              <X size={20} color="#94A3B8" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Security Banner */}
        <View style={styles.securityBanner}>
          <Text style={styles.securityText}>
            🔒 Log in or set your location directly in the store. Your session and address are saved in your device storage.
          </Text>
        </View>

        {/* Loading Progress Bar */}
        {loading && <View style={[styles.progressBar, { backgroundColor: config.color }]} />}

        {/* Interactive Web View */}
        <View style={styles.webViewContainer}>
          <WebView
            ref={webViewRef}
            source={{ uri: config.url }}
            style={styles.webView}
            javaScriptEnabled={true}
            domStorageEnabled={true}
            sharedCookiesEnabled={true}
            thirdPartyCookiesEnabled={true}
            allowsBackForwardNavigationGestures={true}
            setSupportMultipleWindows={false}
            javaScriptCanOpenWindowsAutomatically={true}
            onNavigationStateChange={(navState) => {
              setCanGoBack(navState.canGoBack);
              setLoading(navState.loading);
            }}
            onLoadStart={() => setLoading(true)}
            onLoadEnd={() => setLoading(false)}
            onError={() => setLoading(false)}
          />
        </View>
      </SafeAreaView>
    </Modal>
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
    borderBottomColor: '#334155',
    backgroundColor: '#1E293B'
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
    color: '#F8FAFC',
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
    padding: 6
  },
  doneButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)'
  },
  doneButtonText: {
    color: '#10B981',
    fontSize: 13,
    fontWeight: '700'
  },
  securityBanner: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#334155'
  },
  securityText: {
    color: '#94A3B8',
    fontSize: 12,
    lineHeight: 16
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
