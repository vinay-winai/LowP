import {PlatformId} from '../types';
import {isStoreSessionUrl} from './StoreSession';

export const FALLBACK_ADDRESS_STORAGE_KEY = 'lowp_fallback_address_v1';
export const normalizeAddress = (value: string) => value.replace(/\s+/g, ' ').trim().slice(0, 500);
export const addressPin = (value: string) => value.match(/\b[1-9]\d{5}\b/)?.[0] || '';
export const normalizePinInput = (value: string) => value.replace(/\D/g, '').slice(0, 6);
export const isValidPin = (value: string) => /^[1-9]\d{5}$/.test(value);
export type AddressHelpResult = 'filled' | 'opened' | 'manual' | 'pin_required' | 'requires_login';
export const ADDRESS_HELP_LABELS: Record<AddressHelpResult, string> = {
  filled: 'Search filled. Choose the correct match in this store to apply it.',
  opened: 'Location panel opened, but no editable search field was found. Use the store’s controls, or reload and try Fill address again.',
  manual: 'Open the store’s delivery-location search, then tap Fill address. If it requires login, sign in here.',
  pin_required: 'This store needs a 6-digit PIN code. Add it to the address above, then tap Fill address.',
  requires_login: 'This store requires login before setting the location. Sign in here to continue.'
};
export function addressHelpLabel(id: PlatformId, result: AddressHelpResult): string {
  if (id === 'flipkart' && result === 'manual') return 'Flipkart has guest delivery PIN fields on product pages. Open a product, then tap Fill address to fill its delivery PIN field.';
  return ADDRESS_HELP_LABELS[result];
}

export function readAddressHelpMessage(raw: string, id: PlatformId, token: string, nativeUrl: string): AddressHelpResult | null {
  try {
    const payload = JSON.parse(raw);
    if (!token || payload.type !== 'LOWP_ADDRESS_HELPER' || payload.platformId !== id || payload.token !== token ||
        !isStoreSessionUrl(id, nativeUrl) || !isStoreSessionUrl(id, payload.url) ||
        new URL(nativeUrl).origin !== new URL(payload.url).origin ||
        !Object.prototype.hasOwnProperty.call(ADDRESS_HELP_LABELS, payload.result)) return null;
    return payload.result;
  } catch {return null;}
}

