# 🍏 LowP - Safari Web Extension (iOS & macOS)

Real-time grocery price comparator for **Safari** across **Amazon Now (Tez)**, **Swiggy Instamart**, **Zepto**, and **Blinkit**.

---

## 📱 How It Works in Safari

1. **Native Safari Web Extension (Manifest V3)**:
   - Deeply integrated into Safari on iPhone (iOS 15+), iPad (iPadOS 15+), and Mac (macOS Big Sur+).
   - Tap the **aA** (or Extensions) icon in Safari's address bar to trigger LowP.
2. **Session & Address Sharing**:
   - Queries Safari's active authenticated tabs. If you are already logged in to Swiggy, Zepto, or Amazon in Safari, LowP automatically inherits your delivery address and active subscriptions (Amazon Prime, Swiggy One, Zepto Pass).
3. **Adaptive iOS Action Sheet UI**:
   - Built with Apple Human Interface Guidelines and safe-area insets (`env(safe-area-inset-bottom)`). Fits iPhone bottom sheets, iPad popovers, and Mac toolbar flyouts.

---

## 🚀 Testing & Deployment Methods

### Method 1: Instant Testing on iPhone / iPad (Zero Mac Required via Orion Browser)
The [Orion Browser](https://kagi.com/orion/) for iOS is a WebKit browser that natively supports Chrome/Safari WebExtensions directly on iPhone:
1. Install **Orion Browser** from the iOS App Store.
2. Open `orion://settings/extensions`.
3. Tap **Install Chrome / Safari Extension** and select the `safari-extension/` directory (or zip).
4. Tap the extension button in the address bar to compare prices live!

---

### Method 2: Official Apple Xcode Build (macOS & App Store)

To build the native iOS and macOS Safari App Extension using Apple's official converter:

#### Step 1: Run the Conversion Script
On your Mac:
```bash
cd safari-extension
chmod +x build-safari.sh
./build-safari.sh
```
*Or run manually:*
```bash
xcrun safari-web-extension-converter . \
    --project-location ./safari-xcode-project \
    --app-name LowP \
    --bundle-identifier com.lowp.safari \
    --swift \
    --ios-only
```

#### Step 2: Open in Xcode
1. Open `./safari-xcode-project/LowP/LowP.xcodeproj` in Xcode.
2. Select your development team in **Signing & Capabilities**.
3. Choose your connected iPhone or an iOS Simulator as the build destination.
4. Click **Run (⌘R)**.

#### Step 3: Enable in iOS Settings
1. On your iPhone, open **Settings $\rightarrow$ Safari $\rightarrow$ Extensions**.
2. Tap **LowP** and toggle it **ON**.
3. Under *Permissions*, set permissions to **Always Allow** for All Websites.
4. Open Safari, navigate to any site, tap the **aA** or extension icon, and launch LowP!

---

## 📁 Project Structure

```
safari-extension/
├── manifest.json            # Safari Manifest V3 configuration
├── build-safari.sh          # Apple xcrun converter script
├── assets/                  # App icons (16, 32, 48, 128px)
└── src/
    ├── background/
    │   └── service-worker.js # Safari-optimized background orchestrator
    ├── content/
    │   └── content-script.js # In-page session scraper
    ├── popup/
    │   ├── popup.html       # Adaptive iOS/macOS popup
    │   ├── popup.css        # Safe-area insets & touch UI
    │   └── popup.js         # UI controller & message bridge
    └── options/
        ├── options.html     # Address & pincode manager
        ├── options.css
        └── options.js
```
