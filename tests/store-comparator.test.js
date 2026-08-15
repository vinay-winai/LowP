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
  AmazonStandardProvider,
  InstamartProvider,
  ZeptoProvider,
  handleSearchQuery
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

test('MatchingEngine - annotateBestOffers assigns lowest price badge', () => {
  const results = [
    {
      platformId: 'amazon_tez',
      isAvailable: true,
      priceBreakdown: { finalPayable: 127 }
    },
    {
      platformId: 'amazon',
      isAvailable: true,
      priceBreakdown: { finalPayable: 140 }
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
    }
  ];

  const annotated = MatchingEngine.annotateBestOffers(results);

  const amzTez = annotated.find(r => r.platformId === 'amazon_tez');
  const amzStd = annotated.find(r => r.platformId === 'amazon');
  const im = annotated.find(r => r.platformId === 'instamart');
  const zepto = annotated.find(r => r.platformId === 'zepto');

  assert.strictEqual(amzTez.isLowestPrice, true); // 127 is lowest
  assert.strictEqual(amzStd.isLowestPrice, false);
  assert.strictEqual(im.isLowestPrice, false);
  assert.strictEqual(zepto.isLowestPrice, false);
});

test('LocationService - initializes with default Hyderabad 500085 location', async () => {
  const loc = await LocationService.getActiveLocation();
  assert.strictEqual(loc.pincode, '500085');
  assert.strictEqual(loc.lat, 17.501725514188223);
  assert.strictEqual(loc.lng, 78.39361254731166);
});

test('Providers - formatResult returns structured schema across Amazon Tez, Amazon Standard, Instamart, and Zepto', () => {
  const amzTez = new AmazonTezProvider();
  const amzStd = new AmazonStandardProvider();
  const im = new InstamartProvider();
  const zepto = new ZeptoProvider();

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

  const resAmzStd = amzStd.formatResult(mockItem, DEFAULT_LOCATION);
  assert.strictEqual(resAmzStd.platformId, 'amazon');
  assert.strictEqual(resAmzStd.isAvailable, true);

  const resIm = im.formatResult(null, DEFAULT_LOCATION);
  assert.strictEqual(resIm.platformId, 'instamart');
  assert.strictEqual(resIm.isAvailable, false);

  const resZepto = zepto.formatResult(mockItem, DEFAULT_LOCATION);
  assert.strictEqual(resZepto.platformId, 'zepto');
  assert.strictEqual(resZepto.isAvailable, true);
});

test('handleSearchQuery - executes parallel search and returns 4 store results', async () => {
  const results = await handleSearchQuery('paneer');
  assert.strictEqual(results.length, 4);
  assert.ok(results.some(r => r.platformId === 'amazon_tez'));
  assert.ok(results.some(r => r.platformId === 'amazon'));
  assert.ok(results.some(r => r.platformId === 'instamart'));
  assert.ok(results.some(r => r.platformId === 'zepto'));
});
