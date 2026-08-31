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
  const resultMeta = document.getElementById("resultMeta");

  function setResultMeta(text) {
    if (!resultMeta) return;
    if (!text) {
      resultMeta.style.display = "none";
      resultMeta.textContent = "";
      return;
    }
    resultMeta.textContent = text;
    resultMeta.style.display = "block";
  }

  let activeLocation = null;
  let currentResults = [];
  let strategyMatrixRows = [];

  const addToMatrixBtn = document.getElementById("addToMatrixBtn");
  const addToMatrixText = document.getElementById("addToMatrixText");
  const viewMatrixBtn = document.getElementById("viewMatrixBtn");
  const openMatrixBtn = document.getElementById("openMatrixBtn");
  const matrixCount = document.getElementById("matrixCount");
  const matrixModalBackdrop = document.getElementById("matrixModalBackdrop");
  const matrixModalBody = document.getElementById("matrixModalBody");
  const matrixItemCountText = document.getElementById("matrixItemCountText");
  const clearMatrixBtn = document.getElementById("clearMatrixBtn");
  const closeMatrixBtn = document.getElementById("closeMatrixBtn");

  // Hide Debug Inspector entirely when the user disabled logging in Options.
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.sync) {
    chrome.storage.sync.get(["lowp_debug_enabled"], (res) => {
      if (res && res.lowp_debug_enabled === false) {
        [toggleDebugBtn, copyDebugBtn, clearDebugBtn].forEach((btn) => {
          if (btn) btn.style.display = "none";
        });
        if (debugDrawer) debugDrawer.style.display = "none";
      }
    });
  }

  // Load saved Strategy Matrix from storage
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(["lowp_strategy_matrix"], (res) => {
      if (res && res.lowp_strategy_matrix && Array.isArray(res.lowp_strategy_matrix)) {
        strategyMatrixRows = res.lowp_strategy_matrix;
        updateMatrixBadges();
      }
    });
  }

  function saveMatrixToStorage() {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ lowp_strategy_matrix: strategyMatrixRows });
    }
    updateMatrixBadges();
  }

  function updateMatrixBadges() {
    const count = strategyMatrixRows.length;
    if (matrixCount) matrixCount.textContent = count;
    if (matrixItemCountText) matrixItemCountText.textContent = `${count} ${count === 1 ? 'Item' : 'Items'} in Basket • Multi-Store Arbitrage`;
  }

  const ALL_STORES_META = {
    amazon_tez: { id: "amazon_tez", name: "Amazon Now (Tez)", logo: "⚡", color: "#FF9900" },
    instamart: { id: "instamart", name: "Swiggy Instamart", logo: "🧡", color: "#FC8019" },
    zepto: { id: "zepto", name: "Zepto", logo: "🟣", color: "#7C3AED" },
    blinkit: { id: "blinkit", name: "Blinkit", logo: "🟡", color: "#F8CB46" },
    amazon_main: { id: "amazon_main", name: "Amazon.in", logo: "📦", color: "#FF9900" },
    flipkart: { id: "flipkart", name: "Flipkart", logo: "🛍️", color: "#2874F0" }
  };

  const collectionsList = document.getElementById("collectionsList");
  const addCollectionBtn = document.getElementById("addCollectionBtn");
  const collectionModalBackdrop = document.getElementById("collectionModalBackdrop");
  const collectionModalTitle = document.getElementById("collectionModalTitle");
  const closeCollectionModalBtn = document.getElementById("closeCollectionModalBtn");
  const collectionNameInput = document.getElementById("collectionNameInput");
  const storeCheckboxGrid = document.getElementById("storeCheckboxGrid");
  const deleteCollectionBtn = document.getElementById("deleteCollectionBtn");
  const saveCollectionBtn = document.getElementById("saveCollectionBtn");

  let collections = [
    { id: "10_min_pack", name: "10 min pack", emoji: "⚡", storeIds: ["amazon_tez", "instamart", "zepto", "blinkit"] },
    { id: "big_online_pack", name: "Big Online Pack", emoji: "📦", storeIds: ["amazon_main", "flipkart"] },
    { id: "all_stores", name: "All Stores", emoji: "🛒", storeIds: ["amazon_tez", "instamart", "zepto", "blinkit", "amazon_main", "flipkart"] }
  ];
  let activeCollectionId = "10_min_pack";
  let editingCollectionId = null;

  // Load Collections
  chrome.runtime.sendMessage({ action: "GET_COLLECTIONS" }, (res) => {
    if (res && res.success) {
      if (Array.isArray(res.collections) && res.collections.length > 0) {
        collections = res.collections;
      }
      if (res.activeId) {
        activeCollectionId = res.activeId;
      }
      renderCollections();
    }
  });

  function renderCollections() {
    if (!collectionsList) return;
    collectionsList.innerHTML = "";

    collections.forEach((col) => {
      const pill = document.createElement("div");
      pill.className = `collection-pill ${col.id === activeCollectionId ? 'active' : ''}`;
      pill.setAttribute("data-id", col.id);
      
      const emojiSpan = col.emoji ? `<span>${col.emoji}</span>` : '';
      const nameSpan = `<span>${col.name}</span>`;
      const editBtn = col.isCustom ? `<span class="pill-edit-icon" title="Edit collection">✎</span>` : '';
      
      pill.innerHTML = `${emojiSpan}${nameSpan}${editBtn}`;

      pill.addEventListener("click", (e) => {
        if (e.target.classList.contains("pill-edit-icon")) {
          e.stopPropagation();
          openCollectionModal(col);
          return;
        }
        if (activeCollectionId !== col.id) {
          activeCollectionId = col.id;
          chrome.runtime.sendMessage({ action: "SET_ACTIVE_COLLECTION", payload: { collectionId: col.id } });
          renderCollections();
          const q = searchInput.value.trim();
          if (q) performSearch(q);
        }
      });

      collectionsList.appendChild(pill);
    });
  }

  function openCollectionModal(col = null) {
    editingCollectionId = col ? col.id : null;
    if (collectionModalTitle) {
      collectionModalTitle.textContent = col ? "Edit Collection" : "New Collection";
    }
    if (collectionNameInput) {
      collectionNameInput.value = col ? col.name : "";
    }
    if (deleteCollectionBtn) {
      deleteCollectionBtn.style.display = (col && col.isCustom) ? "block" : "none";
    }

    // Populate store checkboxes
    if (storeCheckboxGrid) {
      storeCheckboxGrid.innerHTML = "";
      const selectedSet = new Set(col ? col.storeIds : ["amazon_tez", "instamart", "zepto", "blinkit"]);
      
      Object.keys(ALL_STORES_META).forEach((id) => {
        const store = ALL_STORES_META[id];
        const isChecked = selectedSet.has(id);
        const item = document.createElement("label");
        item.className = `store-checkbox-item ${isChecked ? 'checked' : ''}`;
        item.innerHTML = `
          <input type="checkbox" value="${id}" ${isChecked ? 'checked' : ''} />
          <span class="store-checkbox-label">
            <span>${store.logo}</span>
            <span>${store.name}</span>
          </span>
        `;
        const cb = item.querySelector('input[type="checkbox"]');
        cb.addEventListener("change", () => {
          if (cb.checked) {
            item.classList.add("checked");
          } else {
            item.classList.remove("checked");
          }
        });
        storeCheckboxGrid.appendChild(item);
      });
    }

    if (collectionModalBackdrop) collectionModalBackdrop.style.display = "flex";
  }

  function closeCollectionModal() {
    if (collectionModalBackdrop) collectionModalBackdrop.style.display = "none";
    editingCollectionId = null;
  }

  if (addCollectionBtn) addCollectionBtn.addEventListener("click", () => openCollectionModal(null));
  if (closeCollectionModalBtn) closeCollectionModalBtn.addEventListener("click", closeCollectionModal);

  if (saveCollectionBtn) {
    saveCollectionBtn.addEventListener("click", () => {
      const name = (collectionNameInput.value || "").trim();
      if (!name) {
        alert("Please enter a collection name.");
        return;
      }
      const checkedBoxes = storeCheckboxGrid.querySelectorAll('input[type="checkbox"]:checked');
      const selectedIds = Array.from(checkedBoxes).map(cb => cb.value);
      if (selectedIds.length === 0) {
        alert("Please select at least one store.");
        return;
      }

      if (editingCollectionId) {
        const idx = collections.findIndex(c => c.id === editingCollectionId);
        if (idx !== -1) {
          collections[idx].name = name;
          collections[idx].storeIds = selectedIds;
        }
      } else {
        const newId = `custom_${Date.now()}`;
        collections.push({
          id: newId,
          name,
          emoji: "📁",
          storeIds: selectedIds,
          isCustom: true
        });
        activeCollectionId = newId;
        chrome.runtime.sendMessage({ action: "SET_ACTIVE_COLLECTION", payload: { collectionId: newId } });
      }

      chrome.runtime.sendMessage({ action: "SAVE_COLLECTIONS", payload: { collections } });
      renderCollections();
      closeCollectionModal();

      const q = searchInput.value.trim();
      if (q) performSearch(q);
    });
  }

  if (deleteCollectionBtn) {
    deleteCollectionBtn.addEventListener("click", () => {
      if (!editingCollectionId) return;
      collections = collections.filter(c => c.id !== editingCollectionId);
      if (activeCollectionId === editingCollectionId) {
        activeCollectionId = "10_min_pack";
        chrome.runtime.sendMessage({ action: "SET_ACTIVE_COLLECTION", payload: { collectionId: activeCollectionId } });
      }
      chrome.runtime.sendMessage({ action: "SAVE_COLLECTIONS", payload: { collections } });
      renderCollections();
      closeCollectionModal();
      const q = searchInput.value.trim();
      if (q) performSearch(q);
    });
  }

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

  // 2. Auto-Detect Product Title from Active Tab
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs && tabs[0] && tabs[0].url) {
      const activeUrl = tabs[0].url;
      if (activeUrl.includes("amazon.in") || activeUrl.includes("swiggy.com") || activeUrl.includes("zepto.com") || activeUrl.includes("flipkart.com") || activeUrl.includes("blinkit.com")) {
        chrome.tabs.sendMessage(tabs[0].id, { action: "GET_PAGE_PRODUCT_DATA", waitMs: 800 }, (resp) => {
          if (chrome.runtime.lastError) {
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

  // 4. Perform Search (progressive: each store card appears as soon as its
  // provider settles, instead of waiting for all stores)
  let activeSearchPort = null;

  function disconnectSearchPort() {
    if (activeSearchPort) {
      try { activeSearchPort.disconnect(); } catch (e) {}
      activeSearchPort = null;
    }
  }

  function finishSearch(results, { error = null } = {}) {
    loadingState.style.display = "none";
    if (error) {
      cardsGrid.innerHTML = `<div class="error-msg" style="text-align:center; padding:20px; color:#EF4444;">Search failed: ${error}</div>`;
      updateDebugLogs();
      return;
    }
    currentResults = results;
    renderCards(results);
    updateDebugLogs();

    // Enable Add to Matrix if any price is available
    const hasPrice = currentResults.some(s => s.isAvailable && s.priceBreakdown && s.priceBreakdown.finalPayable > 0);
    if (addToMatrixBtn) {
      addToMatrixBtn.disabled = !hasPrice;
    }
  }

  function getActiveStoreIds() {
    const current = collections.find(c => c.id === activeCollectionId);
    return current ? current.storeIds : ["amazon_tez", "instamart", "zepto", "blinkit"];
  }

  function performSearch(query) {
    loadingState.style.display = "flex";
    cardsGrid.innerHTML = "";
    currentResults = [];
    if (addToMatrixBtn) addToMatrixBtn.disabled = true;
    disconnectSearchPort();
    setResultMeta(null);

    const storeIds = getActiveStoreIds();

    if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.connect) {
      legacySearch(query, storeIds);
      return;
    }

    try {
      activeSearchPort = chrome.runtime.connect({ name: "search-stream" });
    } catch (e) {
      legacySearch(query, storeIds);
      return;
    }

    const results = [];
    const render = () => renderCards(results.slice());
    const port = activeSearchPort;

    port.onMessage.addListener((msg) => {
      if (!msg || typeof msg.type !== "string") return;

      if (msg.type === "RESULT" && msg.store) {
        results.push(msg.store);
        loadingState.style.display = "none";
        render();
        updateDebugLogs();
        return;
      }

      if (msg.type === "DONE") {
        disconnectSearchPort();
        if (results.length === 0) {
          cardsGrid.innerHTML = `<div class="error-msg" style="text-align:center; padding:20px; color:var(--text-sub);">No live prices found for this item.</div>`;
          loadingState.style.display = "none";
          setResultMeta(null);
          updateDebugLogs();
          return;
        }
        const cached = results.some((s) => s.cachedAt) ? " • from cache" : "";
        setResultMeta(`${results.length} stores • ${((msg.durationMs || 0) / 1000).toFixed(2)}s${cached}`);
        finishSearch(results.slice());
        return;
      }

      if (msg.type === "ERROR") {
        disconnectSearchPort();
        if (results.length > 0) {
          finishSearch(results.slice());
        } else {
          finishSearch([], { error: msg.error || "Unknown error" });
        }
      }
    });

    port.onDisconnect.addListener(() => {
      if (activeSearchPort === port) activeSearchPort = null;
      // If the worker died mid-stream, fall back to whatever arrived.
      if (results.length > 0) {
        finishSearch(results.slice());
      }
    });

    port.postMessage({ action: "SEARCH_QUERY_STREAM", payload: { query, storeIds } });
  }

  function legacySearch(query, storeIds) {
    const startedAt = Date.now();
    chrome.runtime.sendMessage({
      action: "SEARCH_QUERY",
      payload: { query, storeIds }
    }, (response) => {
      loadingState.style.display = "none";
      if (response && response.success && response.data) {
        const cached = response.data.some((s) => s.cachedAt) ? " • from cache" : "";
        setResultMeta(`${response.data.length} stores • ${((Date.now() - startedAt) / 1000).toFixed(2)}s${cached}`);
        currentResults = response.data;
        renderCards(response.data);
        updateDebugLogs();

        // Enable Add to Matrix if any price is available
        const hasPrice = currentResults.some(s => s.isAvailable && s.priceBreakdown && s.priceBreakdown.finalPayable > 0);
        if (addToMatrixBtn) {
          addToMatrixBtn.disabled = !hasPrice;
        }
      } else {
        cardsGrid.innerHTML = `<div class="error-msg" style="text-align:center; padding:20px; color:#EF4444;">Search failed: ${response?.error || 'Unknown error'}</div>`;
        updateDebugLogs();
      }
    });
  }

  // 5. Render Store Cards
  function renderCards(results) {
    const available = results.filter((store) => {
      const candidates = Array.isArray(store.candidates) && store.candidates.length > 0
        ? store.candidates
        : (store.item ? [store.item] : []);
      const index = Math.min(Math.max(Number.isInteger(store.selectedIndex) ? store.selectedIndex : 0, 0), Math.max(0, candidates.length - 1));
      return store.isAvailable && Number(candidates[index]?.price) > 0;
    });
    const lowestPrice = available.length > 0
      ? Math.min(...available.map((store) => {
        const candidates = Array.isArray(store.candidates) && store.candidates.length > 0 ? store.candidates : [store.item];
        return Number(candidates[store.selectedIndex || 0]?.price);
      }))
      : null;
    results.forEach((store) => {
      const candidates = Array.isArray(store.candidates) && store.candidates.length > 0 ? store.candidates : [store.item];
      store.isLowestPrice = lowestPrice !== null && Number(candidates[store.selectedIndex || 0]?.price) === lowestPrice;
    });
    cardsGrid.innerHTML = "";

    results.forEach((store) => {
      const card = document.createElement("div");
      card.className = `store-card ${store.isLowestPrice ? 'highlight-lowest' : ''}`;

      const candidates = Array.isArray(store.candidates) && store.candidates.length > 0
        ? store.candidates
        : (store.item ? [store.item] : []);
      const selectedIndex = Math.min(Math.max(Number.isInteger(store.selectedIndex) ? store.selectedIndex : 0, 0), Math.max(0, candidates.length - 1));
      const selectedItem = candidates[selectedIndex] || store.item;
      const selectedPrice = Number(selectedItem?.price) || 0;

      const storeColors = {
        amazon_tez: "#FF9900",
        instamart: "#FC8019",
        zepto: "#7C3AED",
        blinkit: "#F8CB46"
      };

      const bgColor = storeColors[store.platformId] || "#38BDF8";
      const textColor = store.platformId === "blinkit" ? "#111827" : "#FFFFFF";
      const hasPrice = store.isAvailable && selectedPrice > 0;

      let badgesHtml = "";
      if (store.isLowestPrice && hasPrice) badgesHtml += `<span class="badge badge-lowest">🏆 Lowest Price</span>`;
      if (store.cachedAt && hasPrice) badgesHtml += `<span class="badge" style="background:rgba(148,163,184,0.2);color:var(--text-sub);">⚡ Cached</span>`;
      if (typeof store.durationMs === "number" && store.durationMs >= 0) {
        badgesHtml += `<span class="badge" style="background:rgba(148,163,184,0.15);color:var(--text-sub);">${(store.durationMs / 1000).toFixed(2)}s</span>`;
      }

      let priceHtml = "";
      if (hasPrice) {
        priceHtml = `
          <div class="price-box">
            <span class="price-main">₹${selectedPrice}</span>
          </div>
        `;
      } else {
        priceHtml = `
          <div class="price-box">
            <span class="price-main" style="font-size: 13px; color: var(--text-sub);">Item unavailable</span>
          </div>
        `;
      }

      const itemInfoHtml = hasPrice
        ? `
            <span class="item-title">${selectedItem?.title || store.platformName}</span>
            <span class="item-brand">${selectedItem?.brand || store.platformName} • ${selectedItem?.quantity || '1 unit'}</span>
          `
        : "";

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
            ${itemInfoHtml}
          </div>
          ${priceHtml}
        </div>

        ${candidates.length > 1 ? `
          <div class="candidate-switcher" style="display:flex;align-items:center;justify-content:center;gap:8px;margin:8px 0;font-size:11px;color:var(--text-sub);">
            <button type="button" class="candidate-prev" data-platform-id="${store.platformId}" aria-label="Previous match" ${selectedIndex === 0 ? 'disabled' : ''}>‹</button>
            <span>Match ${selectedIndex + 1} of ${candidates.length}</span>
            <button type="button" class="candidate-next" data-platform-id="${store.platformId}" aria-label="Next match" ${selectedIndex >= candidates.length - 1 ? 'disabled' : ''}>›</button>
          </div>
        ` : ''}

        <div class="card-action">
          ${(store.globalUrl || store.searchUrl) && (store.globalUrl !== (selectedItem?.productUrl || store.productUrl)) ? `
            <a href="${store.globalUrl || store.searchUrl}" target="_blank" class="store-global-link" title="Global search on ${store.platformName}">
              🔍 Search Store
            </a>
          ` : ''}
          <a href="${selectedItem?.productUrl || store.productUrl || store.globalUrl || store.searchUrl}" target="_blank" class="store-link">
            ${hasPrice ? `Get on ${store.platformName} →` : `Search on ${store.platformName} →`}
          </a>
        </div>
      `;

      cardsGrid.appendChild(card);
    });
  }

  cardsGrid.addEventListener("click", (event) => {
    const button = event.target.closest(".candidate-prev, .candidate-next");
    if (!button) return;
    const store = currentResults.find((result) => result.platformId === button.dataset.platformId);
    if (!store || !Array.isArray(store.candidates) || store.candidates.length < 2) return;
    const delta = button.classList.contains("candidate-next") ? 1 : -1;
    const current = Number.isInteger(store.selectedIndex) ? store.selectedIndex : 0;
    store.selectedIndex = Math.min(Math.max(current + delta, 0), store.candidates.length - 1);
    const selected = store.candidates[store.selectedIndex];
    store.item = selected;
    store.productUrl = selected.productUrl || store.productUrl;
    store.globalUrl = selected.globalUrl || store.globalUrl;
    store.searchUrl = selected.searchUrl || store.searchUrl;
    const price = Number(selected.price) || 0;
    const mrp = Number(selected.mrp) || price;
    const savings = Math.max(0, mrp - price);
    store.priceBreakdown = { basePrice: price, finalPayable: price, savings, discountPercent: mrp > 0 ? Math.round((savings / mrp) * 100) : 0 };
    renderCards(currentResults);
  });

  // 6. Strategy Matrix Logic
  if (addToMatrixBtn) {
    addToMatrixBtn.addEventListener("click", () => {
      const q = searchInput.value.trim();
      if (!q || currentResults.length === 0) return;

      const availableStores = currentResults.filter(s => s.isAvailable && s.priceBreakdown && s.priceBreakdown.finalPayable > 0);
      if (availableStores.length === 0) return;

      let minPrice = Infinity;
      let cheapestStoreId = null;

      availableStores.forEach(s => {
        const p = s.priceBreakdown.finalPayable;
        if (p < minPrice) {
          minPrice = p;
          cheapestStoreId = s.platformId;
        }
      });

      const storeCells = {};
      const STORES_LIST = [
        { id: 'amazon_tez', name: 'Amazon Tez', color: '#FF9900' },
        { id: 'instamart', name: 'Instamart', color: '#FC8019' },
        { id: 'zepto', name: 'Zepto', color: '#7C3AED' },
        { id: 'blinkit', name: 'Blinkit', color: '#F8CB46' },
        { id: 'amazon_main', name: 'Amazon.in', color: '#FF9900' },
        { id: 'flipkart', name: 'Flipkart', color: '#2874F0' }
      ];

      STORES_LIST.forEach(s => {
        const storeMatch = currentResults.find(r => r.platformId === s.id);
        const hasPrice = storeMatch && storeMatch.isAvailable && storeMatch.priceBreakdown && storeMatch.priceBreakdown.finalPayable > 0;
        storeCells[s.id] = {
          platformId: s.id,
          platformName: s.name,
          isAvailable: !!hasPrice,
          title: hasPrice ? (storeMatch.item?.title || s.name) : '',
          price: hasPrice ? storeMatch.priceBreakdown.finalPayable : 0,
          mrp: hasPrice ? (storeMatch.item?.mrp || storeMatch.priceBreakdown.finalPayable) : 0,
          productUrl: hasPrice ? storeMatch.productUrl : '#',
          isCheapestInRow: s.id === cheapestStoreId
        };
      });

      const newRow = {
        id: `matrix_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        query: q,
        addedAt: Date.now(),
        stores: storeCells,
        cheapestPrice: minPrice < Infinity ? minPrice : 0,
        cheapestStoreId
      };

      strategyMatrixRows.push(newRow);
      saveMatrixToStorage();

      // Feedback animation on Add Button
      const origText = addToMatrixText.textContent;
      addToMatrixText.textContent = "✅ Added to Matrix!";
      addToMatrixBtn.style.background = "#10B981";
      setTimeout(() => {
        addToMatrixText.textContent = origText;
        addToMatrixBtn.style.background = "";
      }, 1800);
    });
  }

  function openMatrixModal() {
    renderMatrixModal();
    if (matrixModalBackdrop) matrixModalBackdrop.style.display = "flex";
  }

  function closeMatrixModal() {
    if (matrixModalBackdrop) matrixModalBackdrop.style.display = "none";
  }

  if (viewMatrixBtn) viewMatrixBtn.addEventListener("click", openMatrixModal);
  if (openMatrixBtn) openMatrixBtn.addEventListener("click", openMatrixModal);
  if (closeMatrixBtn) closeMatrixBtn.addEventListener("click", closeMatrixModal);

  if (clearMatrixBtn) {
    clearMatrixBtn.addEventListener("click", () => {
      strategyMatrixRows = [];
      saveMatrixToStorage();
      renderMatrixModal();
    });
  }

  function renderMatrixModal() {
    if (!matrixModalBody) return;
    updateMatrixBadges();

    if (strategyMatrixRows.length === 0) {
      matrixModalBody.innerHTML = `
        <div class="matrix-empty">
          <span style="font-size: 40px;">🛒</span>
          <h4>Your Basket is Empty</h4>
          <p>Search groceries and click <strong>"+ Add to Strategy Matrix"</strong> to compare multi-store totals & calculate split savings!</p>
        </div>
      `;
      return;
    }

    const STORES_LIST = [
      { id: 'amazon_tez', name: 'Amazon Tez', color: '#FF9900' },
      { id: 'instamart', name: 'Instamart', color: '#FC8019' },
      { id: 'zepto', name: 'Zepto', color: '#7C3AED' },
      { id: 'blinkit', name: 'Blinkit', color: '#F8CB46' },
      { id: 'amazon_main', name: 'Amazon.in', color: '#FF9900' },
      { id: 'flipkart', name: 'Flipkart', color: '#2874F0' }
    ];

    // Totals calculation
    const storeTotals = {
      amazon_tez: { total: 0, count: 0 },
      instamart: { total: 0, count: 0 },
      zepto: { total: 0, count: 0 },
      blinkit: { total: 0, count: 0 },
      amazon_main: { total: 0, count: 0 },
      flipkart: { total: 0, count: 0 }
    };

    let optimalSplitTotal = 0;

    strategyMatrixRows.forEach(row => {
      optimalSplitTotal += row.cheapestPrice > 0 ? row.cheapestPrice : 0;
      STORES_LIST.forEach(s => {
        const c = row.stores[s.id];
        if (c && c.isAvailable && c.price > 0) {
          storeTotals[s.id].total += c.price;
          storeTotals[s.id].count += 1;
        }
      });
    });

    let bestSingleStoreId = null;
    let minSingleTotal = Infinity;

    STORES_LIST.forEach(s => {
      const st = storeTotals[s.id];
      if (st.count === strategyMatrixRows.length) {
        if (st.total < minSingleTotal) {
          minSingleTotal = st.total;
          bestSingleStoreId = s.id;
        }
      }
    });

    const bestStoreObj = STORES_LIST.find(s => s.id === bestSingleStoreId);
    const arbitrageSavings = minSingleTotal < Infinity && optimalSplitTotal > 0 && minSingleTotal > optimalSplitTotal
      ? minSingleTotal - optimalSplitTotal
      : 0;

    let html = `
      <div class="matrix-summary-row">
        <div class="matrix-stat-card optimal-stat-card">
          <div class="stat-header">⚡ OPTIMAL SPLIT TOTAL</div>
          <div class="stat-price">₹${optimalSplitTotal}</div>
          ${arbitrageSavings > 0 ? `<div class="stat-sub-green">Save ₹${arbitrageSavings} (${Math.round((arbitrageSavings/minSingleTotal)*100)}%) vs single store!</div>` : `<div class="stat-sub">Cheapest combination across stores</div>`}
        </div>

        ${bestStoreObj ? `
          <div class="matrix-stat-card">
            <div class="stat-header">🏬 BEST SINGLE STORE</div>
            <div class="stat-price">₹${minSingleTotal}</div>
            <div class="stat-sub" style="color: ${bestStoreObj.color}; font-weight: 700;">${bestStoreObj.name}</div>
          </div>
        ` : ''}
      </div>

      <div class="matrix-table-container">
        <table class="matrix-table">
          <thead>
            <tr>
              <th class="th-item">Search Item</th>
              ${STORES_LIST.map(s => `
                <th class="th-store" style="border-top: 2px solid ${s.color};">
                  <span class="store-dot" style="background: ${s.color};"></span>
                  <span style="color: ${s.color}; font-weight: 700;">${s.name}</span>
                </th>
              `).join('')}
            </tr>
          </thead>
          <tbody>
            ${strategyMatrixRows.map((row, idx) => `
              <tr>
                <td class="td-item">
                  <div class="td-item-wrap">
                    <span class="td-query">${row.query}</span>
                    <button class="delete-matrix-row-btn" data-row-id="${row.id}" title="Remove item">🗑️</button>
                  </div>
                </td>
                ${STORES_LIST.map(s => {
                  const c = row.stores[s.id];
                  const isCheapest = c && c.isCheapestInRow && c.price > 0;
                  if (c && c.isAvailable && c.price > 0) {
                    return `
                      <td class="td-store ${isCheapest ? 'td-cheapest' : ''}">
                        ${isCheapest ? `<span class="matrix-lowest-badge">🏆 Lowest</span>` : ''}
                        <div class="td-price">₹${c.price}</div>
                        ${c.title ? `<div class="td-title" title="${c.title}">${c.title}</div>` : ''}
                        <a href="${c.productUrl}" target="_blank" class="td-link">Buy →</a>
                      </td>
                    `;
                  } else {
                    return `
                      <td class="td-store td-unavailable">
                        <span class="td-dash">—</span>
                        <span class="td-unavail-text">Unavailable</span>
                      </td>
                    `;
                  }
                }).join('')}
              </tr>
            `).join('')}
          </tbody>
          <tfoot>
            <tr class="matrix-tfoot-row">
              <td class="td-item">
                <strong>Basket Total</strong>
                <div style="font-size: 10px; color: #64748B;">Single store</div>
              </td>
              ${STORES_LIST.map(s => {
                const st = storeTotals[s.id];
                const isBest = s.id === bestSingleStoreId;
                return `
                  <td class="td-store ${isBest ? 'td-best-single' : ''}">
                    ${isBest ? `<span class="matrix-lowest-badge">Best Single</span>` : ''}
                    <div class="td-price" style="${isBest ? 'color: #10B981;' : ''}">₹${st.total}</div>
                    <div style="font-size: 10px; color: #94A3B8;">${st.count}/${strategyMatrixRows.length} items</div>
                  </td>
                `;
              }).join('')}
            </tr>
          </tfoot>
        </table>
      </div>
    `;

    matrixModalBody.innerHTML = html;

    // Attach row delete listeners
    const deleteBtns = matrixModalBody.querySelectorAll(".delete-matrix-row-btn");
    deleteBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        const rowId = btn.getAttribute("data-row-id");
        strategyMatrixRows = strategyMatrixRows.filter(r => r.id !== rowId);
        saveMatrixToStorage();
        renderMatrixModal();
      });
    });
  }

  // 7. Debug Inspector Telemetry
  function updateDebugLogs() {
    // Skip the fetch/stringify/render cycle entirely while the drawer is
    // hidden — it runs on every card arrival otherwise.
    if (!debugDrawer || debugDrawer.style.display === "none") return;
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
    chrome.runtime.sendMessage({ action: "CLEAR_DEBUG_LOGS" }, () => {
      debugOutput.textContent = "Logs cleared.";
    });
  });
});
