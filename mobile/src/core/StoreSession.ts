import { PlatformId } from '../types';

export type SessionStatus = 'unknown' | 'checking' | 'signed_in' | 'signed_out';
export type SessionEvidence = 'logout_control' | 'login_control' | 'login_prompt' | 'login_form' | 'none';
export interface StoreSession {
  status: SessionStatus;
  evidence: SessionEvidence;
  checkedAt: number;
}
export interface SessionCheckJob {platformId: PlatformId; token: string;}
export interface StoreLocation {status: 'set' | 'needed' | 'unknown'; checkedAt: number;}
export const LOCATION_LABELS = {set: 'Location set', needed: 'Choose delivery location', unknown: 'Location unknown'};
export function updateStoreLocation(previous: Partial<Record<PlatformId, StoreLocation>>, id: PlatformId, location: StoreLocation): Partial<Record<PlatformId, StoreLocation>> {
  const fresh = (value?: StoreLocation) => !!value && value.checkedAt > 0 && Date.now() >= value.checkedAt;
  if(id === 'amazon_main') {
    const effective = location.status === 'unknown' && fresh(previous.amazon_main) ? previous.amazon_main! : location;
    return {...previous,amazon_main:effective,amazon_tez:effective};
  }
  // Amazon.in is authoritative for both Amazon pills, as with login status.
  if(id === 'amazon_tez' && previous.amazon_main) return {...previous,amazon_tez:previous.amazon_main};
  const last = previous[id];
  if(location.status === 'unknown' && fresh(last)) return previous;
  return {...previous, [id]: location};
}
export function readLocationMessage(raw: string, id: PlatformId, token: string, nativeUrl: string): StoreLocation | null {
  try {
    const p = JSON.parse(raw);
    if (!token || p.type !== 'LOWP_LOCATION' || p.platformId !== id || p.token !== token ||
      !Object.prototype.hasOwnProperty.call(LOCATION_LABELS, p.status) || !isStoreSessionUrl(id, nativeUrl) ||
      !isStoreSessionUrl(id, p.url) || new URL(nativeUrl).origin !== new URL(p.url).origin) return null;
    return {status: p.status, checkedAt: Date.now()};
  } catch {return null;}
}
const LOCATION_OBSERVER_SOURCE = String.raw`function inspectLocation(id, token, observe) {
  window.__lowpLocationObserver?.dispose();
  let previous = '', timer;
  const selectors = {
    zepto:'[data-testid="user-address"], [data-testid="address-container"], [data-testid="location-selector"], [aria-label="Select Location"]',
    blinkit:'header [class*="LocationBar__Container"]',
    amazon_main:'#glow-ingress-line2, #nav-global-location-data-modal-action',
    amazon_tez:'[data-testid="delivery-location"], [aria-label="Deliver to"], #glow-ingress-line2, #nav-global-location-data-modal-action',
    instamart:'[data-testid="address-line"], [aria-label="double tap to change location"], [aria-label="double tap to change delivery location"]',
    flipkart:'[aria-label="Change delivery location"], a:not([href]):has(svg path[d^="M9.08414 13.8688C10.5546"])'
  };
  const tick = () => {
    let status = 'unknown';
    const nodes = Array.from(document.querySelectorAll(selectors[id]));
    const texts = nodes.filter(el => {
      if (el.closest('[hidden], [inert]')) return false;
      for (let n = el; n; n = n.parentElement) {const s = getComputedStyle(n); if(s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;}
      return Array.from(el.getClientRects()).some(r => r.width > 0 && r.height > 0);
    }).map(el => (el.textContent || el.getAttribute('aria-label') || '').replace(/\s+/g,' ').trim());
    const empty = /^(?:select (?:your |delivery )?location|select (?:your |delivery )?address|add address|enter (?:delivery )?pin\s*code|delivery location|deliver to|location)$/i;
    const needed = texts.some(text => empty.test(text));
    const set = texts.some(text => text.length >= 3 && !empty.test(text) && !/sign in|log in|select location|add address/i.test(text) &&
      (id === 'zepto' || id === 'blinkit' || id === 'instamart' || (id === 'flipkart' && text.length >= 8 && !/^change/i.test(text)) || /\b[1-9]\d{5}\b/.test(text)));
    if (set && !needed) status = 'set'; else if (needed && !set) status = 'needed';
    // Flipkart only confirms an applied PIN beside its delivery Change control.
    if (id === 'flipkart') {
      const changed = Array.from(document.querySelectorAll('button, a, span')).some(el => /^change$/i.test((el.textContent || '').trim()) &&
        /deliver(?:y| to)/i.test(el.parentElement?.textContent || '') && /\b[1-9]\d{5}\b/.test(el.parentElement?.textContent || ''));
      if (changed) status = 'set';
      const heading = Array.from(document.querySelectorAll('div')).find(el => el.children.length === 0 && /^delivery details$/i.test((el.textContent || '').trim()));
      const address = heading?.parentElement?.parentElement?.querySelector('a:not([href])');
      const text = (address?.textContent || '').replace(/\s+/g,' ').trim();
      if(text && text.length < 250) {
        if(/^(?:enter|select|add|set).*(?:location|address|pin)/i.test(text)) status = 'needed';
        else if(text.length >= 8 && !/sign in|log in/i.test(text)) status = 'set';
      }
    }
    window.__lowpLocationStatus = status;
    if(status === previous) return; previous = status;
    window.ReactNativeWebView?.postMessage(JSON.stringify({type:'LOWP_LOCATION',platformId:id,token,url:location.href,status}));
  };
  const dispose = () => {clearInterval(timer);window.removeEventListener('pagehide',dispose);};
  window.__lowpLocationObserver = {dispose}; window.addEventListener('pagehide',dispose,{once:true});
  if(observe) timer = setInterval(tick,1000); tick();
}`;
export function locationObserverScript(id: PlatformId, token: string, observe = false): string {
  return `(${LOCATION_OBSERVER_SOURCE})(${JSON.stringify(id)},${JSON.stringify(token)},${observe}); true;`;
}
export const SESSION_CHECK_STORES: PlatformId[] = ['amazon_main', 'instamart', 'zepto', 'blinkit', 'flipkart'];
// v2 invalidates earlier Zepto observations from its ambiguous home account button.
export const SESSION_STORAGE_KEY = 'lowp_store_sessions_v2';
export const SESSION_CHECK_TIMEOUT_MS = 8000;
export const STORE_SESSION_URLS: Record<PlatformId, string> = {
  amazon_main: 'https://www.amazon.in', amazon_tez: 'https://www.amazon.in/tez/browse',
  instamart: 'https://www.swiggy.com/instamart', zepto: 'https://www.zepto.com',
  blinkit: 'https://blinkit.com', flipkart: 'https://www.flipkart.com'
};
export function restoreSessionCache(raw: string | null, now = Date.now()): Partial<Record<PlatformId, StoreSession>> {
  try {
    const parsed = JSON.parse(raw || '{}');
    const saved = parsed.sessions || parsed;
    let restored: Partial<Record<PlatformId, StoreSession>> = {};
    for (const id of SESSION_CHECK_STORES) {
      const value = saved[id];
      const valid = value && Number.isFinite(value.checkedAt) && value.checkedAt > 0 &&
        (value.status === 'signed_in' && value.evidence === 'logout_control' ||
         value.status === 'signed_out' && ['login_control', 'login_prompt', 'login_form'].includes(value.evidence) ||
         value.status === 'unknown' && value.evidence === 'none');
      if (valid && now >= value.checkedAt) restored = updateStoreSession(restored, id, value, now);
    }
    return restored;
  } catch {return {};}
}

