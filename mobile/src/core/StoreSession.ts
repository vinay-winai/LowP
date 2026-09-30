import { PlatformId } from '../types';

export type SessionStatus = 'unknown' | 'checking' | 'signed_in' | 'signed_out';
export type SessionEvidence = 'logout_control' | 'login_control' | 'login_prompt' | 'login_form' | 'none';
export interface StoreSession {
  status: SessionStatus;
  evidence: SessionEvidence;
  checkedAt: number;
}

export const SESSION_TTL_MS = 5 * 60 * 1000;
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
  const signedIn = labels.some((label) => /^(?:sign\s*out|log\s*out)$/.test(label));
  const loginControl = labels.some((label) => /^(?:sign\s*in|log\s*in)(?:\s*(?:\/|or)\s*sign\s*up)?$/.test(label));
  const loginPrompt = prompts.map(normalize).some((label) => [
    'sign in or create amazon account to change your address',
    'log in or sign up', 'login or signup', 'log in to get exclusive offers',
    'enter your phone number to continue'
  ].includes(label));
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
  if (!session || now - session.checkedAt >= SESSION_TTL_MS || session.checkedAt > now) {
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
  if (verified && ['unknown', 'checking'].includes(observation.status)) return previous;
  return { ...previous, amazon_main: observation, amazon_tez: observation };
}

const SESSION_OBSERVER_SOURCE = String.raw`function installSessionObserver(platformId, token, classify) {
  const scope = window;
  if (window.top !== window) return;
  if (scope.__lowpSessionObserver?.token === token) return;
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
    document.querySelectorAll('a, button, [role="button"], input[type="submit"]').forEach((element) => {
      const label = element.getAttribute('aria-label') || element.value || element.textContent || '';
      if (label.length >= 100 || !/(?:log|sign)\s*(?:in|out)/i.test(label)) return;
      if (visible(element) && !element.matches(':disabled, [aria-disabled="true"]')) controls.push(label);
    });
    // Short exact prompts may contain nested spans/icons. Never use document-wide text or image alt text.
    document.querySelectorAll('h1, h2, h3, h4, h5, h6, p, span, div, label').forEach((element) => {
      const text = (element.textContent || '').trim();
      if (!text || text.length >= 100 || !/(?:log|sign|phone)/i.test(text) || !visible(element)) return;
      prompts.push(text);
      // Some account pages use plain divs for the logout action.
      if (/^(?:log\s*out|sign\s*out)$/i.test(text) &&
          (/\/(?:account|profile|your-account)(?:\/|$)/i.test(window.location.pathname) ||
           element.closest('nav, header, [role="dialog"], [role="menu"]'))) controls.push(text);
    });
    const phoneLoginForm = Array.from(document.querySelectorAll('input')).some((input) => {
      const placeholder = (input.getAttribute('placeholder') || '').trim();
      if (!/^enter (?:your )?(?:mobile|phone) number$/i.test(placeholder) || !visible(input)) return false;
      // A phone field can also appear in account editing. Require nearby login
      // context even when its heading has scrolled beyond the viewport.
      for (let parent = input.parentElement, depth = 0; parent && depth < 6; parent = parent.parentElement, depth++) {
        const text = parent.textContent || '';
        if (text.length > 2000) break;
        if (/\b(?:log\s*in|sign\s*in|sign\s*up)\b/i.test(text)) return true;
      }
      return false;
    });
    const result = classify(controls, prompts, phoneLoginForm);
    const signature = result.status + ':' + result.evidence;
    if (signature === previous) return;
    previous = signature;
    scope.ReactNativeWebView?.postMessage(JSON.stringify({
      type: 'LOWP_SESSION', platformId, token, url: window.location.href, ...result
    }));
  };
  const schedule = () => {
    if (timer) return;
    timer = setTimeout(() => { timer = undefined; inspect(); }, 500);
  };
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true,
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
  document.addEventListener('click', schedule);
  document.addEventListener('transitionend', schedule);
  document.addEventListener('animationend', schedule);
  document.addEventListener('scroll', schedule, true);
  window.addEventListener('resize', schedule);
  inspect();
}`;

export function sessionObserverScript(platformId: PlatformId, token: string): string {
  return `(${SESSION_OBSERVER_SOURCE})(${JSON.stringify(platformId)}, ${JSON.stringify(token)}, (${SESSION_CLASSIFIER_SOURCE})); true;`;
}
