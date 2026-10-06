/**
 * LowP Options Page Script
 */

document.addEventListener("DOMContentLoaded", () => {
  const names = {amazon_tez:'Amazon Now',instamart:'Swiggy Instamart',zepto:'Zepto',blinkit:'Blinkit',amazon_main:'Amazon.in',flipkart:'Flipkart'};
  const store = document.getElementById('offerStore'), tiers = document.getElementById('tiers'), card = document.getElementById('cardPercent'), status = document.getElementById('offerStatus');
  let offers = {};
  Object.entries(names).forEach(([id,name])=>{const option=document.createElement('option');option.value=id;option.textContent=name;store.appendChild(option);});
  function addTier(tier = {threshold:'',cashback:''}) {
    const row=document.createElement('div');row.className='tier';
    const threshold=document.createElement('input'),cashback=document.createElement('input'),remove=document.createElement('button');
    threshold.type=cashback.type='number';threshold.min='0.01';cashback.min='0';threshold.step=cashback.step='0.01';threshold.required=cashback.required=true;
    threshold.placeholder='Spend ₹';cashback.placeholder='Cashback ₹';threshold.setAttribute('aria-label','Spend threshold in rupees');cashback.setAttribute('aria-label','Cashback in rupees');threshold.value=tier.threshold;cashback.value=tier.cashback;
    remove.type='button';remove.textContent='Remove';remove.onclick=()=>row.remove();row.append(threshold,cashback,remove);tiers.appendChild(row);
  }
  function showOffer(){const offer=LowPCore.normalizeOffer(offers[store.value]);card.value=offer.cardPercent;tiers.replaceChildren();offer.tiers.forEach(addTier);status.textContent='';}
  store.onchange=showOffer;
  document.getElementById('addTier').onclick=()=>addTier();
  document.getElementById('offerForm').onsubmit=async event=>{event.preventDefault();offers[store.value]=LowPCore.normalizeOffer({cardPercent:Number(card.value),tiers:[...tiers.children].map(row=>({threshold:Number(row.children[0].value),cashback:Number(row.children[1].value)}))});try{await chrome.storage.local.set({lowp_store_offers_v1:offers});status.textContent='Offers saved.';}catch{status.textContent='Could not save. Please try again.';}};
  chrome.storage.local.get(['lowp_store_offers_v1']).then(saved=>{offers=saved.lowp_store_offers_v1||{};showOffer();});
  const debugToggle = document.getElementById("debugToggle");

  // Debug logging preference (default: enabled)
  chrome.storage.sync.get(["lowp_debug_enabled"], (res) => {
    debugToggle.checked = !res || res.lowp_debug_enabled !== false;
  });

  debugToggle.addEventListener("change", () => {
    chrome.storage.sync.set({ lowp_debug_enabled: debugToggle.checked });
  });
});
