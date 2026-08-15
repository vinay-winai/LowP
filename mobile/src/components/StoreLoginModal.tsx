import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  ActivityIndicator
} from 'react-native';
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
    url: 'https://www.amazon.in/ap/signin',
    color: '#FF9900'
  },
  instamart: {
    name: 'Swiggy Instamart',
    url: 'https://www.swiggy.com',
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
  }
};

export const StoreLoginModal: React.FC<StoreLoginModalProps> = ({
  visible,
  platformId,
  onClose,
  onLoginComplete
}) => {
  const [loading, setLoading] = useState(true);
  const webViewRef = React.useRef<WebView>(null);

  if (!platformId || !STORE_CONFIG[platformId]) return null;

  const config = STORE_CONFIG[platformId];

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View style={[styles.storeIndicator, { backgroundColor: config.color }]} />
            <Text style={styles.title}>Connect {config.name}</Text>
          </View>

          <View style={styles.headerActions}>
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
            🔒 Log in once directly with the official store. Your session and address are saved securely in your phone's cookie storage.
          </Text>
        </View>

        {/* Interactive Web View */}
        <View style={styles.webViewContainer}>
          {loading && (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator size="large" color="#10B981" />
            </View>
          )}
          <WebView
            ref={webViewRef}
            source={{ uri: config.url }}
            style={styles.webView}
            javaScriptEnabled={true}
            domStorageEnabled={true}
            sharedCookiesEnabled={true}
            thirdPartyCookiesEnabled={true}
            onLoadStart={() => setLoading(true)}
            onLoadEnd={() => setLoading(false)}
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
    gap: 8
  },
  storeIndicator: {
    width: 10,
    height: 10,
    borderRadius: 5
  },
  title: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '700'
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12
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
  webViewContainer: {
    flex: 1,
    position: 'relative'
  },
  webView: {
    flex: 1
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#0F172A',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10
  }
});
