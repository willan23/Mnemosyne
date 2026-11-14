import { createCognitiveAnalysisYield as createControlledYield } from './cognitiveAnalysisYield';

export const SNAPSHOT_MAPPING_LIMITS = Object.freeze({ concurrency: 8, batch: 128 });
const unavailable = () => new Error('incremental_snapshot_unavailable');
type Waiter<T> = { resolve: (value: T) => void; reject: (error: unknown) => void };
export interface SnapshotMapping<T> {
  readonly id: string;
  state: 'queued' | 'running' | 'fulfilled' | 'rejected';
  work: (() => Promise<T>) | null;
  failed: (() => void) | null;
  value?: T;
  error?: unknown;
  waiters: Waiter<T>[];
  next: SnapshotMapping<T> | null;
}
/** A promise is allocated only when a collector actually waits for this job. */
export function readSnapshotMapping<T>(job: SnapshotMapping<T>): Promise<T> {
  if (job.state === 'fulfilled') return Promise.resolve(job.value as T);
  if (job.state === 'rejected') return Promise.reject(job.error);
  return new Promise((resolve, reject) => { job.waiters.push({ resolve, reject }); });
}
export function cancelQueuedSnapshotMapping<T>(job: SnapshotMapping<T>): void {
  if (job.state !== 'queued') return;
  job.state = 'rejected'; job.error = unavailable(); job.work = job.failed = null;
  for (const waiter of job.waiters.splice(0)) waiter.reject(job.error);
}
/** One listener generation owns this queue. Retired queues can never start another mapper. */
export class SnapshotMappingQueue<T> {
  private head: SnapshotMapping<T> | null = null;
  private tail: SnapshotMapping<T> | null = null;
  private running = 0;
  private started = 0;
  private paused = false;
  private retired = false;
  private readonly controlled = createControlledYield();
  private readonly yieldTask: () => Promise<void>;
  constructor(yieldTask?: () => Promise<void>) { this.yieldTask = yieldTask ?? this.controlled.yieldTask; }
  enqueue(id: string, work: () => Promise<T>, failed: () => void): SnapshotMapping<T> {
    if (this.retired) throw unavailable();
    const job: SnapshotMapping<T> = { id, work, failed, state: 'queued', waiters: [], next: null };
    if (this.tail) this.tail.next = job; else this.head = job;
    this.tail = job; this.drain(); return job;
  }
  retire(): void {
    if (this.retired) return;
    this.retired = true; this.controlled.cancel();
    let job = this.head; this.head = this.tail = null;
    while (job) { const next = job.next; job.next = null; cancelQueuedSnapshotMapping(job); job = next; }
    // Native async work already started cannot be cancelled here. Its old lease still
    // settles, but this retired generation cannot publish or invalidate a new queue.
  }
  private finish(job: SnapshotMapping<T>, result: { value: T } | { error: unknown }): void {
    this.running--; const failed = job.failed; job.work = job.failed = null;
    if ('error' in result) {
      job.state = 'rejected'; job.error = result.error;
      for (const waiter of job.waiters.splice(0)) waiter.reject(result.error);
      if (!this.retired) failed?.();
    } else {
      job.state = 'fulfilled'; job.value = result.value;
      for (const waiter of job.waiters.splice(0)) waiter.resolve(result.value);
    }
    this.drain();
  }
  private drain(): void {
    if (this.retired || this.paused) return;
    while (this.head && this.running < SNAPSHOT_MAPPING_LIMITS.concurrency && this.started < SNAPSHOT_MAPPING_LIMITS.batch) {
      const job = this.head; this.head = job.next; job.next = null; if (!this.head) this.tail = null;
      if (job.state !== 'queued') continue;
      const work = job.work!; job.work = null; job.state = 'running'; this.running++; this.started++;
      let mapped: Promise<T>; try { mapped = Promise.resolve(work()); } catch (error) { mapped = Promise.reject(error); }
      void mapped.then(value => this.finish(job, { value }), error => this.finish(job, { error }));
    }
    if (this.head && this.started === SNAPSHOT_MAPPING_LIMITS.batch) {
      this.paused = true;
      void this.yieldTask().then(() => { this.paused = false; this.started = 0; this.drain(); }, () => this.retire());
    } else if (!this.head && !this.running) this.started = 0;
  }
}
