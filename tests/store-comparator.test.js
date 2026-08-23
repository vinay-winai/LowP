const { test } = require('node:test');
const assert = require('node:assert');

// Mock chrome API for Node environment
global.chrome = {
  storage: {
    sync: {
      _data: {},
      get(keys, cb) { cb(this._data); },
      set(obj, cb) { Object.assign(this._data, obj); if (cb) cb(); }
    },
    local: {
      _data: {},
      get(keys, cb) { cb(this._data); },
      set(obj, cb) { Object.assign(this._data, obj); if (cb) cb(); },
      clear(cb) { this._data = {}; if (cb) cb(); }
    }
  },
  runtime: {
    onMessage: { addListener: () => {} },
    sendMessage: () => {}
  }
};

const {
  DEFAULT_LOCATION,
  LocationService,
  MatchingEngine,
  AmazonTezProvider,
  InstamartProvider,
  ZeptoProvider,
  BlinkitProvider,
  handleSearchQuery,
  streamSearchResults,
  SearchCache,
  WarmTabPool,
  firstPositive
} = require('../src/background/service-worker.js');

test('MatchingEngine - calculateTotalCost computes pure base price and savings', () => {
  const item = { price: 127, mrp: 165 };
  const cost = MatchingEngine.calculateTotalCost(item);

  assert.strictEqual(cost.basePrice, 127);
  assert.strictEqual(cost.finalPayable, 127);
  assert.strictEqual(cost.savings, 38);
  assert.strictEqual(cost.discountPercent, 23);
});

test('MatchingEngine - cleanSearchTerm cleans URLs and punctuation', () => {
  assert.strictEqual(MatchingEngine.cleanSearchTerm('https://www.amazon.in/dp/B0DQPYH6Y9'), '');
  assert.strictEqual(
    MatchingEngine.cleanSearchTerm('MILKYMIST high protein paneer, 200gm - Fresh!'),
    'MILKYMIST high protein paneer 200gm Fresh!'
  );
});

test('MatchingEngine - scoreRelevance ranks exact brand and pack size highest', () => {
  const query = "freedom oil 1l";
  const candWrongSize = MatchingEngine.scoreRelevance("Gold Winner Refined Sunflower Oil - Jar", query, "5 L");
  const candExactMatch = MatchingEngine.scoreRelevance("Freedom Refined Sunflower Oil", query, "1 L");
  const candOtherBrand = MatchingEngine.scoreRelevance("Gemini Pure Sunflower Oil Pouch", query, "1 L");

  assert.ok(candExactMatch > candOtherBrand);
  assert.ok(candExactMatch > candWrongSize);
  assert.ok(candExactMatch >= 100);
});

test('MatchingEngine - penalizes a same-number quantity with a different unit', () => {
  const exact = MatchingEngine.scoreRelevance('Freedom Refined Sunflower Oil', 'freedom oil 200g', '200 g');
  const wrongUnit = MatchingEngine.scoreRelevance('Freedom Refined Sunflower Oil', 'freedom oil 200g', '200 ml');

  assert.ok(exact > wrongUnit);
});

test('MatchingEngine - annotateBestOffers assigns lowest price badge', () => {
  const results = [
    {
      platformId: 'amazon_tez',
      isAvailable: true,
      priceBreakdown: { finalPayable: 127 }
    },
    {
      platformId: 'instamart',
      isAvailable: true,
      priceBreakdown: { finalPayable: 135 }
    },
    {
      platformId: 'zepto',
      isAvailable: true,
      priceBreakdown: { finalPayable: 128 }
    },
    {
      platformId: 'blinkit',
      isAvailable: true,
      priceBreakdown: { finalPayable: 130 }
    }
  ];

  const annotated = MatchingEngine.annotateBestOffers(results);

  const amzTez = annotated.find(r => r.platformId === 'amazon_tez');
  const im = annotated.find(r => r.platformId === 'instamart');
  const zepto = annotated.find(r => r.platformId === 'zepto');
  const blinkit = annotated.find(r => r.platformId === 'blinkit');

  assert.strictEqual(amzTez.isLowestPrice, true); // 127 is lowest
  assert.strictEqual(im.isLowestPrice, false);
  assert.strictEqual(zepto.isLowestPrice, false);
  assert.strictEqual(blinkit.isLowestPrice, false);
});

test('LocationService - initializes with default Hyderabad 500085 location', async () => {
  const loc = await LocationService.getActiveLocation();
  assert.strictEqual(loc.pincode, '500085');
  assert.strictEqual(loc.lat, 17.501725514188223);
  assert.strictEqual(loc.lng, 78.39361254731166);
});