export const SESSION_TTL_MS = 5 * 60 * 1000;
export const SYNC_REMINDER_MS = 7 * 24 * 60 * 60 * 1000;
export function restoreLastSyncedAt(raw: string | null, now = Date.now()): number {
  try { const time = JSON.parse(raw || '{}').lastSyncedAt; return Number.isFinite(time) && time > 0 && time <= now ? time : 0; } catch {return 0;}
}
export const syncNeedsReminder = (lastSyncedAt: number, now = Date.now()) => lastSyncedAt > 0 && now - lastSyncedAt > SYNC_REMINDER_MS;
export const LOCATION_STORAGE_KEY = 'lowp_store_locations_v1';
export function restoreLocationCache(raw: string | null, now = Date.now()): Partial<Record<PlatformId, StoreLocation>> {
  try {
    const saved = JSON.parse(raw || '{}');
    const restored: Partial<Record<PlatformId, StoreLocation>> = {};
    for (const id of [...SESSION_CHECK_STORES, 'amazon_tez'] as PlatformId[]) {
      const value = saved[id];
      if (value && ['set', 'needed', 'unknown'].includes(value.status) && Number.isFinite(value.checkedAt) && value.checkedAt > 0 && value.checkedAt <= now) restored[id] = value;
    }
    if (restored.amazon_main) restored.amazon_tez = restored.amazon_main;
    return restored;
  } catch {return {};}
}
export const SESSION_LABELS: Record<SessionStatus, string> = {
  unknown: 'Unknown', checking: 'Checking…', signed_in: 'Signed in', signed_out: 'Signed out'
};

