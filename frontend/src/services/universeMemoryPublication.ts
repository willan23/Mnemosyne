import type { MemoryObject } from '../types/universe';
import { IncrementalMemoryPublication, type MemoryPublicationPatch } from './incrementalMemoryPublication';
import { IndexedSemanticWriteCorpus } from './indexedSemanticWriteCorpus';
import { memorySnapshotScopeActive, type MemorySnapshot } from './memorySnapshot';
import { semanticWriteId } from './semanticWriteProtocol';

declare const commitBrand: unique symbol;
/** Only confirmations issued in the current publication scope can change its local projection. */
export type UniverseViewCommit = object & { readonly [commitBrand]: true };
export interface UniverseDeletionRecord { id: string; teamId: string | null; revision: number }
export interface UniverseAuthorityValue { memory: MemoryObject | null; tombstone: boolean; revision: number }
export interface UniversePublicationControl {
  isCurrent(): boolean;
  beforeCommit?: () => boolean;
  beforeAuthority?: () => void;
  afterCommit?: () => void;
}
type CreateCommit = { kind: 'create'; owner: UniverseMemoryPublication; id: string; memory: MemoryObject | null; cancelled: boolean; consumed: boolean; afterSequence: number };
type DeleteCommit = { kind: 'delete'; owner: UniverseMemoryPublication; id: string; teamId: string | null; revision: number; digest: string; phase: 'issued' | 'staged' | 'finished' };
type Commit = CreateCommit | DeleteCommit;
const commits = new WeakMap<object, Commit>(), publications = new WeakMap<object, UniverseMemoryPublication>();
const overlaySource = 'local-confirmed', overlayPriority = Number.MAX_SAFE_INTEGER;
const deleteKey = (id: string, teamId: string | null) => JSON.stringify([teamId, id]);
const namespace = (key: string): string | null => key.startsWith('team:') ? key.slice(5) : null;

