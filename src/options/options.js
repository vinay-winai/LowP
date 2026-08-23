/**
 * LowP Options Page Script
 */

document.addEventListener("DOMContentLoaded", () => {
  const locNameInput = document.getElementById("locName");
  const locAddressInput = document.getElementById("locAddress");
  const addLocBtn = document.getElementById("addLocBtn");
  const profilesList = document.getElementById("profilesList");

  function loadProfiles() {
    chrome.storage.sync.get(["locationProfiles", "activeLocation"], (res) => {
      const profiles = res.locationProfiles || [];
      const active = res.activeLocation || profiles[0];

      profilesList.innerHTML = "";
      profiles.forEach((p) => {
        const card = document.createElement("div");
        const isActive = active && active.id === p.id;
        card.className = `profile-card ${isActive ? 'active' : ''}`;

        card.innerHTML = `
          <div class="profile-info">
            <span class="profile-name">${p.name} ${isActive ? '⚡ (Active)' : ''}</span>
            <span class="profile-desc">${p.address} • Pincode: ${p.pincode || 'N/A'}</span>
          </div>
          <div class="profile-actions">
            ${isActive ? `
              <span class="btn-set-active active-tag">Active</span>
            ` : `
              <button class="btn-set-active" data-id="${p.id}">Set Active</button>
              ${profiles.length > 1 ? `<button class="btn-delete" data-id="${p.id}" title="Delete">🗑️</button>` : ''}
            `}
          </div>
        `;

        profilesList.appendChild(card);
      });

      // Attach event listeners
      document.querySelectorAll(".btn-set-active[data-id]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = btn.getAttribute("data-id");
          chrome.runtime.sendMessage({ action: "SET_ACTIVE_LOCATION", payload: { profileId: id } }, () => {
            loadProfiles();
          });
        });
      });

      document.querySelectorAll(".btn-delete").forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = btn.getAttribute("data-id");
          chrome.runtime.sendMessage({ action: "DELETE_LOCATION_PROFILE", payload: { profileId: id } }, () => {
            loadProfiles();
          });
        });
      });
    });
  }

  addLocBtn.addEventListener("click", () => {
    const name = locNameInput.value.trim();
    const address = locAddressInput.value.trim();
    if (!address) return;

    chrome.runtime.sendMessage({
      action: "GEOCODE_ADDRESS",
      payload: { name, addressText: address }
    }, (res) => {
      if (res && res.success) {
        locNameInput.value = "";
        locAddressInput.value = "";
        loadProfiles();
      }
    });
  });

  const debugToggle = document.getElementById("debugToggle");

  // Debug logging preference (default: enabled)
  chrome.storage.sync.get(["lowp_debug_enabled"], (res) => {
    debugToggle.checked = !res || res.lowp_debug_enabled !== false;
  });

  debugToggle.addEventListener("change", () => {
    chrome.storage.sync.set({ lowp_debug_enabled: debugToggle.checked });
  });

  loadProfiles();
});
