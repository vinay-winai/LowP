const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('../mobile/node_modules/typescript');

const source = fs.readFileSync(require.resolve('../mobile/src/core/StoreSession.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText;
const context = { exports: {}, URL, Date };
vm.runInNewContext(compiled, context);
const session = context.exports;
const classify = vm.runInNewContext(`(${session.SESSION_CLASSIFIER_SOURCE})`);

test('observed account cues distinguish signed-out stores from signed-in stores', () => {
  for (const prompt of [
    'Enter your phone number to continue', 'Log in or Sign up',
    'Sign in or create Amazon account to change your address', 'Log in to get exclusive offers'
  ]) assert.equal(classify([], [prompt]).status, 'signed_out', prompt);
  for (const label of ['Log Out', 'Sign Out', 'LOGOUT']) {
    assert.equal(classify([label], []).status, 'signed_in', label);
  }
  assert.equal(classify(['Sign in / Sign up'], []).status, 'signed_out');
  assert.equal(classify([], [], true).evidence, 'login_form');
  assert.equal(classify(['Log Out'], [], true).status, 'unknown');
});

test('location, profile icons, orders and product text do not prove authentication', () => {
  assert.equal(classify(['Profile', 'Orders', 'Your account', 'Done'], ['Delivery in 8 minutes']).status, 'unknown');
  assert.equal(classify([], ['Sign in to discover cashbacks', 'Login notebook', 'Logout']).status, 'unknown');
  assert.equal(classify([], ['Enter mobile number']).status, 'unknown');
  assert.equal(classify(['Sign Out', 'Sign In'], []).status, 'unknown');
});

test('session bridge rejects wrong domains, stale navigation tokens and malformed evidence', () => {
  const url = 'https://www.zepto.com/account';
  const payload = { type: 'LOWP_SESSION', platformId: 'zepto', token: 'current', url,
    status: 'signed_in', evidence: 'logout_control' };
  const read = (changes = {}, nativeUrl = url) => session.readSessionMessage(
    JSON.stringify({ ...payload, ...changes }), 'zepto', 'current', nativeUrl);
  assert.equal(read().status, 'signed_in');
  assert.equal(read({ token: 'previous' }), null);
  assert.equal(read({ platformId: 'blinkit' }), null);
  assert.equal(read({ evidence: 'cookie_present' }), null);
  assert.equal(read({ status: 'signed_out', evidence: 'login_form' }).status, 'signed_out');
  assert.equal(read({}, 'https://www.zepto.com/search').status, 'signed_in');
  assert.equal(read({}, 'https://zepto.com/search'), null);
  assert.equal(read({ url: 'https://zepto.com.attacker.test' }, 'https://zepto.com.attacker.test'), null);
  assert.equal(session.readSessionMessage('not json', 'zepto', 'current', url), null);
  assert.equal(session.isStoreSessionUrl('amazon_tez', 'https://www.amazon.in/tez/browse'), true);
  assert.equal(session.isStoreSessionUrl('zepto', 'https://www.zeptonow.com/'), true);
  assert.equal(session.isStoreSessionUrl('zepto', 'http://www.zepto.com/'), false);
});

test('old and future-dated observations become unknown', () => {
  const known = { status: 'signed_in', evidence: 'logout_control', checkedAt: 1000 };
  assert.equal(session.currentSession(known, 1100).status, 'signed_in');
  assert.equal(session.currentSession(known, 1000 + session.SESSION_TTL_MS).status, 'unknown');
  assert.equal(session.currentSession(known, 999).status, 'unknown');
  assert.equal(session.currentSession().status, 'unknown');
});

test('Amazon.in and Amazon Now share verified status and expiration', () => {
  const signedIn = { status: 'signed_in', evidence: 'logout_control', checkedAt: 1000 };
  const verified = session.updateStoreSession({}, 'amazon_main', signedIn, 1000);
  assert.equal(verified.amazon_tez.status, 'signed_in');
  assert.equal(verified.amazon_tez.checkedAt, verified.amazon_main.checkedAt);
  const unknown = { status: 'unknown', evidence: 'none', checkedAt: 1100 };
  assert.equal(session.updateStoreSession(verified, 'amazon_tez', unknown, 1100), verified);
  const signedOut = { status: 'signed_out', evidence: 'login_prompt', checkedAt: 1200 };
  const loggedOut = session.updateStoreSession(verified, 'amazon_tez', signedOut, 1200);
  assert.equal(loggedOut.amazon_main.status, 'signed_out');
  assert.equal(session.currentSession(loggedOut.amazon_tez, 1200 + session.SESSION_TTL_MS).status, 'unknown');
  assert.equal(session.currentSession(loggedOut.amazon_main, 1200 + session.SESSION_TTL_MS).status, 'unknown');
  assert.equal(session.updateStoreSession(verified, 'amazon_tez', unknown, 1000 + session.SESSION_TTL_MS).amazon_main.status, 'unknown');
  const swiggy = session.updateStoreSession(verified, 'instamart', signedOut, 1200);
  assert.equal(swiggy.amazon_main.status, 'signed_in');
});

test('injected observer ignores hidden cues, detects changes and disposes duplicate observers', () => {
  const sent = [];
  const observers = [];
  const timers = new Map();
  let timerId = 0;
  const element = (text, hidden = false) => ({
    textContent: text, children: [],
    getAttribute: () => null, matches: () => false,
    closest: (selector) => hidden && selector.includes('[hidden]') ? {} : null,
    getClientRects: () => [{ width: 100, height: 30, top: 0, left: 0, right: 100, bottom: 30 }]
  });
  let controls = [element('Log out', true)];
  let prompts = [element('Log in or Sign up')];
  let inputs = [];
  const document = {
    documentElement: {}, querySelectorAll: (selector) => selector === 'input' ? inputs : selector.startsWith('a,') ? controls : prompts,
    addEventListener() {}, removeEventListener() {}
  };
  const window = {
    innerWidth: 480, innerHeight: 640,
    location: { href: 'https://www.zepto.com/account', pathname: '/account' },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    ReactNativeWebView: { postMessage: (raw) => sent.push(JSON.parse(raw)) },
    addEventListener() {}, removeEventListener() {}
  };
  window.top = window;
  const sandbox = vm.createContext({ window, document,
    setTimeout: (fn) => { timers.set(++timerId, fn); return timerId; },
    clearTimeout: (id) => timers.delete(id),
    MutationObserver: class {
      constructor(callback) { this.callback = callback; observers.push(this); }
      observe() {} disconnect() { this.disconnected = true; }
    }
  });
  const script = session.sessionObserverScript('zepto', 'one');
  vm.runInContext(script, sandbox);
  assert.equal(sent.at(-1).status, 'signed_out');
  vm.runInContext(script, sandbox);
  assert.equal(observers.length, 1);
  controls = [element('Log Out')]; prompts = [];
  observers[0].callback(); observers[0].callback();
  assert.equal(timers.size, 1);
  for (const fn of timers.values()) fn();
  timers.clear();
  assert.equal(sent.at(-1).status, 'signed_in');
  vm.runInContext(session.sessionObserverScript('zepto', 'two'), sandbox);
  assert.equal(observers[0].disconnected, true);
  assert.equal(sent.at(-1).token, 'two');

  controls = []; prompts = [];
  const phone = element('');
  phone.getAttribute = (name) => name === 'placeholder' ? 'Enter mobile number' : null;
  phone.parentElement = element('Log in or Sign up Continue');
  inputs = [phone];
  vm.runInContext(session.sessionObserverScript('blinkit', 'three'), sandbox);
  assert.equal(sent.at(-1).evidence, 'login_form');
  phone.parentElement = element('Edit profile Continue');
  vm.runInContext(session.sessionObserverScript('blinkit', 'four'), sandbox);
  assert.equal(sent.at(-1).status, 'unknown');

  inputs = [];
  const nestedPrompt = element('Log in or Sign up');
  nestedPrompt.children = [{}];
  // ARIA-hidden alone does not hide Blinkit's visually rendered login sheet.
  nestedPrompt.closest = (selector) => selector.includes('aria-hidden') ? {} : null;
  prompts = [nestedPrompt];
  vm.runInContext(session.sessionObserverScript('blinkit', 'five'), sandbox);
  assert.equal(sent.at(-1).status, 'signed_out');
  nestedPrompt.getClientRects = () => [{ width: 100, height: 30, top: 700, left: 0, right: 100, bottom: 730 }];
  vm.runInContext(session.sessionObserverScript('blinkit', 'six'), sandbox);
  assert.equal(sent.at(-1).status, 'unknown');
  nestedPrompt.getClientRects = () => [{ width: 100, height: 30, top: 0, left: 0, right: 100, bottom: 30 }];
  nestedPrompt.parentElement = { hiddenStyle: true };
  window.getComputedStyle = (node) => ({ display: 'block', visibility: 'visible', opacity: node.hiddenStyle ? '0' : '1' });
  vm.runInContext(session.sessionObserverScript('blinkit', 'seven'), sandbox);
  assert.equal(sent.at(-1).status, 'unknown');
});
