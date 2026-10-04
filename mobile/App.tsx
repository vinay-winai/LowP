import React, {useCallback, useState} from 'react';
import {View, Text, Image, StyleSheet, StatusBar} from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { HomeScreen } from './src/screens/HomeScreen';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function App() {
  const [ready, setReady] = useState(false);
  const finishLaunch = useCallback(() => setReady(true), []);
  return <View style={styles.root} onLayout={() => {SplashScreen.hideAsync().catch(() => {});}}>
    <HomeScreen onReady={finishLaunch} />
    {!ready && <View style={styles.launch} accessibilityLabel="LowP is loading">
      <StatusBar barStyle="dark-content" backgroundColor="#F8FAFC" />
      <Image source={require('./assets/loop-bag-logo.png')} style={styles.logo} resizeMode="contain" />
      <Text style={styles.name}>LowP</Text>
      <Text style={styles.description}>Hunt the lowest price with privacy</Text>
    </View>}
  </View>;
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: '#F8FAFC'},
  launch: {position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: '#F8FAFC', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24},
  logo: {width: 200, height: 200},
  name: {fontSize: 30, fontWeight: '700', color: '#0F5132', marginTop: 8},
  description: {fontSize: 16, color: '#475569', textAlign: 'center', marginTop: 10},
});
