const assert = require('node:assert/strict');
const test = require('node:test');

const { tombstoneAckedByAllActiveDevices } = require('../lib/mobileSyncRetention.js');

const ackState = (activeDeviceIds, pulledByDevice = {}) => ({
  activeDeviceIds,
  pulledTombstonesByDevice: new Map(
    Object.entries(pulledByDevice).map(([deviceId, memoryIds]) => [
      deviceId,
      new Set(memoryIds),
    ])
  ),
});

test('allows tombstone cleanup when there are no active devices', () => {
  assert.equal(tombstoneAckedByAllActiveDevices('memory-1', undefined, ackState([])), true);
});

test('treats the deleting device as already acknowledged', () => {
  assert.equal(
    tombstoneAckedByAllActiveDevices('memory-1', 'phone-a', ackState(['phone-a'])),
    true
  );
});

test('requires every other active device to pull an envelope with the tombstone id', () => {
  assert.equal(
    tombstoneAckedByAllActiveDevices(
      'memory-1',
      'phone-a',
      ackState(['phone-a', 'phone-b', 'phone-c'], {
        'phone-b': ['memory-1'],
        'phone-c': ['memory-1', 'memory-2'],
      })
    ),
    true
  );
});

test('retains tombstones while any active device has not acknowledged them', () => {
  assert.equal(
    tombstoneAckedByAllActiveDevices(
      'memory-1',
      'phone-a',
      ackState(['phone-a', 'phone-b', 'phone-c'], {
        'phone-b': ['memory-1'],
        'phone-c': ['memory-2'],
      })
    ),
    false
  );
});
