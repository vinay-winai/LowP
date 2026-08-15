# LowP Mobile - Real-Time Grocery Price Comparator (Android & iOS)

A native mobile application built with **Expo (React Native)** and **TypeScript** that delivers live, hyperlocal grocery price comparisons across **Amazon Now (Tez)**, **Swiggy Instamart**, **Zepto**, and **Blinkit**.

---

## ⚡ How It Works on Mobile

1. **Client-Side Distributed Scrapers**:
   - Executes 4 in-memory headless WebViews directly on the user's phone.
   - Runs on the phone's genuine cellular (Jio / Airtel / Vi) or home Wi-Fi network with authentic device fingerprints.
   - **Zero bot bans**, **zero CAPTCHAs**, and **zero proxy server bills**.
2. **Persistent One-Time Store Login**:
   - Tap any store pill in the app to open an in-app login window.
   - Log in with phone/OTP once; cookies and sessions are permanently saved in Android/iOS's native `CookieManager`.
   - All background searches inherit active **Amazon Prime**, **Swiggy One**, and **Zepto Pass** discounts automatically.
3. **Pure Base Price Comparison**:
   - Computes base item prices, MRP discounts, and highlights the **🏆 Lowest Price** store.

---

## 🚀 How to Run on Android (Quick Start)

### 1. Start the Development Server
```bash
cd mobile
npm start
```

### 2. Test on a Physical Android Phone
1. Install **Expo Go** from the [Google Play Store](https://play.google.com/store/apps/details?id=host.exp.exponent).
2. Ensure your phone and PC are connected to the same Wi-Fi network.
3. Open **Expo Go** on your phone and scan the QR code displayed in your terminal.

### 3. Test on Android Emulator
```bash
npm run android
```

---

## 📦 Building a Standalone Android APK

To generate a standalone `.apk` for distribution or installation on any Android device:

```bash
# 1. Install EAS CLI
npm install -g eas-cli

# 2. Log in to your Expo account
eas login

# 3. Build APK for Android
eas build -p android --profile preview
```

---

## 📁 Architecture

```
mobile/
├── src/
│   ├── components/
│   │   ├── BackgroundScrapers.tsx  # In-memory headless WebViews
│   │   ├── StoreCard.tsx           # Comparison card with branding & badges
│   │   ├── StoreLoginModal.tsx     # One-time login modal
│   │   └── LocationModal.tsx       # Address & pincode picker
│   ├── core/
│   │   ├── MatchingEngine.ts       # Relevance scoring & price math
│   │   ├── LocationService.ts      # Address persistence (AsyncStorage)
│   │   └── ScraperScript.ts        # Injected DOM extraction script
│   ├── screens/
│   │   └── HomeScreen.tsx          # Main search & comparison view
│   └── types/
│       └── index.ts                # TypeScript interfaces
├── App.tsx                         # Root app component
└── app.json                        # Expo app metadata & package configuration
```
