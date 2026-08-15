/**
 * LowP Safari Extension Popup Script (Amazon Tez, Swiggy Instamart, Zepto, Blinkit)
 */

document.addEventListener("DOMContentLoaded", () => {
  const extensionAPI = typeof browser !== 'undefined' ? browser : chrome;

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
  const clearCacheBtn = document.getElementById("clearCacheBtn");

  let activeLocation = null;
  let currentResults = [];

  // 1. Initialize Location
  extensionAPI.runtime.sendMessage({ action: "GET_ACTIVE_LOCATION" }, (res) => {
    if (res && res.success && res.data) {
      activeLocation = res.data;
      activeLocationText.textContent = `${activeLocation.name || 'Hyderabad'} (${activeLocation.pincode || '500085'})`;
    }
  });

  locationPill.addEventListener("click", () => {
    if (extensionAPI.runtime.openOptionsPage) {
      extensionAPI.runtime.openOptionsPage();
    }
  });

  if (clearCacheBtn) {
    clearCacheBtn.addEventListener("click", () => {
      extensionAPI.runtime.sendMessage({ action: "CLEAR_CACHE" }, () => {
        const orig = clearCacheBtn.textContent;
        clearCacheBtn.textContent = "✅ Cleared!";
        setTimeout(() => (clearCacheBtn.textContent = orig), 1200);
        const q = searchInput.value.trim();
        if (q) performSearch(q);
      });
    });
  }

  // 2. Auto-Detect Product Title from Active Safari Tab
  extensionAPI.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs && tabs[0] && tabs[0].url) {
      const activeUrl = tabs[0].url;
      if (
        activeUrl.includes("amazon.in") ||
        activeUrl.includes("swiggy.com") ||
        activeUrl.includes("zepto.com") ||
        activeUrl.includes("blinkit.com")
      ) {
        extensionAPI.tabs.sendMessage(tabs[0].id, { action: "GET_PAGE_PRODUCT_DATA" }, (resp) => {
          if (extensionAPI.runtime.lastError) {
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

    extensionAPI.runtime.sendMessage(
      {
        action: "SEARCH_QUERY",
        payload: { query }
      },
      (response) => {
        loadingState.style.display = "none";
        if (response && response.success && response.data) {
          currentResults = response.data;
          renderCards(response.data);
          updateDebugLogs();
        } else {
          cardsGrid.innerHTML = `<div class="error-msg" style="text-align:center; padding:20px; color:#EF4444;">Search failed: ${
            response?.error || 'Unknown error'
          }</div>`;
          updateDebugLogs();
        }
      }
    );
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
            ${store.priceBreakdown.savings > 0 ? `<span class="price-mrp">₹${store.item.mrp}</span>` : ''}
            ${store.priceBreakdown.savings > 0 ? `<span class="price-save">${store.priceBreakdown.discountPercent}% OFF</span>` : ''}
          </div>
          <a href="${store.productUrl}" target="_blank" class="btn-buy" rel="noopener noreferrer">View Store</a>
        `;
      } else {
        priceHtml = `<span class="store-unavailable">${store.statusMessage || 'Not available'}</span>`;
      }

      card.innerHTML = `
        <div class="card-header">
          <div class="store-brand">
            <span class="store-pill" style="background-color: ${bgColor}; color: ${textColor};">${store.platformName}</span>
          </div>
          <div class="badges-container">
            ${badgesHtml}
          </div>
        </div>
        ${
          store.item
            ? `
          <div class="card-body">
            <img src="${store.item.image}" class="prod-thumb" alt="${store.item.title}" onerror="this.src='../../assets/icon48.png'">
            <div class="prod-info">
              <span class="prod-title" title="${store.item.title}">${store.item.title}</span>
              <span class="prod-qty">${store.item.quantity || ''}</span>
            </div>
          </div>
        `
            : ''
        }
        <div class="card-footer">
          ${priceHtml}
        </div>
      `;

      cardsGrid.appendChild(card);
    });
  }

  // 6. Debug Inspector
  toggleDebugBtn.addEventListener("click", () => {
    const isHidden = debugDrawer.style.display === "none";
    debugDrawer.style.display = isHidden ? "flex" : "none";
    copyDebugBtn.style.display = isHidden ? "inline-block" : "none";
    toggleDebugBtn.textContent = isHidden ? "Hide Inspector" : "🛠️ Debug Inspector";
    if (isHidden) updateDebugLogs();
  });

  copyDebugBtn.addEventListener("click", () => {
    navigator.clipboard.writeText(debugOutput.textContent).then(() => {
      const orig = copyDebugBtn.textContent;
      copyDebugBtn.textContent = "✅ Copied!";
      setTimeout(() => (copyDebugBtn.textContent = orig), 1500);
    });
  });

  clearDebugBtn.addEventListener("click", () => {
    extensionAPI.runtime.sendMessage({ action: "CLEAR_DEBUG_LOGS" }, () => {
      debugOutput.textContent = "Logs cleared.";
    });
  });

  function updateDebugLogs() {
    extensionAPI.runtime.sendMessage({ action: "GET_DEBUG_LOGS" }, (response) => {
      if (response && response.success && response.data) {
        debugOutput.textContent = JSON.stringify(response.data, null, 2);
      }
    });
  }
});