test('Providers - formatResult returns structured schema across Amazon Tez, Instamart, Zepto, and Blinkit', () => {
  const amzTez = new AmazonTezProvider();
  const im = new InstamartProvider();
  const zepto = new ZeptoProvider();
  const blinkit = new BlinkitProvider();

  const mockItem = {
    title: 'Milky Mist High Protein Paneer 200g',
    price: 127,
    mrp: 165,
    quantity: '200 g'
  };

  const resAmzTez = amzTez.formatResult(mockItem, DEFAULT_LOCATION);
  assert.strictEqual(resAmzTez.platformId, 'amazon_tez');
  assert.strictEqual(resAmzTez.isAvailable, true);
  assert.strictEqual(resAmzTez.priceBreakdown.finalPayable, 127);

  const resIm = im.formatResult(null, DEFAULT_LOCATION);
  assert.strictEqual(resIm.platformId, 'instamart');
  assert.strictEqual(resIm.isAvailable, false);

  const resZepto = zepto.formatResult(mockItem, DEFAULT_LOCATION);
  assert.strictEqual(resZepto.platformId, 'zepto');
  assert.strictEqual(resZepto.isAvailable, true);

  const resBlinkit = blinkit.formatResult(mockItem, DEFAULT_LOCATION);
  assert.strictEqual(resBlinkit.platformId, 'blinkit');
  assert.strictEqual(resBlinkit.isAvailable, true);
});

test('Providers - zero-price fallback is not reported as an available item', () => {
  const provider = new InstamartProvider();
  const result = provider.formatResult({
    title: 'paneer',
    price: 0,
    mrp: 0,
    productUrl: provider.getSearchUrl('paneer')
  }, DEFAULT_LOCATION, 'paneer');

  assert.strictEqual(result.isAvailable, false);
  assert.strictEqual(result.item, null);
  assert.strictEqual(result.priceBreakdown, null);
  assert.match(result.productUrl, /query=paneer/);
});

test('Providers - preserves up to three ranked candidates and selected index', () => {
  const provider = new ZeptoProvider();
  const result = provider.formatResult({
    title: 'exact paneer 200g',
    price: 120,
    mrp: 150,
    candidates: [
      { title: 'exact paneer 200g', price: 120, mrp: 150 },
      { title: 'paneer 180g', price: 115, mrp: 140 },
      { title: 'paneer 500g', price: 240, mrp: 280 },
      { title: 'extra candidate', price: 99, mrp: 100 }
    ],
    selectedIndex: 1
  }, DEFAULT_LOCATION, 'paneer');

  assert.strictEqual(result.candidates.length, 3);
  assert.strictEqual(result.selectedIndex, 1);
  assert.strictEqual(result.candidates[1].price, 115);
});

test('handleSearchQuery - executes parallel search and returns 4 quick commerce store results', async () => {
  const results = await handleSearchQuery('paneer');
  assert.strictEqual(results.length, 4);
  assert.ok(results.some(r => r.platformId === 'amazon_tez'));
  assert.ok(results.some(r => r.platformId === 'instamart'));
  assert.ok(results.some(r => r.platformId === 'zepto'));
  assert.ok(results.some(r => r.platformId === 'blinkit'));
});

test('firstPositive - resolves with the first truthy result', async () => {
  const slow = new Promise((resolve) => setTimeout(() => resolve(null), 50));
  const fast = Promise.resolve({ id: 'fast' });
  const winner = await firstPositive([slow, fast]);
  assert.strictEqual(winner.id, 'fast');
});

test('firstPositive - resolves null when every attempt fails or yields nothing', async () => {
  const winner = await firstPositive([
    Promise.reject(new Error('boom')),
    new Promise((resolve) => setTimeout(() => resolve(null), 10))
  ]);
  assert.strictEqual(winner, null);
});

test('SearchCache - round-trips entries and expires them after the TTL', async () => {
  SearchCache.resetForTests();
  const t0 = 1000000;
  await SearchCache.set('500085', 'cache ttl probe', [{ platformId: 'zepto' }], t0);

  const fresh = await SearchCache.get('500085', 'Cache TTL Probe', t0 + 1000);
  assert.ok(fresh && Array.isArray(fresh.results));

  const expired = await SearchCache.get('500085', 'cache ttl probe', t0 + SearchCache.TTL_MS + 1);
  assert.strictEqual(expired, null);
});

