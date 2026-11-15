import { createCognitiveAnalysisYield as createControlledYield } from './cognitiveAnalysisYield';

export const SNAPSHOT_MAPPING_LIMITS = Object.freeze({ concurrency: 8, batch: 128 });
const unavailable = () => new Error('incremental_snapshot_unavailable');
type Waiter<T> = { resolve: (value: T) => void; reject: (error: unknown) => void };
type Work<T> = { work: () => Promise<T>; failed: () => void };
type Owner<T> = {
  retired: boolean;
  work: Map<SnapshotMapping<T>, Work<T>>;
  waiting: Set<SnapshotMapping<T>>;
};
// Jobs kept by an obsolete collector must not keep queued document closures alive.
// The generation owns those closures and drops them together on retirement.
const mappingOwner = Symbol('snapshot_mapping_owner');
const ownerOf = <T>(job: SnapshotMapping<T>) => job[mappingOwner];
export interface SnapshotMapping<T> {
  readonly id: string;
  readonly [mappingOwner]: Owner<T>;
  state: 'queued' | 'running' | 'fulfilled' | 'rejected';
  value?: T;
  error?: unknown;
  waiters: Waiter<T>[];
  next: SnapshotMapping<T> | null;
}
/** A promise is allocated only when a collector actually waits for this job. */
export function readSnapshotMapping<T>(job: SnapshotMapping<T>): Promise<T> {
  if (job.state === 'fulfilled') return Promise.resolve(job.value as T);
  if (job.state === 'rejected') return Promise.reject(job.error);
  const owner = ownerOf(job);
  if (owner.retired && job.state === 'queued') {
    cancelQueuedSnapshotMapping(job);
    return Promise.reject(job.error);
  }
  return new Promise((resolve, reject) => { owner.waiting.add(job); job.waiters.push({ resolve, reject }); });
}
export function cancelQueuedSnapshotMapping<T>(job: SnapshotMapping<T>): void {
  if (job.state !== 'queued') return;
  const owner = ownerOf(job); owner.work.delete(job); owner.waiting.delete(job);
  job.state = 'rejected'; job.error = unavailable();
  for (const waiter of job.waiters.splice(0)) waiter.reject(job.error);
}
/** One listener generation owns this queue. Retired queues can never start another mapper. */
export class SnapshotMappingQueue<T> {
  private head: SnapshotMapping<T> | null = null;
  private tail: SnapshotMapping<T> | null = null;
  private running = 0;
  private started = 0;
  private paused = false;
  private holds = 0;
  private readonly owner: Owner<T> = { retired: false, work: new Map(), waiting: new Set() };
  private readonly controlled = createControlledYield();
  private readonly yieldTask: () => Promise<void>;
  constructor(yieldTask?: () => Promise<void>) { this.yieldTask = yieldTask ?? this.controlled.yieldTask; }
  enqueue(id: string, work: () => Promise<T>, failed: () => void): SnapshotMapping<T> {
    if (this.owner.retired) throw unavailable();
    const job: SnapshotMapping<T> = { id, [mappingOwner]: this.owner, state: 'queued', waiters: [], next: null };
    this.owner.work.set(job, { work, failed });
    if (this.tail) this.tail.next = job; else this.head = job;
    this.tail = job; this.drain(); return job;
  }
  /** Metadata ingestion may pause new reads without interrupting native work in flight. */
  hold(): () => void {
    if (this.owner.retired) throw unavailable();
    this.holds++; let released = false;
    return () => { if (released) return; released = true; this.holds--; this.drain(); };
  }
  retire(): void {
    if (this.owner.retired) return;
    this.owner.retired = true; this.controlled.cancel();
    this.head = this.tail = null; this.owner.work.clear();
    // Only jobs with actual collectors need immediate rejection. Untouched jobs
    // reject lazily if an obsolete collector ever tries to read them.
    for (const job of this.owner.waiting) cancelQueuedSnapshotMapping(job);
    // Native async work already started cannot be cancelled here. Its old lease still
    // settles, but this retired generation cannot publish or invalidate a new queue.
  }
  private finish(job: SnapshotMapping<T>, failed: () => void, result: { value: T } | { error: unknown }): void {
    this.running--; this.owner.waiting.delete(job);
    if ('error' in result) {
      job.state = 'rejected'; job.error = result.error;
      for (const waiter of job.waiters.splice(0)) waiter.reject(result.error);
      if (!this.owner.retired) failed();
    } else {
      job.state = 'fulfilled'; job.value = result.value;
      for (const waiter of job.waiters.splice(0)) waiter.resolve(result.value);
    }
    this.drain();
  }
  private drain(): void {
    if (this.owner.retired || this.paused || this.holds) return;
    while (this.head && this.running < SNAPSHOT_MAPPING_LIMITS.concurrency && this.started < SNAPSHOT_MAPPING_LIMITS.batch) {
      const job = this.head; this.head = job.next; job.next = null; if (!this.head) this.tail = null;
      if (job.state !== 'queued') continue;
      const { work, failed } = this.owner.work.get(job)!; this.owner.work.delete(job);
      job.state = 'running'; this.running++; this.started++;
      let mapped: Promise<T>; try { mapped = Promise.resolve(work()); } catch (error) { mapped = Promise.reject(error); }
      void mapped.then(value => this.finish(job, failed, { value }), error => this.finish(job, failed, { error }));
    }
    if (this.head && this.started === SNAPSHOT_MAPPING_LIMITS.batch) {
      this.paused = true;
      void this.yieldTask().then(() => { this.paused = false; this.started = 0; this.drain(); }, () => this.retire());
    } else if (!this.head && !this.running) this.started = 0;
  }
}
