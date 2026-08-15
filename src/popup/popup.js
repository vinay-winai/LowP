/**
 * LowP Popup Script (Amazon, Swiggy Instamart, Zepto)
 */

document.addEventListener("DOMContentLoaded", () => {
  const searchInput = document.getElementById("searchInput");
  const searchBtn = document.getElementById("searchBtn");
  const cardsGrid = document.getElementById("cardsGrid");
  const loadingState = document.getElementById("loadingState");
  const activeLocationText = document.getElementById("activeLocationText");
  const locationPill = document.getElementById("locationPill");
  const toggleDebugBtn = document.getElementById("toggleDebugBtn");
  const copyDebugBtn = document.getElementById("copyDebugBtn");
  const debugDrawer = document.getElementById("debugDrawer");
  const debugOutput = document.getElementById("debugOutput");
  const clearDebugBtn = document.getElementById("clearDebugBtn");

  let activeLocation = null;
  let currentResults = [];

  // 1. Initialize Location
  chrome.runtime.sendMessage({ action: "GET_ACTIVE_LOCATION" }, (res) => {
    if (res && res.success && res.data) {
      activeLocation = res.data;
      activeLocationText.textContent = `${activeLocation.name || 'Hyderabad'} (${activeLocation.pincode || '500085'})`;
    }
  });

  locationPill.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  const openSidePanelBtn = document.getElementById("openSidePanelBtn");
  if (openSidePanelBtn) {
    openSidePanelBtn.addEventListener("click", async () => {
      if (typeof chrome !== "undefined" && chrome.sidePanel && chrome.sidePanel.open) {
        try {
          const win = await chrome.windows.getCurrent();
          await chrome.sidePanel.open({ windowId: win.id });
          window.close();
        } catch (e) {
          chrome.runtime.sendMessage({ action: "OPEN_SIDE_PANEL" });
        }
      }
    });
  }

  const clearCacheBtn = document.getElementById("clearCacheBtn");
  if (clearCacheBtn) {
    clearCacheBtn.addEventListener("click", () => {
      chrome.runtime.sendMessage({ action: "CLEAR_CACHE" }, () => {
        const orig = clearCacheBtn.textContent;
        clearCacheBtn.textContent = "✅ Cleared!";
        setTimeout(() => clearCacheBtn.textContent = orig, 1200);
        const q = searchInput.value.trim();
        if (q) performSearch(q);
      });
    });
  }

  // 2. Auto-Detect Product Title from Active Tab
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs && tabs[0] && tabs[0].url) {
      const activeUrl = tabs[0].url;
      if (activeUrl.includes("amazon.in") || activeUrl.includes("swiggy.com") || activeUrl.includes("zepto.com")) {
        chrome.tabs.sendMessage(tabs[0].id, { action: "GET_PAGE_PRODUCT_DATA" }, (resp) => {
          if (chrome.runtime.lastError) {
            // Tab was loaded before extension was reloaded or not accessible
            return;
          }
          if (resp && resp.data && resp.data.title) {
            searchInput.value = resp.data.title;
            performSearch(resp.data.title);
          }
        });
      }
    }
  });

  // 3. Search Trigger
  searchBtn.addEventListener("click", () => {
    const q = searchInput.value.trim();
    if (q) performSearch(q);
  });

  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const q = searchInput.value.trim();
      if (q) performSearch(q);
    }
  });

  // 4. Perform Search
  function performSearch(query) {
    loadingState.style.display = "flex";
    cardsGrid.innerHTML = "";

    chrome.runtime.sendMessage({
      action: "SEARCH_QUERY",
      payload: { query }
    }, (response) => {
      loadingState.style.display = "none";
      if (response && response.success && response.data) {
        currentResults = response.data;
        renderCards(response.data);
        updateDebugLogs();
      } else {
        cardsGrid.innerHTML = `<div class="error-msg" style="text-align:center; padding:20px; color:#EF4444;">Search failed: ${response?.error || 'Unknown error'}</div>`;
        updateDebugLogs();
      }
    });
  }

  // 5. Render Store Cards
  function renderCards(results) {
    cardsGrid.innerHTML = "";

    results.forEach((store) => {
      const card = document.createElement("div");
      card.className = `store-card ${store.isLowestPrice ? 'highlight-lowest' : ''}`;

      const storeColors = {
        amazon_tez: "#FF9900",
        instamart: "#FC8019",
        zepto: "#7C3AED",
        blinkit: "#F8CB46"
      };

      const bgColor = storeColors[store.platformId] || "#38BDF8";
      const textColor = store.platformId === "blinkit" ? "#111827" : "#FFFFFF";
      const hasPrice = store.isAvailable && store.priceBreakdown && store.priceBreakdown.finalPayable > 0;

      let badgesHtml = "";
      if (store.isLowestPrice && hasPrice) badgesHtml += `<span class="badge badge-lowest">🏆 Lowest Price</span>`;

      let priceHtml = "";
      if (hasPrice) {
        priceHtml = `
          <div class="price-box">
            <span class="price-main">₹${store.priceBreakdown.finalPayable}</span>
            ${store.priceBreakdown.savings > 0 ? `
              <div class="mrp-row">
                <span class="price-mrp">₹${store.item.mrp}</span>
                <span class="discount-tag">${store.priceBreakdown.discountPercent}% OFF</span>
              </div>
            ` : ''}
          </div>
        `;
      } else {
        priceHtml = `
          <div class="price-box">
            <span class="price-main" style="font-size: 13px; color: var(--text-sub);">Check Live</span>
          </div>
        `;
      }

      card.innerHTML = `
        <div class="card-header">
          <div class="store-identity">
            <span class="store-pill" style="background: ${bgColor}; color: ${textColor}; font-weight: 700;">${store.platformName}</span>
          </div>
          <div class="badges-row">
            ${badgesHtml}
          </div>
        </div>

        <div class="card-body">
          <div class="item-info">
            <span class="item-title">${store.item?.title || store.platformName}</span>
            <span class="item-brand">${store.item?.brand || store.platformName} • ${store.item?.quantity || '1 unit'}</span>
          </div>
          ${priceHtml}
        </div>

        <div class="card-action">
          <a href="${store.productUrl}" target="_blank" class="store-link">
            Get on ${store.platformName} →
          </a>
        </div>
      `;

      cardsGrid.appendChild(card);
    });
  }

  // 6. Debug Inspector Telemetry
  function updateDebugLogs() {
    chrome.runtime.sendMessage({ action: "GET_DEBUG_LOGS" }, (res) => {
      if (res && res.logs) {
        debugOutput.textContent = JSON.stringify(res.logs, null, 2);
      }
    });
  }

  toggleDebugBtn.addEventListener("click", () => {
    if (debugDrawer.style.display === "none") {
      debugDrawer.style.display = "flex";
      copyDebugBtn.style.display = "block";
      toggleDebugBtn.textContent = "✖️ Hide Debug";
      updateDebugLogs();
    } else {
      debugDrawer.style.display = "none";
      copyDebugBtn.style.display = "none";
      toggleDebugBtn.textContent = "🛠️ Debug Inspector";
    }
  });

  copyDebugBtn.addEventListener("click", () => {
    navigator.clipboard.writeText(debugOutput.textContent).then(() => {
      const orig = copyDebugBtn.textContent;
      copyDebugBtn.textContent = "✅ Copied!";
      setTimeout(() => copyDebugBtn.textContent = orig, 1500);
    });
  });

  clearDebugBtn.addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "CLEAR_CACHE" }, () => {
      debugOutput.textContent = "Logs cleared.";
    });
  });
});
