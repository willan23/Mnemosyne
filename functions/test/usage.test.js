const assert = require('node:assert/strict');
const test = require('node:test');
const { nextUsageAfterMemoryCreate, memoriesUsedInCurrentPeriod } = require('../lib/usage.js');

test('nextUsageAfterMemoryCreate starts a new period at 1', () => {
  const now = new Date(Date.UTC(2026, 7, 31));
  const next = nextUsageAfterMemoryCreate(undefined, now);
  assert.deepEqual(next, {
    memoriesThisMonth: 1,
    periodYear: 2026,
    periodMonth: 8,
  });
});

test('nextUsageAfterMemoryCreate increments within the same UTC month', () => {
  const now = new Date(Date.UTC(2026, 7, 15));
  const next = nextUsageAfterMemoryCreate({
    memoriesThisMonth: 7,
    periodYear: 2026,
    periodMonth: 8,
  }, now);
  assert.equal(next.memoriesThisMonth, 8);
  assert.equal(next.periodMonth, 8);
});

test('nextUsageAfterMemoryCreate rolls over a stale period', () => {
  const now = new Date(Date.UTC(2026, 8, 1));
  const next = nextUsageAfterMemoryCreate({
    memoriesThisMonth: 30,
    periodYear: 2026,
    periodMonth: 8,
  }, now);
  assert.deepEqual(next, {
    memoriesThisMonth: 1,
    periodYear: 2026,
    periodMonth: 9,
  });
});

test('memoriesUsedInCurrentPeriod treats stale counters as zero', () => {
  const now = new Date(Date.UTC(2026, 7, 31));
  assert.equal(memoriesUsedInCurrentPeriod({
    memoriesThisMonth: 30,
    periodYear: 2026,
    periodMonth: 7,
  }, now), 0);
  assert.equal(memoriesUsedInCurrentPeriod({
    memoriesThisMonth: 12,
    periodYear: 2026,
    periodMonth: 8,
  }, now), 12);
});
