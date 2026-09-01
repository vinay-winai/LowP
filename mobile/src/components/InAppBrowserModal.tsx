import React, { useState, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
  Share
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { X, RefreshCw, ArrowLeft, ArrowRight, ExternalLink, Share2, Globe } from 'lucide-react-native';

interface InAppBrowserModalProps {
  visible: boolean;
  url: string | null;
  title: string;
  color?: string;
  onClose: () => void;
}

export const InAppBrowserModal: React.FC<InAppBrowserModalProps> = ({
  visible,
  url,
  title,
  color = '#38BDF8',
  onClose
}) => {
  const [loading, setLoading] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [currentUrl, setCurrentUrl] = useState<string>(url || '');
  const webViewRef = useRef<WebView>(null);

  if (!visible || !url) return null;

  const handleOpenExternal = () => {
    const target = currentUrl || url;
    if (target && target !== '#') {
      Linking.openURL(target).catch(() => {});
    }
  };

  const handleShare = async () => {
    const target = currentUrl || url;
    if (target && target !== '#') {
      try {
        await Share.share({
          message: `${title}: ${target}`,
          url: target
        });
      } catch (e) {}
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.container}>
        {/* Browser Top Navigation Bar */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <TouchableOpacity
              style={[styles.navBtn, !canGoBack && styles.navBtnDisabled]}
              onPress={() => webViewRef.current?.goBack()}
              disabled={!canGoBack}
            >
              <ArrowLeft size={18} color={canGoBack ? '#F8FAFC' : '#475569'} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.navBtn, !canGoForward && styles.navBtnDisabled]}
              onPress={() => webViewRef.current?.goForward()}
              disabled={!canGoForward}
            >
              <ArrowRight size={18} color={canGoForward ? '#F8FAFC' : '#475569'} />
            </TouchableOpacity>

            <View style={styles.titleContainer}>
              <View style={[styles.storeIndicator, { backgroundColor: color }]} />
              <Text style={styles.titleText} numberOfLines={1}>
                {title}
              </Text>
            </View>
          </View>

          <View style={styles.headerRight}>
            {loading ? (
              <ActivityIndicator size="small" color={color} style={styles.actionIcon} />
            ) : (
              <TouchableOpacity style={styles.actionIcon} onPress={() => webViewRef.current?.reload()}>
                <RefreshCw size={17} color="#94A3B8" />
              </TouchableOpacity>
            )}

            <TouchableOpacity style={styles.actionIcon} onPress={handleShare}>
              <Share2 size={17} color="#94A3B8" />
            </TouchableOpacity>

            <TouchableOpacity style={styles.actionIcon} onPress={handleOpenExternal} accessibilityLabel="Open in System Browser">
              <ExternalLink size={17} color="#94A3B8" />
            </TouchableOpacity>

            <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
              <X size={20} color="#F8FAFC" />
            </TouchableOpacity>
          </View>
        </View>

        {/* URL Bar */}
        <View style={styles.urlBar}>
          <Globe size={11} color="#64748B" />
          <Text style={styles.urlText} numberOfLines={1}>
            {currentUrl || url}
          </Text>
        </View>

        {/* Loading Bar */}
        {loading && <View style={[styles.progressBar, { backgroundColor: color }]} />}

        {/* In-App Browser WebView */}
        <View style={styles.webViewContainer}>
          <WebView
            ref={webViewRef}
            source={{ uri: url }}
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
              setCanGoForward(navState.canGoForward);
              setLoading(navState.loading);
              if (navState.url) setCurrentUrl(navState.url);
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
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#1E293B',
    borderBottomWidth: 1,
    borderBottomColor: '#334155'
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
    marginRight: 8
  },
  navBtn: {
    padding: 6,
    borderRadius: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.05)'
  },
  navBtnDisabled: {
    opacity: 0.4
  },
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
    marginLeft: 4
  },
  storeIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4
  },
  titleText: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '700',
    flexShrink: 1
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  actionIcon: {
    padding: 6
  },
  closeBtn: {
    padding: 6,
    marginLeft: 2
  },
  urlBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#0F172A',
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B'
  },
  urlText: {
    color: '#64748B',
    fontSize: 11,
    flex: 1
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
