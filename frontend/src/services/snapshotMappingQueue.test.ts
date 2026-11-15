import { expect, it, vi } from 'vitest';
import { SnapshotMappingQueue, readSnapshotMapping, cancelQueuedSnapshotMapping } from './snapshotMappingQueue';

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

it('retires a large unobserved queue without walking its links or starting queued document reads', async () => {
  const hold = deferred<string>(), queue = new SnapshotMappingQueue<string>(), read = vi.fn(() => hold.promise), failed = vi.fn();
  const jobs = Array.from({ length: 100_000 }, (_, at) => queue.enqueue('n' + at, read, failed));
  expect(read).toHaveBeenCalledTimes(8);
  Object.defineProperty(jobs[8], 'next', { get() { throw Error('walked retired queue'); } });
  queue.retire(); queue.retire();
  await expect(readSnapshotMapping(jobs[99_999])).rejects.toThrow('incremental_snapshot_unavailable');
  await expect(readSnapshotMapping(jobs[8])).rejects.toThrow('incremental_snapshot_unavailable');
  expect(() => queue.enqueue('late', read, failed)).toThrow('incremental_snapshot_unavailable');
  hold.resolve('native result'); await Promise.resolve(); await Promise.resolve();
  expect(read).toHaveBeenCalledTimes(8); expect(failed).not.toHaveBeenCalled();
});

it('rejects every observed queued waiter while allowing running native work to settle', async () => {
  const hold = deferred<string>(), queue = new SnapshotMappingQueue<string>(), failed = vi.fn();
  const jobs = Array.from({ length: 140 }, (_, at) => queue.enqueue('n' + at, () => hold.promise, failed));
  const running = readSnapshotMapping(jobs[0]);
  const first = expect(readSnapshotMapping(jobs[100])).rejects.toThrow('incremental_snapshot_unavailable');
  const second = expect(readSnapshotMapping(jobs[100])).rejects.toThrow('incremental_snapshot_unavailable');
  const third = expect(readSnapshotMapping(jobs[139])).rejects.toThrow('incremental_snapshot_unavailable');
  queue.retire(); await Promise.all([first, second, third]);
  hold.resolve('old'); expect(await running).toBe('old');
  expect(failed).not.toHaveBeenCalled();
});

it('cancels a queued replacement independently and conserves the subsequent queue order', async () => {
  const hold = deferred<string>(), queue = new SnapshotMappingQueue<string>(), seen: string[] = [];
  const jobs = Array.from({ length: 20 }, (_, at) => queue.enqueue('n' + at, async () => { seen.push('n' + at); await hold.promise; return 'n' + at; }, () => {}));
  cancelQueuedSnapshotMapping(jobs[10]); cancelQueuedSnapshotMapping(jobs[10]);
  await expect(readSnapshotMapping(jobs[10])).rejects.toThrow('incremental_snapshot_unavailable');
  hold.resolve('ready'); expect(await readSnapshotMapping(jobs[19])).toBe('n19');
  expect(seen).toEqual(Array.from({ length: 20 }, (_, at) => 'n' + at).filter(id => id !== 'n10'));
  queue.retire();
});

it('suppresses retired failure callbacks and isolates the fresh generation from late failures', async () => {
  const hold = deferred<string>(), old = new SnapshotMappingQueue<string>(), oldFailure = vi.fn();
  const job = old.enqueue('old', () => hold.promise, oldFailure), observed = expect(readSnapshotMapping(job)).rejects.toThrow('native failed');
  old.retire();
  const fresh = new SnapshotMappingQueue<string>(), freshFailure = vi.fn(), next = fresh.enqueue('fresh', async () => 'current', freshFailure);
  hold.reject(Error('native failed')); await observed;
  expect(await readSnapshotMapping(next)).toBe('current'); expect(oldFailure).not.toHaveBeenCalled(); expect(freshFailure).not.toHaveBeenCalled(); fresh.retire();
});

it('reports an active mapping failure once even when its value has several collectors', async () => {
  const hold = deferred<string>(), queue = new SnapshotMappingQueue<string>(), failure = vi.fn();
  const job = queue.enqueue('a', () => hold.promise, failure);
  const first = expect(readSnapshotMapping(job)).rejects.toThrow('failed'), second = expect(readSnapshotMapping(job)).rejects.toThrow('failed');
  hold.reject(Error('failed')); await Promise.all([first, second]); expect(failure).toHaveBeenCalledOnce(); queue.retire();
});

it('pauses queued reads until every metadata hold is released and releases each hold only once', async () => {
  const queue = new SnapshotMappingQueue<string>(), first = queue.hold(), second = queue.hold(), seen: string[] = [];
  const jobs = Array.from({ length: 12 }, (_, at) => queue.enqueue('n' + at, async () => { seen.push('n' + at); return 'n' + at; }, () => {}));
  first(); first(); await Promise.resolve(); expect(seen).toEqual([]);
  second(); expect(await readSnapshotMapping(jobs[11])).toBe('n11');
  expect(seen).toEqual(Array.from({ length: 12 }, (_, at) => 'n' + at)); queue.retire();
});

it('a retired metadata hold can never start a read even when it is released later', async () => {
  const queue = new SnapshotMappingQueue<string>(), release = queue.hold(), read = vi.fn(async () => 'old');
  const job = queue.enqueue('old', read, () => {}), rejected = expect(readSnapshotMapping(job)).rejects.toThrow('incremental_snapshot_unavailable');
  queue.retire(); release(); release(); await rejected; expect(read).not.toHaveBeenCalled();
  expect(() => queue.hold()).toThrow('incremental_snapshot_unavailable');
});