export function isStoreSessionUrl(platformId: PlatformId, url: string): boolean {
  const domains: Record<PlatformId, string[]> = {
    amazon_tez: ['amazon.in'], amazon_main: ['amazon.in'], instamart: ['swiggy.com'],
    zepto: ['zepto.com', 'zeptonow.com'], blinkit: ['blinkit.com'], flipkart: ['flipkart.com']
  };
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && domains[platformId].some(
      (host) => parsed.hostname === host || parsed.hostname.endsWith('.' + host)
    );
  } catch { return false; }
}

// Literal source is required: Hermes bytecode functions cannot be serialized with toString().
export const SESSION_CLASSIFIER_SOURCE = String.raw`function classifySession(controls, prompts, phoneLoginForm = false) {
  const normalize = (value) => value.toLowerCase().replace(/\s+/g, ' ').trim();
  const labels = controls.map(normalize);
  const signedIn = labels.some((label) => /^(?:sign\s*out|log\s*out)(?: from (?:this|all) devices?)?$/.test(label));
  const loginControl = labels.some((label) => /^(?:sign\s*in|log\s*in)(?:\s*(?:\/|or)\s*sign\s*up)?$/.test(label));
  const loginPrompt = prompts.map(normalize).some((label) => [
    'sign in or create amazon account to change your address',
    'log in or sign up', 'login or signup', 'log in to get exclusive offers',
    'enter your phone number to continue'
  ].includes(label) || /^enter (?:your )?(?:mobile|phone) number$/.test(label));
  if (signedIn && (loginControl || loginPrompt || phoneLoginForm)) return { status: 'unknown', evidence: 'none' };
  if (signedIn) return { status: 'signed_in', evidence: 'logout_control' };
  if (phoneLoginForm) return { status: 'signed_out', evidence: 'login_form' };
  if (loginPrompt) return { status: 'signed_out', evidence: 'login_prompt' };
  if (loginControl) return { status: 'signed_out', evidence: 'login_control' };
  return { status: 'unknown', evidence: 'none' };
}`;

export function readSessionMessage(raw: string, platformId: PlatformId, token: string, nativeUrl: string): StoreSession | null {
  try {
    const payload = JSON.parse(raw);
    if (payload.type !== 'LOWP_SESSION' || payload.platformId !== platformId || payload.token !== token ||
      !isStoreSessionUrl(platformId, nativeUrl) || !isStoreSessionUrl(platformId, payload.url) ||
      new URL(payload.url).origin !== new URL(nativeUrl).origin) return null;
    // Android can report the initial document URL after same-document SPA navigation.
    // The origin and per-navigation token identify the trusted document; its path may change.
    const valid = payload.status === 'unknown' && payload.evidence === 'none' ||
      payload.status === 'signed_in' && payload.evidence === 'logout_control' ||
      payload.status === 'signed_out' && ['login_control', 'login_prompt', 'login_form'].includes(payload.evidence);
    return valid ? { status: payload.status, evidence: payload.evidence, checkedAt: Date.now() } : null;
  } catch { return null; }
}