test('SearchCache - evicts oldest entries beyond the cap', async () => {
  SearchCache.resetForTests();
  const base = 2000000;
  for (let i = 0; i < 35; i++) {
    await SearchCache.set('500085', `item ${i}`, [{ index: i }], base + i * 10);
  }
  const map = await SearchCache.hydrate();
  assert.ok(map.size <= SearchCache.MAX_ENTRIES);

  const evicted = await SearchCache.get('500085', 'item 0', base);
  assert.strictEqual(evicted, null);

  const kept = await SearchCache.get('500085', 'item 34', base + 340);
  assert.ok(kept);
});

test('WarmTabPool - maps store URLs to platform ids', () => {
  assert.strictEqual(WarmTabPool.detectPlatformId('https://www.amazon.in/tez/browse/search?searchKeyword=milk'), 'amazon_tez');
  assert.strictEqual(WarmTabPool.detectPlatformId('https://www.swiggy.com/instamart/search?query=milk'), 'instamart');
  assert.strictEqual(WarmTabPool.detectPlatformId('https://www.zeptonow.com/search?query=milk'), 'zepto');
  assert.strictEqual(WarmTabPool.detectPlatformId('https://blinkit.com/s/?q=milk'), 'blinkit');
  assert.strictEqual(WarmTabPool.detectPlatformId('https://example.com/'), null);
});

test('streamSearchResults - emits each provider result as it settles then resolves the annotated set', async () => {
  SearchCache.resetForTests();
  const emitted = [];
  const results = await streamSearchResults('emission probe', null, (store) => emitted.push(store.platformId));

  assert.strictEqual(emitted.length, 4);
  assert.strictEqual(results.length, 4);
  assert.deepStrictEqual(
    results.map((r) => r.platformId).sort(),
    ['amazon_tez', 'blinkit', 'instamart', 'zepto']
  );
});

test('handleSearchQuery - serves repeat queries from the short-TTL cache without re-running providers', async () => {
  SearchCache.resetForTests();
  const seedTs = Date.now();
  const seededResults = [
    { platformId: 'amazon_tez', isAvailable: true, priceBreakdown: { finalPayable: 99 }, isLowestPrice: true },
    { platformId: 'instamart', isAvailable: false, priceBreakdown: null, isLowestPrice: false }
  ];
  await SearchCache.set(DEFAULT_LOCATION.pincode, 'cache hit probe', seededResults, seedTs);

  const results = await handleSearchQuery('cache hit probe');

  assert.strictEqual(results.length, 2);
  assert.ok(results.every((r) => typeof r.cachedAt === 'number' && r.cachedAt >= seedTs));
  assert.deepStrictEqual(
    results.map((r) => r.platformId),
    ['amazon_tez', 'instamart']
  );
});

test('SearchCache - treats variations of a search term as distinct entries', async () => {
  SearchCache.resetForTests();
  const seedTs = Date.now();
  await SearchCache.set(DEFAULT_LOCATION.pincode, 'milk', [
    { platformId: 'amazon_tez', isAvailable: true, priceBreakdown: { finalPayable: 30 }, title: 'plain milk' }
  ], seedTs);

  // "milk 1l" must NOT be served from the "milk" entry...
  const miss = await SearchCache.get(DEFAULT_LOCATION.pincode, 'milk 1l', seedTs + 1000);
  assert.strictEqual(miss, null);

  // ...and only an exact term match (case/whitespace aside) hits.
  const hit = await SearchCache.get(DEFAULT_LOCATION.pincode, '  MILK ', seedTs + 1000);
  assert.ok(hit);
});

test('MatchingEngine - relevance ranking rejects promo-banner fragments for the searched term', () => {
  // Mirrors the candidate set observed on Amazon Tez where proximity
  // extraction grabs sponsored banners before the product grid hydrates.
  const candidates = [
    { title: '54% OFFFresh Milk Pouch', price: 30 },
    { title: 'Sunfeast YiPPee! Magic Masala Noodles', price: 131 },
    { title: 'MAGGI 2-Minute Instant Masala Noodles', price: 60 }
  ];
  const query = 'maggi';
  const ranked = candidates
    .map((c) => Object.assign({}, c, { _score: MatchingEngine.scoreRelevance(c.title, query) }))
    .sort((a, b) => b._score - a._score);

  assert.strictEqual(ranked[0].title, 'MAGGI 2-Minute Instant Masala Noodles');
  assert.ok(ranked[0]._score >= 20);
});

test('MatchingEngine - cleanTitle-style rules strip glued discount and sponsored prefixes', () => {
  const raw = 'Sponsored54% OFFFresh Milk Pouch';
  const cleaned = raw
    .replace(/^sponsored\s*/i, "")
    .replace(/^\s*\d+(?:\.\d+)?\s*%\s*off\s*/i, "");
  assert.strictEqual(cleaned, 'Fresh Milk Pouch');
});
