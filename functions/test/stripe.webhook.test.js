process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-mnemosyne-test';
process.env.FIREBASE_CONFIG = process.env.FIREBASE_CONFIG || JSON.stringify({
  projectId: 'demo-mnemosyne-test',
});

const assert = require('node:assert/strict');
const test = require('node:test');
const { processStripeWebhookRequest } = require('../lib/stripe.js');

function createRes() {
  return {
    statusCode: 200,
    payload: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(body) {
      this.payload = body;
      return this;
    },
    json(body) {
      this.payload = body;
      return this;
    },
  };
}

function fakeEvent(overrides = {}) {
  return {
    id: 'evt_test_1',
    type: 'checkout.session.completed',
    livemode: false,
    ...overrides,
  };
}

test('rejects missing stripe signature', async () => {
  const res = createRes();
  await processStripeWebhookRequest(
    { headers: {}, rawBody: Buffer.from('{}') },
    res,
    {
      webhookSecret: 'whsec_test',
      constructEvent: () => {
        throw new Error('should not construct');
      },
      claimEvent: async () => true,
      releaseEventClaim: async () => {},
      dispatchEvent: async () => {},
    },
  );
  assert.equal(res.statusCode, 400);
});

test('rejects invalid webhook signature', async () => {
  const res = createRes();
  const secret = 'synthetic webhook credential';
  const messages = [];
  const originalError = console.error;
  console.error = (...parts) => { messages.push(parts); };
  try {
    await processStripeWebhookRequest(
      { headers: { 'stripe-signature': 'sig' }, rawBody: Buffer.from('{}') },
      res,
      {
        webhookSecret: 'whsec_test',
        constructEvent: () => {
          throw new Error(secret);
        },
        claimEvent: async () => true,
        releaseEventClaim: async () => {},
        dispatchEvent: async () => {},
      },
    );
    assert.equal(res.statusCode, 400);
    assert.equal(res.payload, 'Webhook signature invalid');
    assert.equal(JSON.stringify(messages).includes(secret), false);
  } finally {
    console.error = originalError;
  }
});

test('short-circuits duplicate events without dispatch', async () => {
  const res = createRes();
  let dispatched = 0;
  await processStripeWebhookRequest(
    { headers: { 'stripe-signature': 'sig' }, rawBody: Buffer.from('{}') },
    res,
    {
      webhookSecret: 'whsec_test',
      constructEvent: () => fakeEvent(),
      claimEvent: async () => false,
      releaseEventClaim: async () => {},
      dispatchEvent: async () => {
        dispatched += 1;
      },
    },
  );
  assert.equal(dispatched, 0);
  assert.deepEqual(res.payload, { received: true, duplicate: true });
});

test('dispatches claimed events', async () => {
  const res = createRes();
  let dispatched = 0;
  await processStripeWebhookRequest(
    { headers: { 'stripe-signature': 'sig' }, rawBody: Buffer.from('{}') },
    res,
    {
      webhookSecret: 'whsec_test',
      constructEvent: () => fakeEvent(),
      claimEvent: async () => true,
      releaseEventClaim: async () => {},
      dispatchEvent: async () => {
        dispatched += 1;
      },
    },
  );
  assert.equal(dispatched, 1);
  assert.deepEqual(res.payload, { received: true });
});

test('releases claim and returns 500 when dispatch fails', async () => {
  const res = createRes();
  let released = 0;
  await processStripeWebhookRequest(
    { headers: { 'stripe-signature': 'sig' }, rawBody: Buffer.from('{}') },
    res,
    {
      webhookSecret: 'whsec_test',
      constructEvent: () => fakeEvent(),
      claimEvent: async () => true,
      releaseEventClaim: async () => {
        released += 1;
      },
      dispatchEvent: async () => {
        throw new Error('handler boom');
      },
    },
  );
  assert.equal(released, 1);
  assert.equal(res.statusCode, 500);
});