export function currentSession(session?: StoreSession, now = Date.now()): StoreSession {
  if (!session || !Number.isFinite(session.checkedAt) || session.checkedAt <= 0 || session.checkedAt > now) {
    return { status: 'unknown', evidence: 'none', checkedAt: 0 };
  }
  return session;
}

export function updateStoreSession(
  previous: Partial<Record<PlatformId, StoreSession>>,
  platformId: PlatformId,
  observation: StoreSession,
  now = Date.now()
): Partial<Record<PlatformId, StoreSession>> {
  if (platformId !== 'amazon_main' && platformId !== 'amazon_tez') {
    return { ...previous, [platformId]: observation };
  }
  // Amazon.in and Amazon Now share the store account. An inconclusive Now
  // page must not erase recent explicit account evidence from Amazon.in.
  const verified = [previous.amazon_main, previous.amazon_tez]
    .some((session) => ['signed_in', 'signed_out'].includes(currentSession(session, now).status));
  if (platformId === 'amazon_tez' && verified && ['unknown', 'checking'].includes(observation.status)) return previous;
  return { ...previous, amazon_main: observation, amazon_tez: observation };
}

const SESSION_OBSERVER_SOURCE = String.raw`function installSessionObserver(platformId, token, classify, observe = true) {
  const scope = window;
  if (window.top !== window) return;
  if (observe && scope.__lowpSessionObserver?.token === token) return;
  scope.__lowpSessionObserver?.dispose();
  let timer;
  let previous = '';
  const visible = (element) => {
    if (element.closest('[hidden], [inert]')) return false;
    // Blinkit marks its visibly rendered login sheet aria-hidden. ARIA alone
    // does not establish visual visibility; inspect styles, ancestors and bounds.
    for (let node = element; node; node = node.parentElement) {
      const style = window.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    }
    return Array.from(element.getClientRects()).some((rect) => rect.width > 0 && rect.height > 0 &&
      rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth);
  };
  const inspect = () => {
    const controls = [];
    const prompts = [];
    const termsNotices = [];
    document.querySelectorAll('a, button, [role="button"], input[type="submit"]').forEach((element) => {
      const label = element.getAttribute('aria-label') || element.value || element.textContent || '';
      if (label.length >= 100 || !/(?:log|sign)\s*(?:in|out)/i.test(label)) return;
      // Zepto labels its home account button "login" even for a valid session.
      // Open it during a probe; only the resulting form/prompt or logout action
      // can establish authentication. Ignore this same cue on product pages.
      if (platformId === 'zepto' && /^login$/i.test((element.getAttribute('aria-label') || '').trim()) &&
          !element.closest('form, [role="dialog"]')) return;
      if (visible(element) && !element.matches(':disabled, [aria-disabled="true"]')) controls.push(label);
    });
    // Short exact prompts may contain nested spans/icons. Never use document-wide text or image alt text.
    document.querySelectorAll('h1, h2, h3, h4, h5, h6, p, span, div, label').forEach((element) => {
      const text = (element.textContent || '').trim();
      if (!text || text.length >= 350) return;
      const normalized = text.toLowerCase().replace(/\s+/g, ' ');
      if (/^by continuing\s*,?\s+(?:you\s+)?agree to (?:our\s+|the\s+)?terms\b/.test(normalized)) {
        if(visible(element)) termsNotices.push(element);
        return;
      }
      if(text.length >= 100) return;
      const logout = /^(?:log\s*out|sign\s*out)(?: from (?:this|all) devices?)?$/i.test(text);
      // Only exact classifier cues need costly layout/style inspection. Large
      // commerce pages contain many unrelated references to phones and sign-in.
      if (!logout && !/^enter (?:your )?(?:mobile|phone) number$/.test(normalized) && ![
        'sign in or create amazon account to change your address', 'log in or sign up',
        'login or signup', 'log in to get exclusive offers', 'enter your phone number to continue'
      ].includes(normalized)) return;
      if (!visible(element)) return;
      prompts.push(text);
      // Some account pages use plain divs for the logout action.
      if (logout &&
          (/\/(?:account|my-account|profile|your-account)(?:\/|$)/i.test(window.location.pathname) ||
           element.closest('nav, header, [role="dialog"], [role="menu"]'))) controls.push(text);
    });
    const phoneLoginForm = Array.from(document.querySelectorAll('input')).some((input) => {
      const placeholder = (input.getAttribute('placeholder') || input.getAttribute('aria-label') || '').trim();
      if (!/^(?:enter (?:your )?)?(?:10[ -]digit )?(?:mobile|phone) (?:number|no\.?)$/i.test(placeholder) || !visible(input) || input.disabled || input.readOnly) return false;
      // A phone field can also appear in account editing. Require nearby login
      // context even when its heading has scrolled beyond the viewport.
      for (let parent = input.parentElement, depth = 0; parent && depth < 6; parent = parent.parentElement, depth++) {
        const text = parent.textContent || '';
        if (text.length > 2000) break;
        if (/\b(?:log\s*in|sign\s*in|sign\s*up)\b/i.test(text)) return true;
        // Phone-login screens can omit a Login heading and show only Continue
        // and a terms notice. Apply this cue to every store, within that field's
        // small form/container, rather than unrelated page footers or checkout.
        if (termsNotices.some(notice => parent.contains?.(notice)) &&
            !/\b(?:edit profile|change phone|delivery address|checkout|place order)\b/i.test(text)) return true;
      }
      return false;
    });
    const result = classify(controls, prompts, phoneLoginForm);
    scope.__lowpSessionStatus = result.status;
    const signature = result.status + ':' + result.evidence;
    if (signature === previous) return;
    previous = signature;
    scope.ReactNativeWebView?.postMessage(JSON.stringify({
      type: 'LOWP_SESSION', platformId, token, url: window.location.href, ...result,
      conflicting: result.status === 'unknown' && controls.some(label => /^(?:sign\s*out|log\s*out)(?: from (?:this|all) devices?)?$/i.test(label.trim()))
    }));
  };
  const schedule = () => {
    if (timer) return;
    timer = setTimeout(() => { timer = undefined; inspect(); }, 500);
  };
  const observer = new MutationObserver(schedule);
  if (observe) observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true,
    attributes: true, attributeFilter: ['hidden', 'aria-hidden', 'aria-label', 'class', 'style'] });
  const dispose = () => {
    observer.disconnect();
    if (timer) clearTimeout(timer);
    window.removeEventListener('pagehide', dispose);
    document.removeEventListener('click', schedule);
    document.removeEventListener('transitionend', schedule);
    document.removeEventListener('animationend', schedule);
    document.removeEventListener('scroll', schedule, true);
    window.removeEventListener('resize', schedule);
  };
  scope.__lowpSessionObserver = { token, dispose };
  window.addEventListener('pagehide', dispose, { once: true });
  if (observe) {
    document.addEventListener('click', schedule);
    document.addEventListener('transitionend', schedule);
    document.addEventListener('animationend', schedule);
    document.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
  }
  inspect();
}`;

