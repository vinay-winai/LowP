/**
 * LowP Options Page Script
 */

document.addEventListener("DOMContentLoaded", () => {
  const debugToggle = document.getElementById("debugToggle");

  // Debug logging preference (default: enabled)
  chrome.storage.sync.get(["lowp_debug_enabled"], (res) => {
    debugToggle.checked = !res || res.lowp_debug_enabled !== false;
  });

  debugToggle.addEventListener("change", () => {
    chrome.storage.sync.set({ lowp_debug_enabled: debugToggle.checked });
  });
});