export class UniverseMemoryPublication {
  private closed = false;
  private observed = new Map<string, number>();
  private overlays = new Map<string, { kind: 'create' | 'delete'; memory: MemoryObject; afterSequence: number }>();
  private issuedCreates = new Map<string, Set<CreateCommit>>();
  private denied = new Set<string>();
  private readonly options: {
    uid: string; publication: IncrementalMemoryPublication<MemoryObject>; semantic: IndexedSemanticWriteCorpus<MemoryObject>;
    isCurrent: () => boolean; teams: () => ReadonlySet<string>; changed: () => void;
    tombstones: Set<string>; deletions: Map<string, UniverseDeletionRecord>;
  };
  constructor(options: UniverseMemoryPublication['options']) { this.options = options; }
  active(): boolean { return !this.closed && this.options.isCurrent(); }
  private allowed(teamId: string | null): boolean { return this.active() && (teamId === null || this.options.teams().has(teamId)); }
  private targets(record: UniverseDeletionRecord): string[] { return record.teamId === null ? ['personal', 'legacy'] : ['team:' + record.teamId]; }
  private exclude(key: string, id: string, value: boolean): void {
    const personal = this.options.deletions.has(deleteKey(id, null));
    const effective = value || key === 'legacy' && (personal || this.options.tombstones.has(id));
    this.options.publication.exclude(key, id, effective); this.options.semantic.exclude(key, id, effective);
  }
  legacyTombstone(id: string, value: boolean): void { if (this.active()) this.exclude('legacy', id, value); }
  observedSnapshot(key: string, sequence: number): void { if (this.active()) this.observed.set(key, sequence); }
  private putOverlay(kind: 'create' | 'delete', memory: MemoryObject, afterSequence = 0): void {
    const oldIndex = this.options.publication.sourcePosition(overlaySource, memory.id), order = oldIndex === undefined
      ? { changes: [{ id: memory.id, type: 'added' as const, oldIndex: -1, newIndex: this.options.publication.sourceSize(overlaySource) }] } : { changes: [] };
    const patch = { changed: [{ id: memory.id, value: memory }], removed: [], order };
    this.overlays.set(memory.id, { kind, memory, afterSequence });
    this.applyProjection(overlaySource, patch, overlayPriority);
  }
  private dropOverlay(id: string): void {
    const position = this.options.publication.sourcePosition(overlaySource, id); this.overlays.delete(id); if (position === undefined) return;
    const patch = { changed: [], removed: [id], order: { changes: [{ id, type: 'removed' as const, oldIndex: position, newIndex: -1 }] } };
    this.applyProjection(overlaySource, patch, overlayPriority);
  }
  private applyProjection(key: string, patch: MemoryPublicationPatch<MemoryObject>, priority?: number): void {
    this.options.publication.apply(key, patch, priority);
    this.options.semantic.adoptPublicationSource(key, this.options.publication.captureSource(key), patch);
  }
  private cancelCreates(id: string): void { for (const issued of this.issuedCreates.get(id) ?? []) { issued.cancelled = true; issued.memory = null; } if (this.overlays.get(id)?.kind === 'create') this.dropOverlay(id); }
  private dropDeletion(record: UniverseDeletionRecord): void {
    const overlay = this.overlays.get(record.id);
    if (overlay?.kind === 'delete' && (overlay.memory.teamId ?? null) === record.teamId) this.dropOverlay(record.id);
  }
  private release(record: UniverseDeletionRecord): void {
    this.options.deletions.delete(deleteKey(record.id, record.teamId));
    this.dropDeletion(record);
    for (const key of this.targets(record)) this.exclude(key, record.id, false);
  }
  /** Apply only touched IDs; the source's own order remains authoritative. */
  apply(key: string, patch: MemoryPublicationPatch<MemoryObject>, values: ReadonlyMap<string, UniverseAuthorityValue>, sequence: number): void {
    if (!this.active()) return;
    this.denied.delete(key);
    this.reconcileAuthority(key, patch, values);
    this.applyProjection(key, patch, key === 'legacy' ? 0 : key === 'personal' ? 1 : undefined);
    this.finishAuthority(key, sequence);
  }
  async applyControlled(key: string, patch: MemoryPublicationPatch<MemoryObject>, values: ReadonlyMap<string, UniverseAuthorityValue>, sequence: number, control: UniversePublicationControl): Promise<void> {
    await this.options.publication.applyControlled(key, patch, {
      isCurrent: () => this.active() && control.isCurrent(), priority: key === 'legacy' ? 0 : key === 'personal' ? 1 : undefined,
      beforeCommit: control.beforeCommit,
      afterCommit: () => {
        this.denied.delete(key); control.beforeAuthority?.(); this.reconcileAuthority(key, patch, values);
        this.options.semantic.adoptPublicationSource(key, this.options.publication.captureSource(key), patch); this.finishAuthority(key, sequence); control.afterCommit?.();
      },
    });
  }
  private reconcileAuthority(key: string, patch: MemoryPublicationPatch<MemoryObject>, values: ReadonlyMap<string, UniverseAuthorityValue>): void {
    const touched = new Set([...patch.changed.map(row => row.id), ...patch.removed, ...patch.order.changes.map(row => row.id)]);
    if (patch.order.reset) for (const id of patch.order.reset) touched.add(id);
    const removed = new Set(patch.removed);
    for (const id of touched) {
      const value = values.get(id), scope = namespace(key), record = this.options.deletions.get(deleteKey(id, scope));
      if (record) {
        const mayRestore = key !== 'legacy' && value?.memory && (value.memory.teamId ?? null) === record.teamId && !value.tombstone && value.revision > record.revision;
        if (mayRestore) this.release(record);
        else {
          this.exclude(key, id, true);
          if (key === 'personal') this.exclude('legacy', id, true);
          if (removed.has(id) || value?.tombstone && value.revision >= record.revision) this.dropDeletion(record);
        }
      }
      if (key === 'personal') {
        if (removed.has(id) || value?.tombstone) this.cancelCreates(id);
        else if (value?.memory) { for (const issued of this.issuedCreates.get(id) ?? []) issued.memory = null; if (this.overlays.get(id)?.kind === 'create') this.dropOverlay(id); }
      }
    }
  }
  private finishAuthority(key: string, sequence: number): void {
    if (key === 'personal') for (const [id, overlay] of this.overlays) if (overlay.kind === 'create' && sequence > overlay.afterSequence && !this.options.publication.sourceValue('personal', id)) this.dropOverlay(id);
  }
  removeSource(key: string): void {
    if (!this.active()) return;
    this.denied.add(key);
    if (key !== 'legacy') for (const [id, overlay] of this.overlays) if (namespace(key) === (overlay.memory.teamId ?? null)) this.dropOverlay(id);
    if (key === 'personal') for (const id of this.issuedCreates.keys()) this.cancelCreates(id);
    this.options.publication.removeSource(key); this.options.semantic.removeSource(key);
  }
  created(memory: MemoryObject, id: string): UniverseViewCommit | undefined {
    if (!this.allowed(null) || this.denied.has('personal') || !semanticWriteId(id) || memory.uid !== this.options.uid || memory.teamId || memory.teamScopeAmbiguous || memory.encLocked || memory.deletedAt || memory.pendingDeletion) return;
    const token = Object.freeze({}) as UniverseViewCommit, value: CreateCommit = { kind: 'create', owner: this, id, memory: { ...memory, id }, cancelled: this.options.tombstones.has(id) || this.options.deletions.has(deleteKey(id, null)), consumed: false, afterSequence: this.observed.get('personal') ?? 0 };
    commits.set(token, value); let issued = this.issuedCreates.get(id); if (!issued) { issued = new Set(); this.issuedCreates.set(id, issued); } issued.add(value); return token;
  }
  deleted(memory: MemoryObject, revision: number): UniverseViewCommit | undefined {
    const teamId = memory.teamId ?? null;
    if (!this.allowed(teamId) || !semanticWriteId(memory.id) || !Number.isFinite(revision) || revision <= 0 || !memory.persistedStateDigest) return;
    const authoritative = this.options.publication.sourceValue(teamId === null ? 'personal' : 'team:' + teamId, memory.id);
    if (authoritative && (authoritative.persistedUpdatedAt ?? authoritative.updatedAt) > revision) return;
    const record = { id: memory.id, teamId, revision }, prior = this.options.deletions.get(deleteKey(memory.id, teamId));
    if (!prior || prior.revision < revision) this.options.deletions.set(deleteKey(memory.id, teamId), record);
    const token = Object.freeze({}) as UniverseViewCommit; commits.set(token, { kind: 'delete', owner: this, ...record, digest: memory.persistedStateDigest, phase: 'issued' }); return token;
  }
  snapshot(): MemorySnapshot<MemoryObject> {
    if (!this.active()) throw Error('universe_publication_unavailable');
    const snapshot = this.options.publication.snapshot(); this.options.semantic.associate(snapshot); publications.set(snapshot, this); return snapshot;
  }
  create(value: CreateCommit): MemorySnapshot<MemoryObject> | undefined {
    if (!this.allowed(null) || this.denied.has('personal') || value.cancelled || value.consumed) return;
    value.consumed = true;
    const current = this.options.publication.sourceValue('personal', value.id);
    if (!current && value.memory && !this.options.tombstones.has(value.id) && !this.options.deletions.has(deleteKey(value.id, null))) this.putOverlay('create', value.memory, value.afterSequence);
    value.memory = null; this.issuedCreates.get(value.id)?.delete(value); if (!this.issuedCreates.get(value.id)?.size) this.issuedCreates.delete(value.id);
    this.options.changed(); return this.snapshot();
  }
  stage(value: DeleteCommit): MemorySnapshot<MemoryObject> | undefined {
    if (!this.allowed(value.teamId) || value.phase !== 'issued' || this.denied.has(value.teamId === null ? 'personal' : 'team:' + value.teamId)) return;
    if (this.options.deletions.get(deleteKey(value.id, value.teamId))?.revision !== value.revision) return;
    const current = this.options.publication.get(value.id);
    value.phase = 'staged';
    if (current && (current.teamId ?? null) === value.teamId && current.persistedStateDigest === value.digest && (current.persistedUpdatedAt ?? current.updatedAt) <= value.revision)
      this.putOverlay('delete', { ...current, deletedAt: value.revision, pendingDeletion: true, embedding: [], embeddingModel: undefined });
    for (const key of this.targets(value)) this.exclude(key, value.id, true);
    this.options.changed(); return this.snapshot();
  }
  finish(value: DeleteCommit): MemorySnapshot<MemoryObject> | undefined {
    if (!this.allowed(value.teamId) || value.phase !== 'staged') return;
    const record = this.options.deletions.get(deleteKey(value.id, value.teamId)); if (!record || record.revision !== value.revision) return;
    value.phase = 'finished';
    this.dropDeletion(record);
    for (const key of this.targets(value)) this.exclude(key, value.id, true);
    this.options.changed(); return this.snapshot();
  }
  clear(): void { this.closed = true; for (const issued of this.issuedCreates.values()) for (const value of issued) { value.memory = null; value.cancelled = true; } this.issuedCreates.clear(); this.overlays.clear(); }
}

