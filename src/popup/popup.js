/**
 * LowP Popup Script (Amazon, Swiggy Instamart, Zepto)
 */

document.addEventListener("DOMContentLoaded", () => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const searchInput = document.getElementById("searchInput");
  const searchBtn = document.getElementById("searchBtn");
  const cardsGrid = document.getElementById("cardsGrid");
  const loadingState = document.getElementById("loadingState");
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

  let currentResults = [];
  let strategyMatrixRows = [];
  let searchGeneration = 0;

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
  const openSettingsBtn = document.getElementById("openSettingsBtn");

  if (openSettingsBtn) {
    openSettingsBtn.addEventListener("click", () => {
      if (typeof chrome !== "undefined" && chrome.runtime?.openOptionsPage) {
        chrome.runtime.openOptionsPage();
      } else if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
        window.open(chrome.runtime.getURL("src/options/options.html"));
      }
    });
  }

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
    chrome.storage.local.get(["lowp_comparison_rows_v2", "lowp_strategy_matrix"], (res) => {
      const saved = res.lowp_comparison_rows_v2 || res.lowp_strategy_matrix;
      if (Array.isArray(saved) && !strategyMatrixRows.length) {
        strategyMatrixRows = saved.filter(row => row && row.stores).map(row => ({...row, stores: Object.fromEntries(Object.entries(row.stores).map(([id,cell]) => {
          const item = cell.item || (cell.isAvailable && cell.title ? {id: cell.title, title: cell.title, quantity:'', price:cell.price, mrp:cell.mrp, productUrl:cell.productUrl, image:'', brand:''} : null);
          return [id, {...cell, item, candidates: cell.candidates || (item ? [item] : []), isComparable: cell.isComparable ?? cell.isAvailable}];
        }))}));
        updateMatrixBadges();
      }
    });
  }

  function saveMatrixToStorage() {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ lowp_comparison_rows_v2: strategyMatrixRows });
    }
    updateMatrixBadges();
  }

  function updateMatrixBadges() {
    const count = strategyMatrixRows.length;
    if (matrixCount) matrixCount.textContent = count;
    if (matrixItemCountText) matrixItemCountText.textContent = `${count} ${count === 1 ? 'item' : 'items'} in comparison`;
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
  const packCount = document.getElementById("packCount");
  const collectionsPrevBtn = document.getElementById("collectionsPrevBtn");
  const collectionsNextBtn = document.getElementById("collectionsNextBtn");
  const collectionModalBackdrop = document.getElementById("collectionModalBackdrop");
  const collectionModalTitle = document.getElementById("collectionModalTitle");
  const closeCollectionModalBtn = document.getElementById("closeCollectionModalBtn");
  const collectionNameInput = document.getElementById("collectionNameInput");
  const storeCheckboxGrid = document.getElementById("storeCheckboxGrid");
  const deleteCollectionBtn = document.getElementById("deleteCollectionBtn");
  const saveCollectionBtn = document.getElementById("saveCollectionBtn");

  const MAX_COLLECTIONS = 7;

  let collections = [
    { id: "10_min_pack", name: "10 min pack", emoji: "⚡", storeIds: ["amazon_tez", "instamart", "zepto", "blinkit"] },
    { id: "big_online_pack", name: "Big Online Pack", emoji: "📦", storeIds: ["amazon_main", "flipkart"] }
  ];
  let activeCollectionId = "10_min_pack";
  let editingCollectionId = null;
  // Migrate stored packs: drop the retired "All Stores" pack, dedupe by id,
  // clamp to the 7-pack maximum. Users can recreate an all-stores pack as a
  // custom pack if they want it back.
  function normalizeCollections(list) {
    if (!Array.isArray(list)) return collections;
    const seen = new Set();
    const out = [];
    for (const col of list) {
      if (!col || typeof col.id !== "string" || typeof col.name !== "string") continue;
      if (!Array.isArray(col.storeIds) || col.storeIds.length === 0) continue;
      if (col.id === "all_stores") continue;
      if (seen.has(col.id)) continue;
      seen.add(col.id);
      out.push(col);
      if (out.length >= MAX_COLLECTIONS) break;
    }
    return out.length > 0 ? out : collections.slice(0, MAX_COLLECTIONS);
  }
  // Guards the initial GET_COLLECTIONS round-trip: if the user creates /
  // edits / deletes a pack before the async response arrives, the stale
  // response must not clobber the newer local state.
  let collectionsDirty = false;

  // Load Collections
  chrome.runtime.sendMessage({ action: "GET_COLLECTIONS" }, (res) => {
    if (chrome.runtime.lastError) {
      renderCollections();
      return;
    }
    if (res && res.success) {
      if (Array.isArray(res.collections) && res.collections.length > 0) {
        if (collectionsDirty) {
          // Merge: keep locally-created customs the server doesn't know yet.
          const serverById = new Map(res.collections.map((c) => [c.id, c]));
          collections.forEach((localCol) => {
            if (!serverById.has(localCol.id)) {
              res.collections.push(localCol);
            } else if (localCol.isCustom) {
              serverById.set(localCol.id, localCol);
            }
          });
          collections = normalizeCollections(res.collections.map((c) => serverById.get(c.id) || c));
          // Re-persist the merged set so other surfaces converge.
          chrome.runtime.sendMessage({ action: "SAVE_COLLECTIONS", payload: { collections } });
        } else {
          collections = normalizeCollections(res.collections);
        }
      }
      if (res.activeId) {
        const exists = collections.some((c) => c.id === res.activeId);
        // Only adopt the stored active id when it still exists (or when the
        // user hasn't already picked a newer one while loading).
        if (exists && !collectionsDirty) {
          activeCollectionId = res.activeId;
        } else if (!exists && !collectionsDirty) {
          activeCollectionId = collections[0] ? collections[0].id : "10_min_pack";
        }
      }
      renderCollections();
    }
  });

  function selectCollection(colId) {
    if (activeCollectionId === colId) return;
    activeCollectionId = colId;
    collectionsDirty = true;
    chrome.runtime.sendMessage({ action: "SET_ACTIVE_COLLECTION", payload: { collectionId: colId } });
    renderCollections();
    const q = searchInput.value.trim();
    if (q) performSearch(q);
  }

  function scrollPillIntoView(pillEl) {
    // Scroll within the strip only — scrollIntoView() would also scroll the
    // whole side panel / page, which feels broken in the narrow panel.
    try {
      if (!pillEl || !collectionsList) return;
      const listRect = collectionsList.getBoundingClientRect();
      const pillRect = pillEl.getBoundingClientRect();
      if (pillRect.left < listRect.left) {
        collectionsList.scrollLeft -= (listRect.left - pillRect.left + 8);
      } else if (pillRect.right > listRect.right) {
        collectionsList.scrollLeft += (pillRect.right - listRect.right + 8);
      }
    } catch (e) {}
  }

  function renderCollections() {
    if (!collectionsList) return;
    collectionsList.innerHTML = "";

    collections.forEach((col) => {
      const isActive = col.id === activeCollectionId;
      const pill = document.createElement("div");
      pill.className = `collection-pill ${isActive ? 'active' : ''}`;
      pill.setAttribute("data-id", col.id);
      pill.setAttribute("role", "tab");
      pill.setAttribute("tabindex", "0");
      pill.setAttribute("aria-selected", isActive ? "true" : "false");
      pill.title = `${col.name} — click to compare, ✎ to edit`;

      const emojiSpan = col.emoji ? `<span aria-hidden="true">${esc(col.emoji)}</span>` : '';
      // Every pack (built-in or created) is editable — the edit affordance is
      // a real button with a finger-sized hit area, not a tiny glyph span.
      pill.innerHTML = `${emojiSpan}<span class="pill-name">${esc(col.name)}</span><button type="button" class="pill-edit-btn" title="Edit ${esc(col.name)}" aria-label="Edit ${esc(col.name)}">✎</button>`;

      pill.addEventListener("click", (e) => {
        if (e.target.closest(".pill-edit-btn")) {
          e.stopPropagation();
          openCollectionModal(col);
          return;
        }
        selectCollection(col.id);
      });
      pill.addEventListener("keydown", (e) => {
        if (e.target.closest && e.target.closest(".pill-edit-btn")) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          selectCollection(col.id);
        }
      });
      const editBtn = pill.querySelector(".pill-edit-btn");
      if (editBtn) {
        editBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          openCollectionModal(col);
        });
      }

      collectionsList.appendChild(pill);
    });

    // Pack counter + limit affordance on the + Pack button.
    if (packCount) {
      packCount.textContent = `${collections.length}/${MAX_COLLECTIONS}`;
    }
    if (addCollectionBtn) {
      const atMax = collections.length >= MAX_COLLECTIONS;
      addCollectionBtn.disabled = atMax;
      addCollectionBtn.classList.toggle("disabled", atMax);
      addCollectionBtn.title = atMax
        ? `Maximum ${MAX_COLLECTIONS} packs reached — edit or delete a pack to add another`
        : `Create store pack (${collections.length}/${MAX_COLLECTIONS})`;
    }

    // Keep the active (often newly-created, appended at the end) pill visible.
    try {
      const activeEl = collectionsList.querySelector(`[data-id="${CSS.escape(activeCollectionId)}"]`);
      if (activeEl) scrollPillIntoView(activeEl);
    } catch (e) {}
  }

  if (collectionsPrevBtn) {
    collectionsPrevBtn.addEventListener("click", () => {
      if (collectionsList) collectionsList.scrollBy({ left: -160, behavior: "smooth" });
    });
  }
  if (collectionsNextBtn) {
    collectionsNextBtn.addEventListener("click", () => {
      if (collectionsList) collectionsList.scrollBy({ left: 160, behavior: "smooth" });
    });
  }

  // Paint defaults immediately so the bar is never empty while storage loads.
  renderCollections();

  function openCollectionModal(col = null) {
    // Creating a new pack past the maximum is blocked at the button and here.
    if (!col && collections.length >= MAX_COLLECTIONS) {
      alert(`Maximum ${MAX_COLLECTIONS} packs reached. Edit or delete a pack to add another.`);
      return;
    }
    editingCollectionId = col ? col.id : null;
    if (collectionModalTitle) {
      collectionModalTitle.textContent = col ? "Edit Collection" : "New Collection";
    }
    if (collectionNameInput) {
      collectionNameInput.value = col ? col.name : "";
    }
    if (deleteCollectionBtn) {
      // Every pack is deletable (built-ins included) except the last one —
      // deleting the final pack would leave search with no store set.
      const canDelete = !!col && collections.length > 1;
      deleteCollectionBtn.style.display = canDelete ? "block" : "none";
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
        if (collections.length >= MAX_COLLECTIONS) {
          alert(`Maximum ${MAX_COLLECTIONS} packs reached. Edit or delete a pack to add another.`);
          return;
        }
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

      collectionsDirty = true;
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
      if (collections.length <= 1) {
        alert("You need at least one pack. Create another pack before deleting this one.");
        return;
      }
      collections = collections.filter(c => c.id !== editingCollectionId);
      if (activeCollectionId === editingCollectionId) {
        activeCollectionId = collections[0] ? collections[0].id : "10_min_pack";
        chrome.runtime.sendMessage({ action: "SET_ACTIVE_COLLECTION", payload: { collectionId: activeCollectionId } });
      }
      collectionsDirty = true;
      chrome.runtime.sendMessage({ action: "SAVE_COLLECTIONS", payload: { collections } });
      renderCollections();
      closeCollectionModal();
      const q = searchInput.value.trim();
      if (q) performSearch(q);
    });
  }



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
      const previous = activeSearchPort;
      activeSearchPort = null;
      try { previous.disconnect(); } catch (e) {}
    }
  }

  function finishSearch(results, { error = null } = {}) {
    loadingState.style.display = "none";
    if (error) {
      cardsGrid.innerHTML = `<div class="error-msg" style="text-align:center; padding:20px; color:#EF4444;">Search failed: ${esc(error)}</div>`;
      updateDebugLogs();
      return;
    }
    currentResults = results;
    renderCards(results);
    if (resultTitleStore) setResultMeta('Searched from ' + ALL_STORES_META[resultTitleStore].name);
    const flipkart = currentResults.find(store => store.platformId === 'flipkart');
    const controller = detailAbort;
    if (flipkart && controller) C.enrichFlipkartQuantities(flipkart.candidates, controller.signal, (item, quantity) => {
      if (controller.signal.aborted) return;
      const current = currentResults.find(store => store.platformId === 'flipkart');
      current?.candidates.filter(candidate => candidate.productUrl === item.productUrl).forEach(candidate => {candidate.quantity = quantity;});
      renderCards(currentResults);
    });
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

  async function performSearch(query, forcePack = false) {
    if (!query.trim()) return;
    const generation = ++searchGeneration;
    await prefsReady;
    if (generation !== searchGeneration) return;
    resultTitleStore = forcePack ? null : titleStore;
    openMatrixBtn.hidden = !!resultTitleStore;
    history = C.normalizeSearchHistory([query,...history]);
    chrome.storage.local.set({lowp_search_history_v1: history});
    closeHistory(); searchInput.blur(); selectedComparison = null;
    detailAbort?.abort();
    detailAbort = new AbortController();
    loadingState.style.display = "flex";
    cardsGrid.innerHTML = "";
    currentResults = [];
    if (addToMatrixBtn) addToMatrixBtn.disabled = true;
    disconnectSearchPort();
    setResultMeta(null);

    const storeIds = resultTitleStore ? [resultTitleStore] : getActiveStoreIds();

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
      if (activeSearchPort !== port || !msg || typeof msg.type !== "string") return;

      if (msg.type === "RESULT" && msg.store) {
        const previous = results.findIndex(s => s.platformId === msg.store.platformId);
        if (previous >= 0) results[previous] = msg.store; else results.push(msg.store);
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
      if (activeSearchPort !== port) return;
      activeSearchPort = null;
      // If the worker died mid-stream, fall back to whatever arrived.
      if (results.length > 0) {
        finishSearch(results.slice());
      }
    });

    port.postMessage({ action: "SEARCH_QUERY_STREAM", payload: { query, storeIds } });
  }

  function legacySearch(query, storeIds) {
    const startedAt = Date.now();
    const generation = searchGeneration;
    chrome.runtime.sendMessage({
      action: "SEARCH_QUERY",
      payload: { query, storeIds }
    }, (response) => {
      if (generation !== searchGeneration) return;
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
        cardsGrid.innerHTML = `<div class="error-msg" style="text-align:center; padding:20px; color:#EF4444;">Search failed: ${esc(response?.error || 'Unknown error')}</div>`;
        updateDebugLogs();
      }
    });
  }

  const C = LowPCore;
  const safeUrl = value => {try {const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) ? esc(u.href) : '#';} catch {return '#';}};
  let offers = {}, history = [], titleStore = null, resultTitleStore = null;
  let historyTimer, focusedHistory = false, selectedComparison = null, detailAbort = null;
  const historyList = document.getElementById('historyList');
  const findTitle = document.getElementById('findTitle');
  const titleBanner = document.getElementById('titleBanner');
  const prefsReady = chrome.storage.local.get(['lowp_search_history_v1','lowp_find_title_store','lowp_store_offers_v1']).then(saved => {
    history = C.normalizeSearchHistory([...history, ...C.normalizeSearchHistory(saved.lowp_search_history_v1)]);
    titleStore = ALL_STORES_META[saved.lowp_find_title_store] ? saved.lowp_find_title_store : null;
    offers = saved.lowp_store_offers_v1 || {};
    findTitle.value = titleStore || '';
    updateTitleMode();
  }).catch(() => {updateTitleMode();});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.lowp_store_offers_v1) {
      offers = changes.lowp_store_offers_v1.newValue || {};
      if (matrixModalBackdrop.style.display !== 'none') renderMatrixModal();
    }
  });
  Object.values(ALL_STORES_META).forEach(store => {
    const option = document.createElement('option'); option.value = store.id; option.textContent = store.name; findTitle.appendChild(option);
  });
  function updateTitleMode() {
    titleBanner.hidden = !titleStore;
    document.getElementById('titleModeText').textContent = titleStore ? `Find title is on · ${ALL_STORES_META[titleStore].name}` : '';
    openMatrixBtn.hidden = !!resultTitleStore;
    if (currentResults.length) renderCards(currentResults);
  }
  findTitle.addEventListener('change', () => {titleStore = findTitle.value || null; chrome.storage.local.set({lowp_find_title_store: titleStore}); updateTitleMode();});
  document.getElementById('turnOffTitle').addEventListener('click', () => {titleStore = null; findTitle.value = ''; chrome.storage.local.set({lowp_find_title_store: null}); updateTitleMode();});
  const quickTags = document.getElementById('quickTags');
  ['milk','curd','potato','banana','atta','toor dal'].forEach(term => {const button = document.createElement('button'); button.textContent = term; button.onclick = () => {searchInput.value = term; performSearch(term);}; quickTags.appendChild(button);});
  function closeHistory() {clearTimeout(historyTimer); focusedHistory = false; historyList.hidden = true;}
  function showHistory() {
    if (!focusedHistory) return;
    historyList.style.top = `${searchInput.parentElement.offsetTop + searchInput.parentElement.offsetHeight - 1}px`;
    const room = (window.visualViewport?.height || innerHeight) - searchInput.parentElement.getBoundingClientRect().bottom - 8;
    const matches = C.historyMatches(history, searchInput.value).slice(0, Math.max(0, Math.min(10, Math.floor(room / 40))));
    historyList.replaceChildren();
    matches.forEach(term => {const button = document.createElement('button'); button.type = 'button'; button.setAttribute('role','option');
      const index = term.toLowerCase().indexOf(searchInput.value.trim().toLowerCase()), n = searchInput.value.trim().length;
      button.innerHTML = `<span aria-hidden="true">⌕</span><span class="history-term">${index >= 0 && n ? `${esc(term.slice(0,index))}<span class="typed">${esc(term.slice(index,index+n))}</span>${esc(term.slice(index+n))}` : esc(term)}</span>`;
      button.title = term; button.onmousedown = event => event.preventDefault(); button.onclick = () => {searchInput.value = term; performSearch(term);}; historyList.appendChild(button);
    });
    historyList.hidden = !matches.length;
  }
  searchInput.addEventListener('focus', () => {focusedHistory = true; showHistory();});
  searchInput.addEventListener('blur', event => {if (!historyList.contains(event.relatedTarget)) closeHistory();});
  searchInput.addEventListener('input', () => {clearTimeout(historyTimer); historyList.hidden = true; focusedHistory = true; if (!searchInput.value.trim()) showHistory(); else historyTimer = setTimeout(showHistory,180);});
  searchInput.addEventListener('keydown', event => {if (event.key === 'Escape') closeHistory(); if (event.key === 'ArrowDown' && !historyList.hidden) {event.preventDefault();historyList.querySelector('button')?.focus();}});
  document.addEventListener('click', event => {if (!event.target.closest('.search-section')) closeHistory();});
  window.addEventListener('resize', showHistory);
  historyList.addEventListener('keydown', event => {if (event.key === 'Escape') {closeHistory();searchInput.focus();historyList.hidden=true;} });
  historyList.addEventListener('focusout', event => {if (event.relatedTarget !== searchInput && !historyList.contains(event.relatedTarget)) closeHistory();});

  function normalizeResults(results) {
    return results.map(store => ({...store, candidates: (store.candidates?.length ? store.candidates : store.item ? [store.item] : []).slice(0,3).map(item => ({...item, quantity: C.MatchingEngine.extractQuantity(item.quantity || '') || C.MatchingEngine.extractQuantity(item.title || '') || (item.quantity !== '1 unit' ? item.quantity : '') || ''}))}));
  }
  function renderCards(results) {
    currentResults = normalizeResults(results);
    if (selectedComparison) currentResults = C.reshuffleMatches(currentResults, selectedComparison);
    cardsGrid.innerHTML = currentResults.map(store => `<section class="store-card"><div class="card-header"><h3>${esc(store.platformName)}</h3><span class="muted">${store.durationMs != null ? `${(store.durationMs/1000).toFixed(2)}s` : ''}</span></div>
      ${store.candidates.length ? store.candidates.map((item,index) => {
        const selected = selectedComparison?.stores[store.platformId]?.item;
        const active = selected && selected.title === item.title && selected.price === item.price;
        return `<article class="product ${active ? 'selected' : ''}"><div class="product-heading"><strong>${esc(item.title)}</strong><button data-search-title="${store.platformId}" data-index="${index}" title="Search this title and size" aria-label="Search ${esc(item.title)}">⌕</button></div><div class="product-details"><span>${esc(item.quantity)}</span><b>₹${item.price}</b></div><div class="product-actions">${resultTitleStore ? `<button data-search-title="${store.platformId}" data-index="${index}">Use this title</button>` : `<button data-compare="${store.platformId}" data-index="${index}">Compare this</button>`}<a target="_blank" rel="noopener" href="${safeUrl(item.productUrl || store.searchUrl || store.productUrl)}">View in store ↗</a></div></article>`;
      }).join('') : `<p class="empty-state">No products returned. Try again or open the store.</p><a href="${safeUrl(store.searchUrl || store.globalUrl || store.productUrl)}" target="_blank" rel="noopener">Open store ↗</a>`}</section>`).join('');
  }
  cardsGrid.addEventListener('click', event => {
    const button = event.target.closest('button[data-compare],button[data-search-title]'); if (!button) return;
    const id = button.dataset.compare || button.dataset.searchTitle, store = currentResults.find(s => s.platformId === id), item = store?.candidates[Number(button.dataset.index)]; if (!item) return;
    if (button.dataset.searchTitle) {const term = C.productSearchTitle(item); searchInput.value = term; performSearch(term, true); return;}
    const row = C.compareProduct(store,item,currentResults,searchInput.value);
    selectedComparison = row;
    const existing = strategyMatrixRows.findIndex(r => r.selectionKey === row.selectionKey);
    if (existing >= 0) strategyMatrixRows[existing] = row; else strategyMatrixRows.push(row);
    saveMatrixToStorage(); renderCards(currentResults); openMatrixModal();
  });
  function openMatrixModal() {renderMatrixModal(); matrixModalBackdrop.style.display = 'flex';}
  function closeMatrixModal() {matrixModalBackdrop.style.display = 'none';}
  openMatrixBtn.addEventListener('click',openMatrixModal);
  closeMatrixBtn.addEventListener('click',closeMatrixModal);
  clearMatrixBtn.addEventListener('click', () => {strategyMatrixRows = []; selectedComparison = null; saveMatrixToStorage(); renderMatrixModal(); renderCards(currentResults);});
  document.getElementById('shareComparison').addEventListener('click', async () => {
    const text = strategyMatrixRows.map(C.refreshComparison).map(row => `${row.query}\n${Object.values(row.stores).map(cell => `${cell.platformName}: ${cell.isAvailable ? `₹${cell.effectivePrice ?? cell.price} — ${cell.item?.title || ''}${cell.effectiveQuantity ? ` (estimate for ${cell.effectiveQuantity}; actual pack ₹${cell.price})` : ''}` : 'No match'}`).join('\n')}`).join('\n\n');
    try {await navigator.clipboard.writeText(text + '\n\nProduct prices only; check checkout fees and offer eligibility.'); document.getElementById('shareStatus').textContent='Comparison copied.';} catch {document.getElementById('shareStatus').textContent='Could not copy comparison.';}
  });
  function basketHtml(basket, incomplete = false) {
    return `<section class="basket"><h4>${esc(basket.name)} · ₹${basket.effectiveTotal}</h4><p>Product subtotal ₹${basket.subtotal}</p>${basket.discount ? `<p>${basket.cardPercent}% card discount applied: −₹${basket.discount}</p>` : ''}${basket.cashback ? `<p>₹${basket.reachedThreshold} milestone cashback: −₹${basket.cashback}</p>` : ''}${basket.next ? `<p>₹${basket.next.remaining} more to reach ₹${basket.next.threshold} for ₹${basket.next.additional} additional cashback</p>` : ''}${incomplete ? `<p>${basket.count} items included. ${basket.missing.map(m => `${esc(m.title)} (${m.excluded ? 'excluded from total' : 'missing'})`).join('; ')}</p>` : ''}</section>`;
  }
  function renderMatrixModal() {
    strategyMatrixRows = strategyMatrixRows.map(C.refreshComparison);
    updateMatrixBadges();
    if (!strategyMatrixRows.length) {matrixModalBody.innerHTML = '<p class="empty-state">Choose “Compare this” on a product to start your comparison.</p>'; return;}
    const baskets = C.comparisonBaskets(strategyMatrixRows, offers);
    matrixModalBody.innerHTML = `<h3>Complete basket</h3>${baskets.complete.length ? baskets.complete.map(b=>basketHtml(b)).join('') : '<p>No store has every item included yet.</p>'}<p class="muted">Totals use effective prices for your selected sizes. Check checkout fees and offer eligibility.</p>${baskets.incomplete.length ? `<h3>Incomplete stores</h3>${baskets.incomplete.map(b=>basketHtml(b,true)).join('')}` : ''}
      ${strategyMatrixRows.map(row => `<section class="comparison-row"><div class="card-header"><h3>${esc(row.query)}</h3><button data-row-remove="${row.id}" aria-label="Remove comparison">×</button></div>${Object.values(row.stores).map(cell => `<article class="product ${cell.isCheapestInRow ? 'selected' : ''}"><div class="card-header"><strong>${esc(cell.platformName)}</strong><b>${cell.isAvailable ? `${cell.effectiveQuantity ? 'Effective ' : ''}₹${cell.effectivePrice ?? cell.price}` : '—'}</b></div><p>${esc(cell.item?.title || 'No close match')}</p><p class="muted">${esc(cell.item?.quantity || '')}${cell.effectiveQuantity ? ` · For ${esc(cell.effectiveQuantity)} · Actual pack ₹${cell.price}. Size-adjusted estimate.` : ''}</p>${cell.isAvailable && !cell.isComparable ? `<p class="muted">Price differs by more than 20%.</p><button data-edit="include" data-row="${row.id}" data-store="${cell.platformId}">Include in totals</button>` : ''}<div class="product-actions"><button data-edit="swap" data-row="${row.id}" data-store="${cell.platformId}">${cell.isAvailable ? 'Swap' : 'Add'}</button>${cell.isAvailable ? `<button data-edit="price" data-row="${row.id}" data-store="${cell.platformId}">Edit price</button><button data-edit="remove" data-row="${row.id}" data-store="${cell.platformId}">Remove</button><a href="${safeUrl(cell.productUrl)}" target="_blank" rel="noopener">View ↗</a>` : ''}</div></article>`).join('')}</section>`).join('')}`;
  }
  const editDialog = document.getElementById('editDialog'), editBody = document.getElementById('editBody');
  document.getElementById('closeEdit').onclick = () => editDialog.close();
  function applyEdit(rowId, id, edit) {strategyMatrixRows = strategyMatrixRows.map(row => row.id === rowId ? C.editComparisonCell(row,id,edit) : row); saveMatrixToStorage(); renderMatrixModal();}
  matrixModalBody.addEventListener('click', event => {
    const remove = event.target.closest('[data-row-remove]');
    if (remove) {strategyMatrixRows = strategyMatrixRows.filter(row => row.id !== remove.dataset.rowRemove); saveMatrixToStorage(); renderMatrixModal(); return;}
    const button = event.target.closest('[data-edit]'); if (!button) return;
    const row = strategyMatrixRows.find(r => r.id === button.dataset.row), id = button.dataset.store, cell = row?.stores[id]; if (!cell) return;
    const kind = button.dataset.edit;
    if (kind === 'include' || kind === 'remove') return applyEdit(row.id,id,{kind});
    if (kind === 'price') {
      editBody.innerHTML = `<h3>Edit pack price</h3><form id="priceForm"><label>Price in rupees<input id="priceInput" inputmode="decimal" value="${cell.price}"></label><p id="priceError" role="alert"></p><button>Save price</button></form>`;
      editBody.querySelector('form').onsubmit = event => {event.preventDefault();const price=C.parseComparisonPrice(editBody.querySelector('input').value); if(price===null){editBody.querySelector('#priceError').textContent='Enter a valid price greater than zero.';return;}applyEdit(row.id,id,{kind:'price',price});editDialog.close();};
    } else {
      editBody.innerHTML = `<h3>Choose product · ${esc(cell.platformName)}</h3>${(cell.candidates || []).map((item,index) => `<button class="product choice ${cell.item?.title===item.title && cell.item?.productUrl===item.productUrl ? 'selected' : ''}" data-choice="${index}"><strong>${esc(item.title)}</strong><span>${esc(item.quantity)} · ₹${item.price}</span></button>`).join('') || '<p>No candidates. Search this item again.</p>'}`;
      editBody.querySelectorAll('[data-choice]').forEach(button => button.onclick=()=>{applyEdit(row.id,id,{kind:'swap',index:Number(button.dataset.choice)});editDialog.close();});
    }
    editDialog.showModal();
  });


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