export function sessionObserverScript(platformId: PlatformId, token: string, observe = true): string {
  return `(${SESSION_OBSERVER_SOURCE})(${JSON.stringify(platformId)}, ${JSON.stringify(token)}, (${SESSION_CLASSIFIER_SOURCE}), ${observe}); true;`;
}

const SESSION_PROBE_SOURCE = String.raw`function probeAccount(platformId, token) {
  if (window.top !== window || window.__lowpSessionProbe?.token === token) return;
  window.__lowpSessionProbe?.dispose();
  let steps = 0, opened = 0, openedAt = 0, openedUrl = '', openedLogoutOptions = 0, optionsAt = 0;
  const visible = el => {
    if (!Array.from(el.getClientRects()).some(r => r.width > 0 && r.height > 0)) return false;
    for (let node = el; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    }
    return true;
  };
  const tick = () => {
    if (window.__lowpSessionStatus !== 'unknown') return;
    steps++;
    const controls = Array.from(document.querySelectorAll('a, button, [role="button"], header span, nav span'));
    // Reveal explicit evidence by scrolling, never activating logout or forms.
    const cue = controls.find(el => /^(?:log\s*out|sign\s*out)(?: from (?:this|all) devices?)?$/i.test((el.textContent || '').trim()) && visible(el));
    if (cue) {cue.scrollIntoView({block:'center'}); return;}
    const phone = Array.from(document.querySelectorAll('input')).find(el => /^enter (?:your )?(?:mobile|phone) number$/i.test(el.getAttribute('placeholder') || '') && visible(el));
    if (phone) {phone.scrollIntoView({block:'center'}); return;}
    // Zepto's home header starts as "login" before hydration, then becomes a
    // /account profile link. Inspect that verified read-only route directly;
    // clicking the initial login button can invoke its external login SDK.
    if (platformId === 'zepto' && location.pathname === '/') {
      // Give the delivery header time to hydrate before leaving it for account.
      if(steps < 3 && window.__lowpLocationStatus !== 'set' && window.__lowpLocationStatus !== 'needed') return;
      if (!opened) {opened++; location.assign(new URL('/account', location.href).href);}
      return;
    }
    // Swiggy exposes a read-only submenu before its actual logout actions.
    // Never activate the actions inside this menu.
    const logoutOptions = platformId === 'instamart' && /\/my-account(?:\/|$)/.test(location.pathname) &&
      controls.find(el => (el.textContent || '').trim() === 'Logout Options' && visible(el));
    if (logoutOptions && openedLogoutOptions < 3 && steps - optionsAt >= 2) {openedLogoutOptions++; optionsAt = steps; logoutOptions.scrollIntoView({block:'center'}); logoutOptions.click(); return;}
    const hoverOnly = platformId === 'amazon_main' || platformId === 'flipkart';
    // A home page may render its account button before hydration attaches the
    // handler. Retry that same safe control only while its document is unchanged.
    if (opened && !hoverOnly && (opened >= 3 || location.href !== openedUrl || steps - openedAt < 2)) return;
    const account = platformId === 'amazon_main' ? document.querySelector('#nav-link-accountList a') || document.querySelector('#nav-link-accountList') :
      platformId === 'blinkit' ? document.querySelector('header [class*="ProfileButton__Container"]') : controls.find(el => {
      const label = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim();
      return /^(?:my account|your account|account|profile|user profile|double tap to go to user account|login|log in|sign in)$/i.test(label) && visible(el);
    });
    if (!account || !visible(account)) return;
    const href = account.getAttribute('href');
    if (href) {
      try {const url = new URL(href, location.href); if (url.origin !== location.origin || /logout|signout|sign-out/i.test(url.href)) return;} catch {return;}
    }
    opened++; openedAt = steps; openedUrl = location.href;
    account.scrollIntoView({block:'nearest', inline:'nearest'});
    account.dispatchEvent(new MouseEvent('mouseover', {bubbles:true}));
    account.dispatchEvent(new MouseEvent('mouseenter', {bubbles:true}));
    if (!hoverOnly) account.click();
  };
  const timer = setInterval(tick, 800);
  const dispose = () => {clearInterval(timer); window.removeEventListener('pagehide', dispose);};
  window.__lowpSessionProbe = {token, dispose};
  window.addEventListener('pagehide', dispose, {once:true});
}`;
export function sessionProbeScript(platformId: PlatformId, token: string): string {
  return locationObserverScript(platformId, token, true) + sessionObserverScript(platformId, token) + `(${SESSION_PROBE_SOURCE})(${JSON.stringify(platformId)}, ${JSON.stringify(token)}); true;`;
}