export const isUniversePublication = (values: readonly MemoryObject[]): boolean => publications.has(values);
function confirmation(values: readonly MemoryObject[], token: UniverseViewCommit | undefined, id: string, kind: Commit['kind']): Commit | undefined {
  if (!token || !memorySnapshotScopeActive(values)) return;
  const value = commits.get(token), owner = publications.get(values); return value && value.owner === owner && value.id === id && value.kind === kind && owner?.active() ? value : undefined;
}
export function confirmUniverseCreation(values: readonly MemoryObject[], id: string, token?: UniverseViewCommit): MemorySnapshot<MemoryObject> | undefined { const value = confirmation(values, token, id, 'create'); return value?.kind === 'create' ? value.owner.create(value) : undefined; }
export function stageUniverseDeletion(values: readonly MemoryObject[], id: string, token?: UniverseViewCommit): MemorySnapshot<MemoryObject> | undefined { const value = confirmation(values, token, id, 'delete'); return value?.kind === 'delete' ? value.owner.stage(value) : undefined; }
export function finishUniverseDeletion(values: readonly MemoryObject[], id: string, token?: UniverseViewCommit): MemorySnapshot<MemoryObject> | undefined { const value = confirmation(values, token, id, 'delete'); return value?.kind === 'delete' ? value.owner.finish(value) : undefined; }
