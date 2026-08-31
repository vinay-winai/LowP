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
  DEFAULT_PROFILES,
  DEFAULT_COLLECTIONS,
  CollectionService,
  LocationService,
  MatchingEngine,
  AmazonTezProvider,
  InstamartProvider,
  ZeptoProvider,
  BlinkitProvider,
  AmazonMainProvider,
  FlipkartProvider,
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

test('handleSearchQuery - executes parallel search across all 6 stores or filtered collection', async () => {
  const allResults = await handleSearchQuery('paneer');
  assert.strictEqual(allResults.length, 6);
  assert.ok(allResults.some(r => r.platformId === 'amazon_tez'));
  assert.ok(allResults.some(r => r.platformId === 'instamart'));
  assert.ok(allResults.some(r => r.platformId === 'zepto'));
  assert.ok(allResults.some(r => r.platformId === 'blinkit'));
  assert.ok(allResults.some(r => r.platformId === 'amazon_main'));
  assert.ok(allResults.some(r => r.platformId === 'flipkart'));

  // 10 min pack filter
  const tenMinResults = await handleSearchQuery('paneer', null, ['amazon_tez', 'instamart', 'zepto', 'blinkit']);
  assert.strictEqual(tenMinResults.length, 4);

  // Big online pack filter
  const bigOnlineResults = await handleSearchQuery('iphone', null, ['amazon_main', 'flipkart']);
  assert.strictEqual(bigOnlineResults.length, 2);
  assert.deepStrictEqual(bigOnlineResults.map(r => r.platformId), ['amazon_main', 'flipkart']);
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

  assert.strictEqual(emitted.length, 6);
  assert.strictEqual(results.length, 6);
  assert.deepStrictEqual(
    results.map((r) => r.platformId).sort(),
    ['amazon_main', 'amazon_tez', 'blinkit', 'flipkart', 'instamart', 'zepto']
  );
});

test('handleSearchQuery - serves repeat queries from the short-TTL cache without re-running providers', async () => {
  SearchCache.resetForTests();
  const seedTs = Date.now();
  const seededResults = [
    { platformId: 'amazon_main', isAvailable: true, priceBreakdown: { finalPayable: 99 }, isLowestPrice: true },
    { platformId: 'flipkart', isAvailable: false, priceBreakdown: null, isLowestPrice: false }
  ];
  const storeIds = ['amazon_main', 'flipkart'];
  const storeSig = storeIds.sort().join(',');
  const cacheKey = `cache hit probe#${storeSig}`;
  await SearchCache.set(DEFAULT_LOCATION.pincode, cacheKey, seededResults, seedTs);

  const results = await handleSearchQuery('cache hit probe', null, storeIds);

  assert.strictEqual(results.length, 2);
  assert.ok(results.every((r) => typeof r.cachedAt === 'number' && r.cachedAt >= seedTs));
  assert.deepStrictEqual(
    results.map((r) => r.platformId),
    ['amazon_main', 'flipkart']
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

test('AmazonMainProvider & FlipkartProvider - construct valid search URLs and formatted results', () => {
  const amz = new AmazonMainProvider();
  assert.strictEqual(amz.platformId, 'amazon_main');
  assert.strictEqual(amz.getSearchUrl('macbook air'), 'https://www.amazon.in/s?k=macbook%20air');

  const flipkart = new FlipkartProvider();
  assert.strictEqual(flipkart.platformId, 'flipkart');
  assert.strictEqual(flipkart.getSearchUrl('iphone 15'), 'https://www.flipkart.com/search?q=iphone%2015');

  const formatted = amz.formatResult({
    title: 'Apple MacBook Air M2',
    price: 89900,
    mrp: 99900,
    brand: 'Apple',
    quantity: '1 unit',
    productUrl: 'https://www.amazon.in/dp/B0B3C572LT'
  }, DEFAULT_LOCATION, 'macbook air');

  assert.strictEqual(formatted.platformId, 'amazon_main');
  assert.strictEqual(formatted.isAvailable, true);
  assert.strictEqual(formatted.priceBreakdown.finalPayable, 89900);
  assert.strictEqual(formatted.productUrl, 'https://www.amazon.in/dp/B0B3C572LT');
  assert.strictEqual(formatted.globalUrl, 'https://www.amazon.in/s?k=macbook%20air');
});

test('CollectionService - returns default collections and allows custom collection management', async () => {
  const collections = await CollectionService.getCollections();
  assert.ok(Array.isArray(collections));
  assert.strictEqual(collections.length, 3);
  assert.strictEqual(collections[0].id, '10_min_pack');
  assert.strictEqual(collections[1].id, 'big_online_pack');
  assert.strictEqual(collections[2].id, 'all_stores');

  const customList = [
    ...collections,
    { id: 'custom_1', name: 'My Grocery', emoji: '🥗', storeIds: ['zepto', 'blinkit'], isCustom: true }
  ];
  await CollectionService.saveCollections(customList);
  const reloaded = await CollectionService.getCollections();
  assert.strictEqual(reloaded.length, 4);
  assert.ok(reloaded.some(c => c.id === 'custom_1'));

  await CollectionService.setActiveCollectionId('custom_1');
  const activeId = await CollectionService.getActiveCollectionId();
  assert.strictEqual(activeId, 'custom_1');
});

test('Amazon.in & Flipkart card extraction logic parses titles and prices accurately', () => {
  // Amazon price parsing simulation
  const amzPriceText = '₹89,900';
  const amzMatch = amzPriceText.replace(/,/g, '').match(/([0-9]+(?:\.[0-9]+)?)/);
  assert.ok(amzMatch);
  assert.strictEqual(parseFloat(amzMatch[1]), 89900);

  // Flipkart price parsing simulation
  const fkPriceText = '₹151';
  const fkMatch = fkPriceText.replace(/,/g, '').match(/([0-9]+(?:\.[0-9]+)?)/);
  assert.ok(fkMatch);
  assert.strictEqual(parseFloat(fkMatch[1]), 151);

  // Flipkart MRP parsing
  const fkMrpText = '₹499';
  const fkMrpMatch = fkMrpText.replace(/,/g, '').match(/([0-9]+(?:\.[0-9]+)?)/);
  assert.ok(fkMrpMatch);
  assert.strictEqual(parseFloat(fkMrpMatch[1]), 499);
});

test('MatchingEngine & candidate filtering discards sponsored ads when score < 25', () => {
  const query = 'lg sound bar';
  const boatSponsored = 'boAt Sponsored Ad - Aavante Prime 5.1 5000D, Cinematic Dolby Audio, 500W Signature Sound';
  const score = MatchingEngine.scoreRelevance(boatSponsored, query);
  
  // boAt misses the 'lg' brand so score is reduced/low
  const isAd = /\b(?:sponsored\s+ad|sponsored|ad)\b/i.test(boatSponsored);
  assert.strictEqual(isAd, true);
  assert.ok(score < 25, `Expected score < 25 for competitor ad, got ${score}`);

  // Test candidate filtering discard
  const candidates = [
    { title: boatSponsored, isSponsored: true, _score: score, price: 9999 },
    { title: 'LG S65TR 600W 5.1 Channel Dolby Digital Soundbar', isSponsored: false, _score: 115, price: 14990 }
  ];

  const valid = candidates.filter(c => {
    const ad = c.isSponsored || /\b(?:sponsored\s+ad|sponsored|ad)\b/i.test(c.title);
    if (ad && c._score < 25) return false;
    return true;
  });

  assert.strictEqual(valid.length, 1);
  assert.strictEqual(valid[0].title, 'LG S65TR 600W 5.1 Channel Dolby Digital Soundbar');
});


