# LowP

> **Online price comparison • 100% local • No data collected**

A fast, lightweight, and privacy-first real-time price comparator available as a **Chrome Extension** and a **Mobile App**. It searches multiple stores in parallel so you can find the lowest price in seconds.

---

## 🛒 Available Stores

- **Amazon Now (Tez)**
- **Swiggy Instamart**
- **Zepto**
- **Blinkit**
- **Amazon.in**
- **Flipkart**

---

## 🔒 100% Local & Private

- **Runs Locally**: All searches run directly on your own device with zero middleman servers.
- **No Data Collected**: Your searches, locations, and credentials never leave your device.

---

## 💡 Tips for Best Results

1. **Log in to Stores**:
   - For several stores (such as Swiggy Instamart, Zepto, Blinkit, and Amazon), logging in once is mandatory to see items available for your delivery address and dark store.

2. **Search with Full Product Titles**:
   - For the most accurate price and pack-size match, copy the full product title (e.g., `Amul Fresh Malai Paneer 200g` or `Apple iPhone 16 128 GB`) from any store and search that in LowP.

3. **Switching Between Store Packs**:
   - Switching between store packs (e.g. from *Big Online Pack* to *10 min pack*) requires cold-starting the newly selected store scrapers and resolving a fresh search, which reduces performance for initial queries compared to repeat searches within the same pack.

---

## ⚡ Expected Performance

* **10 min pack (Quick Commerce: Amazon Tez, Instamart, Zepto, Blinkit)**:
  - **Initial Query (Cold Start)**: ~5 seconds
  - **Subsequent Queries (From 2nd or 3rd query onwards)**:
    - **Mobile (Snapdragon 8s Gen 3 SoC)**: **2–4 seconds**
    - **PC / Chrome Extension (Ryzen 5 3600)**: **2–3 seconds**

* **Big Online Pack (Amazon.in & Flipkart)**:
  - **Always close to ~1 second (sometimes sub-2 seconds)** via direct HTTP fast-path.

---

## 🚀 Getting Started

### Google Chrome Extension
1. Open **Google Chrome** and navigate to `chrome://extensions`.
2. Enable **Developer mode** in the top-right corner.
3. Click **Load unpacked** and select this folder.
4. Click the **LowP** icon in your toolbar to start comparing!

The extension uses the mobile app's light theme, product-based comparisons,
effective size-adjusted prices, editable comparison items, store offers, and
local search history (1,000 unique searches; up to 10 suggestions after 180 ms).
Find title searches one selected store; choosing a title searches your pack.
Store Sync, address management, and the mobile search-limit toggle are not included.
Searches are allowed in normal, maximized, and fullscreen windows. Background
store windows may still be affected by Chrome's occlusion throttling; live
results in each mode depend on the store and session.

After pulling changes, click **Reload** on LowP in `chrome://extensions` and reopen
the side panel. Saved packs and comparisons are retained.

The browser bundle of shared mobile logic is checked in. To regenerate it after
changing the platform-independent mobile core, install `mobile` dependencies and
run `npm run build:extension`. Run `npm test` for logic tests and
`npm run test:extension` for browser UI checks (requires Playwright Chromium).
Browser checks use deterministic store fixtures; live store availability still
depends on the user's store sessions and delivery locations.

### Android Mobile App
Android apk available for [download](https://github.com/vinay-winai/LowP/releases/tag/v0.2.0). 

Also Expo:
```bash
cd mobile
npm start
```
Open **Expo Go** on your Android phone and scan the QR code to run the app.