const ADDRESS_HELPER_SOURCE = String.raw`function assistAddress(platformId, token, query, pin) {
  if (window.top !== window) return;
  window.__lowpAddressHelper?.dispose();
  let opened = false, attempts = 0, openedAt = 0, readyAt = 0, lastControl, searchOpened = false, timer, finished = false;
  const start = Date.now();
  const visible = el => {
    if (el.closest('[hidden], [inert]')) return false;
    for (let node = el; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    }
    return Array.from(el.getClientRects()).some(r => r.width > 0 && r.height > 0);
  };
  const dispose = () => {finished = true; clearInterval(timer); window.removeEventListener('pagehide', dispose);};
  const finish = result => {
    if (finished) return;
    finished = true; dispose();
    window.ReactNativeWebView?.postMessage(JSON.stringify({type:'LOWP_ADDRESS_HELPER', platformId, token, url:location.href, result}));
  };
  const tick = () => {
    if (finished) return;
    const fields = Array.from(document.querySelectorAll('input')).filter(input => {
      if (input.disabled || input.readOnly || !visible(input) || !['text','search','tel','number'].includes(input.type)) return false;
      const label = [input.getAttribute('placeholder'), input.getAttribute('aria-label'), input.id].filter(Boolean).join(' ');
      if (/otp|password|verification|security|login|sign\s*in/i.test(label)) return false;
      const form = input.closest('form');
      if (form && /\b(?:otp|password|verification|log\s*in|sign\s*in|sign\s*up)\b/i.test(form.textContent || '')) return false;
      return /(?:search|enter).*(?:address|location|area|street)|(?:address|location).*search|pin\s*code|pincode|GLUXZipUpdateInput/i.test(label);
    });
    if (fields.length) {
      const input = fields[0];
      const label = [input.id,input.placeholder,input.getAttribute('aria-label')].join(' ');
      const postal = /pin\s*code|pincode|GLUXZipUpdateInput/i.test(label) && !/search.*(?:area|street|address|location)/i.test(label);
      if (postal && !pin) {finish('pin_required'); return;}
      const value = postal ? pin : query;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
      if (!setter) {finish('manual'); return;}
      input.scrollIntoView({block:'center'}); input.focus(); setter.call(input, value);
      input.dispatchEvent(new Event('input',{bubbles:true})); input.dispatchEvent(new Event('change',{bubbles:true}));
      // Never press Enter, submit a form or choose a suggestion. Store lists are
      // independent; the user confirms the address in this store's own UI.
      finish('filled'); return;
    }
    const phoneForm = Array.from(document.querySelectorAll('input')).some(input =>
      /^enter (?:your )?(?:mobile|phone) number$/i.test(input.placeholder || '') && visible(input));
    if (phoneForm) {finish('requires_login'); return;}
    // Swiggy first opens a location summary; its search row opens the actual
    // editable field. This control only opens search, never applies a match.
    const locationSearch = platformId === 'instamart' && document.querySelector('[data-testid="search-location"]');
    if(locationSearch && visible(locationSearch)) {
      if(!searchOpened) {searchOpened = true; locationSearch.click();}
      if(Date.now() - start >= 6000) finish('opened');
      return;
    }
    const locationPanel = Array.from(document.querySelectorAll('h1,h2,h3,div,span')).some(el =>
      el.children.length === 0 && /^(?:saved addresses|your location|use my current location)$/i.test((el.textContent || '').trim()) && visible(el));
    if (!locationPanel && (!opened || (platformId !== 'flipkart' && attempts < 3 && Date.now() - openedAt >= 1800 && !Array.from(document.querySelectorAll('[role="dialog"]')).some(visible)))) {
      const selectors = {
        blinkit:'header [class*="LocationBar__Container"]',
        amazon_main:'#nav-global-location-popover-link',
        amazon_tez:'[aria-label="Deliver to"], [data-testid="delivery-location"]',
        zepto:'[data-testid="user-address"], [data-testid="address-container"], [data-testid="location-selector"], [aria-label="Select Location"], [aria-label="select location"]',
        instamart:'[data-testid="address-bar"], [aria-label="double tap to change location"], [aria-label="double tap to change delivery location"]',
        // Verified mobile home address row: an unlabelled, href-less link with
        // Flipkart's location-pin icon. Avoid generated layout class names.
        flipkart:'[aria-label="Change delivery location"], a:not([href]):has(svg path[d^="M9.08414 13.8688C10.5546"])'
      };
      const anchor = document.querySelector(selectors[platformId]);
      let specific = anchor?.closest('button, a, [role="button"]') || anchor;
      if(platformId === 'flipkart' && !specific) {
        // Flipkart's mobile product page uses the selected-address row itself
        // as the control; it has no label or href after a location is selected.
        const heading = Array.from(document.querySelectorAll('div')).find(el => el.children.length === 0 && /^delivery details$/i.test((el.textContent || '').trim()));
        const section = heading?.parentElement?.parentElement;
        if(section && (section.textContent || '').length < 1200) specific = section.querySelector('a:not([href])');
      }
      const controls = Array.from(document.querySelectorAll('header button, header a, button, [role="button"], a, span'));
      const control = specific && visible(specific) ? specific : controls.find(el => {
        const label = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g,' ').trim();
        const locationLabel = /^(?:select (?:delivery )?location|change (?:delivery )?(?:location|address)|delivery location|deliver to(?: .{1,60})?|enter (?:delivery )?pin\s*code)$/i.test(label);
        // Flipkart replaces its PIN input with a Change link after applying a PIN.
        // Restrict that generic link to the delivery section, never an account control.
        let deliveryContext = false;
        if(platformId === 'flipkart' && /^change$/i.test(label)) {
          for(let parent = el.parentElement, depth = 0; parent && depth < 4; parent = parent.parentElement, depth++) {
            const text = parent.textContent || ''; if(text.length > 1200) break;
            if(/delivery|deliver to|pincode|pin code/i.test(text)) {deliveryContext = true; break;}
          }
        }
        const changePin = deliveryContext;
        return (locationLabel || changePin) && visible(el);
      });
      if (control) {
        // A newly rendered Flipkart home row can open a partial panel before
        // hydration completes. Let the same control settle before pressing it.
        if(platformId === 'flipkart' && location.pathname === '/') {
          if(lastControl !== control) {lastControl = control; readyAt = Date.now(); return;}
          if(Date.now() - readyAt < 1500) return;
        }
        const href = control.getAttribute('href');
        if (href) {try {const url = new URL(href,location.href); if(url.origin !== location.origin || /logout|signout|sign-out/i.test(url.href)) {finish('manual');return;}} catch {finish('manual');return;}}
        opened = true; attempts++; openedAt = Date.now();
        control.click();
      }
    }
    if (Date.now() - start >= 6000) finish(locationPanel ? 'opened' : 'manual');
  };
  timer = setInterval(tick,300);
  window.__lowpAddressHelper = {dispose};
  window.addEventListener('pagehide',dispose,{once:true});
  tick();
}`;

export function addressHelperScript(id: PlatformId, token: string, address: string): string {
  const query = normalizeAddress(address);
  return `(${ADDRESS_HELPER_SOURCE})(${JSON.stringify(id)}, ${JSON.stringify(token)}, ${JSON.stringify(query)}, ${JSON.stringify(addressPin(query))}); true;`;
}
