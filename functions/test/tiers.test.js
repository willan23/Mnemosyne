process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-mnemosyne-test';
process.env.FIREBASE_CONFIG = process.env.FIREBASE_CONFIG || JSON.stringify({
  projectId: 'demo-mnemosyne-test',
});

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  normalizeTier,
  getEffectiveTier,
  findTierForPrice,
  buildEntitlementsPayload,
  parseHistoricalStripePriceIds,
  determineTier,
} = require('../lib/stripe.js');

const prices = {
  pro: { monthly: 'price_pro_m', yearly: 'price_pro_y' },
  sovereign: { monthly: 'price_sov_m', yearly: 'price_sov_y' },
};

test('normalizeTier maps known aliases and defaults to free', () => {
  assert.equal(normalizeTier('pro'), 'pro');
  assert.equal(normalizeTier('sovereign'), 'sovereign');
  assert.equal(normalizeTier('business'), 'sovereign');
  assert.equal(normalizeTier('free'), 'free');
  assert.equal(normalizeTier('unknown'), 'free');
  assert.equal(normalizeTier(null), 'free');
});

test('getEffectiveTier keeps entitled statuses and drops canceled', () => {
  assert.equal(getEffectiveTier('pro', 'active'), 'pro');
  assert.equal(getEffectiveTier('sovereign', 'trialing'), 'sovereign');
  assert.equal(getEffectiveTier('pro', 'past_due'), 'pro');
  assert.equal(getEffectiveTier('pro', 'canceled'), 'free');
  assert.equal(getEffectiveTier('pro', 'unpaid'), 'free');
  assert.equal(getEffectiveTier('free', 'active'), 'free');
});

test('findTierForPrice matches configured prices and defaults to free', () => {
  assert.equal(findTierForPrice('price_pro_m', prices), 'pro');
  assert.equal(findTierForPrice('price_sov_y', prices), 'sovereign');
  assert.equal(findTierForPrice('price_unknown', prices), 'free');
  assert.equal(findTierForPrice(undefined, prices), 'free');
});

test('price replacement preserves monthly and annual historical entitlements without promoting unknown prices', () => {
  const historical = { pro: ['price_legacyProMonth', 'price_legacyProYear'], sovereign: ['price_legacySovMonth', 'price_legacySovYear'] };
  for (const id of historical.pro) assert.equal(findTierForPrice(id, prices, historical), 'pro');
  for (const id of historical.sovereign) assert.equal(findTierForPrice(id, prices, historical), 'sovereign');
  assert.equal(findTierForPrice('price_pro_m', prices, historical), 'pro');
  assert.equal(findTierForPrice('price_otherApp', prices, historical), 'free');
});

test('a price assigned to conflicting tiers fails closed for current and historical configurations', () => {
  assert.equal(findTierForPrice('price_pro_m', prices, { sovereign: ['price_pro_m'] }), 'free');
  assert.equal(findTierForPrice('price_collision', prices, { pro: ['price_collision'], sovereign: ['price_collision'] }), 'free');
  assert.equal(findTierForPrice('price_pro_m', prices, { pro: ['price_pro_m'] }), 'pro');
});

test('historical price configuration is bounded, deduplicated and rejects malformed or mixed lists', () => {
  assert.deepEqual(parseHistoricalStripePriceIds('["price_legacyProYear","price_legacyProYear"]'), ['price_legacyProYear']);
  for (const value of [undefined, '', 'not-json', '{}', '[null]', '["price_legacyProYear",42]', '["https://example.com/"]', '["price_short"]', JSON.stringify(Array(101).fill('price_legacyProYear')), ' '.repeat(16385)]) {
    assert.deepEqual(parseHistoricalStripePriceIds(value), []);
  }
});

test('subscription reconciliation reads the historical catalogue when current checkout prices have changed', () => {
  const config = {
    STRIPE_PRICE_PRO_MONTHLY: 'price_currentProMonth',
    STRIPE_PRICE_SOVEREIGN_MONTHLY: 'price_currentSovMonth',
    STRIPE_HISTORICAL_PRICE_PRO_IDS: '["price_legacyProMonth","price_legacyProYear"]',
    STRIPE_HISTORICAL_PRICE_SOVEREIGN_IDS: '["price_legacyBusinessMonth","price_legacyBusinessYear"]',
  };
  const previous = Object.fromEntries(Object.keys(config).map(key => [key, process.env[key]]));
  try {
    Object.assign(process.env, config);
    for (const id of ['price_currentProMonth', 'price_legacyProMonth', 'price_legacyProYear']) {
      assert.equal(determineTier({ items: { data: [{ price: { id } }] } }), 'pro');
    }
    for (const id of ['price_currentSovMonth', 'price_legacyBusinessMonth', 'price_legacyBusinessYear']) {
      assert.equal(determineTier({ items: { data: [{ price: { id } }] } }), 'sovereign');
    }
    assert.equal(determineTier({ items: { data: [{ price: { id: 'price_foreignProduct' } }] } }), 'free');
  } finally {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test('buildEntitlementsPayload is free when missing entitlements input', () => {
  const free = buildEntitlementsPayload(undefined, undefined);
  assert.equal(free.effectiveTier, 'free');
  assert.equal(free.canUploadAttachments, false);
  assert.equal(free.memoriesPerMonth, 30);

  const pro = buildEntitlementsPayload('pro', 'active');
  assert.equal(pro.effectiveTier, 'pro');
  assert.equal(pro.canUploadAttachments, true);
  assert.equal(pro.memoriesPerMonth, -1);

  const lapsed = buildEntitlementsPayload('pro', 'canceled');
  assert.equal(lapsed.effectiveTier, 'free');
  assert.equal(lapsed.canUploadAttachments, false);
});
