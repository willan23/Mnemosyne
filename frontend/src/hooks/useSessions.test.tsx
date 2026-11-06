import { act, renderHook, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from 'firebase/auth';

type SnapshotDoc = { id: string; data: () => Record<string, unknown> };
type SnapshotChange = { type: 'added' | 'modified' | 'removed'; doc: SnapshotDoc; oldIndex: number; newIndex: number };
type SnapshotInput = { readonly docs: SnapshotDoc[]; changedIds?: string[]; docChanges?: () => SnapshotChange[] };

const state = vi.hoisted(() => ({
  teamIds: [] as string[], ready: true,
  errors: [] as Array<() => void>,
  listeners: [] as Array<(snapshot: SnapshotInput) => void>,
  cryptoChanged: null as (() => void) | null,
  resolve: vi.fn(),
  embed: vi.fn(),
  profiles: [] as string[],
  rank: vi.fn(),
  disposeIndex: vi.fn(),
  disposePrepared: vi.fn(),
  selectedRank: vi.fn(),
  activity: vi.fn(),
}));
vi.mock('../firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(), query: vi.fn(), where: vi.fn(), orderBy: vi.fn(),
  onSnapshot: (_query: unknown, callback: typeof state.listeners[number], error: () => void) => {
    state.errors.push(error);
    let previous: Parameters<typeof callback>[0]['docs'] = [];
    state.listeners.push(snapshot => {
      if (snapshot.docChanges) { callback(snapshot); return; }
      const docs = snapshot.docs, ids = new Set(docs.map(doc => doc.id)), working = [...previous], changes: SnapshotChange[] = [];
      for (const old of previous) {
        if (ids.has(old.id)) continue;
        const oldIndex = working.findIndex(doc => doc.id === old.id); working.splice(oldIndex, 1);
        changes.push({ type: 'removed', doc: old, oldIndex, newIndex: -1 });
      }
      docs.forEach((doc, newIndex) => {
        const oldIndex = working.findIndex(old => old.id === doc.id);
        if (oldIndex === -1) { working.splice(newIndex, 0, doc); changes.push({ type: 'added', doc, oldIndex, newIndex }); }
        else if (oldIndex !== newIndex || !snapshot.changedIds || snapshot.changedIds.includes(doc.id)) {
          working.splice(oldIndex, 1); working.splice(newIndex, 0, doc);
          changes.push({ type: 'modified', doc, oldIndex, newIndex });
        }
      });
      previous = docs;
      callback({ docs, docChanges: () => changes });
    });
    return () => undefined;
  },
}));
vi.mock('../services/memoryCrypto', () => ({
  isMemoryCryptoReady: () => state.ready,
  onMemoryCryptoChanged: (callback: () => void) => {
    state.cryptoChanged = callback;
    return () => { state.cryptoChanged = null; };
  },
}));
vi.mock('../services/teamVault', () => ({ onTeamKeyChanged: () => () => undefined }));
vi.mock('./useMyTeams', () => ({
  useMyTeams: () => [], useTeamIds: () => state.teamIds, useUnlockTeamKeys: () => undefined,
}));
vi.mock('../services/sessionMemoryFields', () => ({
  parseSessionTeamId: (data: Record<string, unknown>) => typeof data.teamId === 'string' && data.teamId ? data.teamId : null,
  resolveSessionSecretFields: (data: Record<string, unknown>) => state.resolve(data),
}));
vi.mock('../services/embeddingService', () => ({
  embeddingService: { getEmbedding: state.embed, cosineSimilarity: () => 1 },
  legacyEmbeddingService: { getEmbedding: state.embed, cosineSimilarity: () => 1 },
  embeddingServiceForProfile: (profile: string) => { state.profiles.push(profile); return { getEmbedding: state.embed }; },
}));
vi.mock('../services/incrementalSearchClient', () => ({
  IncrementalSearchClient: class { rank = state.rank; dispose = state.disposeIndex; },
}));
vi.mock('../services/preparedEmbeddingSearchCache', () => ({
  PreparedEmbeddingSearchCache: class { dispose = state.disposePrepared; },
}));
vi.mock('../services/localMemoryActivity', () => ({ appendLocalMemoryActivity: state.activity }));
vi.mock('../contexts/UIContext', () => ({ useUI: () => ({ isCommandPaletteOpen: true, setIsCommandPaletteOpen: vi.fn(), setIsSettingsOpen: vi.fn() }) }));
vi.mock('../contexts/ThemeContext', () => ({ useTheme: () => ({ toggleTheme: vi.fn() }) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../services/recentSearches', () => ({ readRecentSearches: async () => [], pushRecentSearch: vi.fn(), clearRecentSearches: vi.fn() }));

import { useSessions } from './useSessions';
import { CommandPalette } from '../components/CommandPalette';
import { writeEmbeddingSelection } from '../services/embeddingSelection';
import { HybridSearchIndex } from '../services/hybridSearchIndex';
import { IncrementalMemoryPublication } from '../services/incrementalMemoryPublication';
import type { HybridSearchRequest } from '../services/hybridSearchProtocol';
import { embeddingProfileSpace } from '../services/embeddingProfile';
import { LEGACY_EMBEDDING_SPACE } from '../services/embeddingModel';

class SearchWorker {
  static instances: SearchWorker[] = [];
  index = new HybridSearchIndex();
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminate = vi.fn(() => this.index.clear());
  postMessage = vi.fn((request: HybridSearchRequest) => {
    const data = { id: request.id, ok: true, ...this.index.handle(structuredClone(request)) };
    queueMicrotask(() => { if (!this.terminate.mock.calls.length) this.onmessage?.({ data }); });
  });
  constructor() { SearchWorker.instances.push(this); }
}
vi.mock('../services/selectedEmbeddingSearch', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/selectedEmbeddingSearch')>();
  return { searchSelectedEmbeddingProfile: (...args: Parameters<typeof actual.searchSelectedEmbeddingProfile>) =>
    args[1] === null ? actual.searchSelectedEmbeddingProfile(...args) : state.selectedRank(...args) };
});
const alice = { uid: 'alice' } as User;
const filters = { dateRange: 'all', tags: [] };
const doc = (id: string, extra: Record<string, unknown> = {}) => ({
  id, data: () => ({ uid: 'alice', text: id, timestamp: 1, ...extra }),
});
const deltaOnly = (changes: SnapshotChange[]): SnapshotInput => ({
  get docs(): SnapshotDoc[] { throw Error('Delta callback enumerated the complete snapshot'); },
  docChanges: () => changes,
});

beforeEach(() => {
  SearchWorker.instances = [];
  vi.stubGlobal('Worker', SearchWorker);
  HTMLElement.prototype.scrollIntoView = vi.fn();
  localStorage.clear();
  state.selectedRank.mockReset().mockResolvedValue(new Map([['a', 1]]));
  state.activity.mockReset().mockResolvedValue([]);
  state.teamIds = [];
  state.ready = true;
  state.listeners = [];
  state.errors = [];
  state.disposeIndex.mockClear();
  state.disposePrepared.mockClear();
  state.resolve.mockReset().mockImplementation(async (data) => ({ text: data.text, encrypted: true, locked: false }));
  state.embed.mockReset().mockResolvedValue([1, 0]);
  state.profiles = [];
  state.rank.mockReset().mockImplementation(async (request) =>
    new Map(request.candidates.map((candidate: { id: string }) => [candidate.id, 1])));
});
afterEach(() => vi.unstubAllGlobals());

describe('session cache authorization', () => {
  it('uses only SDK changes after initialization, preserving unchanged objects and tie order', async () => {
    const { result } = renderHook(() => useSessions(alice, '', filters));
    await act(async () => state.listeners[0]({ docs: [doc('a'), doc('b'), doc('c')] }));
    await waitFor(() => expect(result.current.sessions).toHaveLength(3));
    const original = result.current.sessions[0]; state.resolve.mockClear();
    await act(async () => state.listeners[0](deltaOnly([])));
    expect(state.resolve).not.toHaveBeenCalled();
    await act(async () => state.listeners[0](deltaOnly([
      { type: 'modified', doc: doc('c', { text: 'moved' }), oldIndex: 2, newIndex: 0 },
    ])));
    await waitFor(() => expect(result.current.sessions.map(row => row.id)).toEqual(['c', 'a', 'b']));
    expect(result.current.sessions[1]).toBe(original);
    expect(state.resolve).toHaveBeenCalledOnce();
    await act(async () => state.listeners[0](deltaOnly([
      { type: 'removed', doc: doc('a'), oldIndex: 1, newIndex: -1 },
    ])));
    await waitFor(() => expect(result.current.sessions.map(row => row.id)).toEqual(['c', 'b']));
    expect(state.resolve).toHaveBeenCalledOnce();
  });
  it('does not decrypt unauthorized changed documents before excluding them', async () => {
    const { result } = renderHook(() => useSessions(alice, '', filters));
    await act(async () => state.listeners[0]({ docs: [doc('a')] }));
    await waitFor(() => expect(result.current.sessions).toHaveLength(1));
    state.resolve.mockClear();
    await act(async () => state.listeners[0](deltaOnly([
      { type: 'modified', doc: doc('a', { uid: 'bob' }), oldIndex: 0, newIndex: 0 },
      { type: 'added', doc: doc('team', { teamId: 'withdrawn' }), oldIndex: -1, newIndex: 1 },
      { type: 'added', doc: doc('invalid', { teamId: 3 }), oldIndex: -1, newIndex: 2 },
    ])));
    await waitFor(() => expect(result.current.sessions).toEqual([]));
    expect(state.resolve).not.toHaveBeenCalled();
  });
  it('coalesces pending decryption with explicit deltas and removes a pending row without waiting for it', async () => {
    const pending = new Map<string, (value: { text: string; encrypted: boolean; locked: boolean }) => void>();
    state.resolve.mockImplementation(data => new Promise(resolve => pending.set(data.text, resolve)));
    const { result } = renderHook(() => useSessions(alice, '', filters));
    act(() => state.listeners[0]({ docs: [doc('a'), doc('b')] }));
    act(() => state.listeners[0](deltaOnly([
      { type: 'removed', doc: doc('a'), oldIndex: 0, newIndex: -1 },
      { type: 'added', doc: doc('c'), oldIndex: -1, newIndex: 1 },
    ])));
    await act(async () => {
      pending.get('b')!({ text: 'b', encrypted: true, locked: false });
      pending.get('c')!({ text: 'c', encrypted: true, locked: false });
    });
    await waitFor(() => expect(result.current.sessions.map(row => row.id)).toEqual(['b', 'c']));
    await act(async () => pending.get('a')!({ text: 'stale', encrypted: true, locked: false }));
    expect(result.current.sessions.map(row => row.id)).toEqual(['b', 'c']);
  });
  it('clears a denied team synchronously while the remaining large publication yields', async () => {
    state.teamIds = ['crew'];
    const { result } = renderHook(() => useSessions(alice, '', filters));
    await act(async () => state.listeners[0]({ docs: Array.from({ length: 300 }, (_, i) => doc('p' + i)) }));
    await waitFor(() => expect(result.current.sessions).toHaveLength(300));
    await act(async () => state.listeners[1]({ docs: [doc('team', { teamId: 'crew' })] }));
    await waitFor(() => expect(result.current.sessions).toHaveLength(301));
    act(() => state.errors[1]());
    expect(result.current.sessions.some(row => row.id === 'team')).toBe(false);
    await waitFor(() => expect(result.current.sessions).toHaveLength(300));
  });
  it('retires a large publication before an account change and ignores its late task', async () => {
    const { result, rerender } = renderHook(({ user }) => useSessions(user, '', filters), { initialProps: { user: alice } });
    let resume!: () => void;
    const gate = new Promise<void>(resolve => { resume = resolve; });
    const publish = IncrementalMemoryPublication.prototype.publish;
    const spy = vi.spyOn(IncrementalMemoryPublication.prototype, 'publish').mockImplementation(function (this: IncrementalMemoryPublication<{ id: string; timestamp: number }>, ...args) {
      return gate.then(() => publish.apply(this, args));
    });
    try {
      await act(async () => state.listeners[0]({ docs: Array.from({ length: 300 }, (_, i) => doc('p' + i)) }));
      expect(spy).toHaveBeenCalledOnce();
      rerender({ user: { uid: 'bob' } as User });
      await act(async () => resume());
      expect(result.current.allSessions).toEqual([]);
      await act(async () => state.listeners[1]({ docs: [doc('bob', { uid: 'bob' })] }));
      await waitFor(() => expect(result.current.sessions.map(row => row.id)).toEqual(['bob']));
    } finally { spy.mockRestore(); }
  });
  it('routes a mixed persisted snapshot by actual model without requiring a local profile selection', async () => {
    const vector = new Array(384).fill(0); vector[0] = 1;
    state.embed.mockResolvedValue(vector);
    const multilingual = embeddingProfileSpace('multilingualCandidate'), english = embeddingProfileSpace('englishPinned');
    const { result } = renderHook(() => useSessions(alice, 'query', filters));
    await act(async () => state.listeners[0]({ docs: [doc('old', { embedding: vector }),
      doc('multilingual', { embedding: vector, embeddingModel: multilingual }),
      doc('english-pinned', { embedding: vector, embeddingModel: english }),
      doc('unknown', { embedding: vector, embeddingModel: 'unsupported@future' }),
      doc('removed', { embedding: vector, embeddingModel: multilingual, teamId: 'removed-team' })] }));
    await waitFor(() => expect(result.current.searchResults.hits.map(hit => hit.memory.id).sort())
      .toEqual(['english-pinned', 'multilingual', 'old']));
    expect(state.rank.mock.calls.map(([request]) => request.embeddingModel).sort()).toEqual([LEGACY_EMBEDDING_SPACE, english, multilingual].sort());
    expect(state.profiles.sort()).toEqual(['englishPinned', 'multilingualCandidate']);
    expect(state.selectedRank).not.toHaveBeenCalled();
    expect(state.rank.mock.calls.flatMap(([request]) => request.candidates.map((row: { id: string }) => row.id)).sort())
      .toEqual(['english-pinned', 'multilingual', 'old']);
  });
  it('feeds the Worker only changed or removed authorized memories after each snapshot', async () => {
    const { result } = renderHook(() => useSessions(alice, 'synthetic', filters));
    const a = doc('a', { text: 'synthetic first', timestamp: 1 }), b = doc('b', { text: 'synthetic second', timestamp: 2 });
    await act(async () => state.listeners[0]({ docs: [b, a] }));
    await waitFor(() => expect(result.current.searchResults.hits).toHaveLength(2));
    const worker = SearchWorker.instances.at(-1)!; worker.postMessage.mockClear(); state.resolve.mockClear();
    await act(async () => state.listeners[0]({ docs: [b, doc('a', { text: 'synthetic edit', timestamp: 3 })], changedIds: ['a'] }));
    await waitFor(() => expect(result.current.searchResults.hits[0]?.memory.text).toBe('synthetic edit'));
    expect(state.resolve).toHaveBeenCalledTimes(1);
    expect(worker.postMessage.mock.calls[0][0]).toMatchObject({ type: 'prepare', changed: [{ id: 'a' }], removed: [], sortByTimestamp: true });
    expect(worker.postMessage.mock.calls[0][0]).not.toHaveProperty('order', expect.any(Array));
    worker.postMessage.mockClear();
    await act(async () => state.listeners[0]({ docs: [b], changedIds: [] }));
    await waitFor(() => expect(result.current.searchResults.hits.map(row => row.memory.id)).toEqual(['b']));
    expect(worker.postMessage.mock.calls[0][0]).toMatchObject({ changed: [], removed: ['a'] });
  });
  it('keeps initial changes when a later snapshot supersedes pending decryption', async () => {
    let finish!: (value: { text: string; encrypted: boolean; locked: boolean }) => void;
    state.resolve.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockImplementation(async data => ({ text: data.text, encrypted: true, locked: false }));
    const { result } = renderHook(() => useSessions(alice, 'synthetic', filters));
    const a = doc('a', { text: 'synthetic first' }), b = doc('b', { text: 'synthetic second' });
    act(() => state.listeners[0]({ docs: [a, b] }));
    act(() => state.listeners[0]({ docs: [a, doc('b', { text: 'synthetic edited' })], changedIds: ['b'] }));
    await act(async () => finish({ text: 'synthetic first', encrypted: true, locked: false }));
    await waitFor(() => expect(result.current.searchResults.hits).toHaveLength(2));
    expect(result.current.searchResults.hits.map(row => row.memory.text)).toEqual(['synthetic first', 'synthetic edited']);
  });
  it('reports an invalid corpus instead of leaving search loading or exposing an old result', async () => {
    const { result } = renderHook(() => useSessions(alice, 'synthetic', filters));
    await act(async () => state.listeners[0]({ docs: [doc('a', { text: 'synthetic first' })] }));
    await waitFor(() => expect(result.current.searchResults.hits).toHaveLength(1));
    await act(async () => state.listeners[0]({ docs: [doc('x'.repeat(513), { text: 'synthetic invalid id' })] }));
    await waitFor(() => expect(result.current.searchResults.error).toBe('unavailable'));
    expect(result.current.searchResults.hits).toEqual([]); expect(result.current.searchResults.loading).toBe(false);
  });
  it('rebuilds the bucket after a mapping failure even when the retry snapshot has no document changes', async () => {
    const { result } = renderHook(() => useSessions(alice, 'synthetic', filters));
    await act(async () => state.listeners[0]({ docs: [doc('a', { text: 'synthetic original' })] }));
    await waitFor(() => expect(result.current.searchResults.hits).toHaveLength(1));
    state.resolve.mockRejectedValueOnce(new Error('Synthetic mapping failure'));
    const changed = doc('a', { text: 'synthetic recovered' });
    await act(async () => state.listeners[0]({ docs: [changed], changedIds: ['a'] }));
    await waitFor(() => expect(result.current.searchResults.hits).toEqual([]));
    await act(async () => state.listeners[0]({ docs: [changed], changedIds: [] }));
    await waitFor(() => expect(result.current.searchResults.hits[0]?.memory.text).toBe('synthetic recovered'));
  });
  it('records only settled local retrieval counts and index deltas without the query or memory IDs', async () => {
    const { result, rerender } = renderHook(({ query }) => useSessions(alice, query, filters), { initialProps: { query: 'SYNTHETIC-QUERY' } });
    await act(async () => state.listeners[0]({ docs: [doc('SYNTHETIC-MEMORY', { embedding: [1, 0], text: 'SYNTHETIC-CONTENT' })] }));
    await waitFor(() => expect(result.current.filteredSessions).toHaveLength(1));
    const calls = state.activity.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const last = calls.at(-1)!;
    expect(last[0]).toBe('alice');
    expect(last[1]).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'retrieve', operation: 'search', resultCount: 1 }),
      expect.objectContaining({ kind: 'index', changed: 1, removed: 0, indexed: 1 })]));
    expect(JSON.stringify(calls)).not.toMatch(/SYNTHETIC|query|embedding|memoryId|tags/);
    state.activity.mockClear();
    let finish!: (value: number[]) => void;
    state.embed.mockImplementationOnce(() => new Promise<number[]>(resolve => { finish = resolve; }));
    rerender({ query: 'old pending query' });
    await waitFor(() => expect(finish).toBeDefined());
    rerender({ query: 'current query' });
    await waitFor(() => expect(state.activity).toHaveBeenCalled());
    const count = state.activity.mock.calls.length;
    await act(async () => finish([1, 0]));
    expect(state.activity).toHaveBeenCalledTimes(count);
  });
  it('applies UI filters with an empty query in the Worker and reports Worker failure honestly', async () => {
    const scopedFilters = { dateRange: 'all', tags: ['work'] };
    const { result, rerender } = renderHook(({ query }) => useSessions(alice, query, scopedFilters),
      { initialProps: { query: '' } });
    await act(async () => state.listeners[0]({ docs: [doc('work', { tags: ['work'] }), doc('home')] }));
    await waitFor(() => expect(result.current.filteredSessions.map(row => row.id)).toEqual(['work']));
    expect(state.embed).not.toHaveBeenCalled();
    for (const worker of SearchWorker.instances) worker.postMessage.mockImplementation(() => { throw Error('synthetic'); });
    rerender({ query: 'work' });
    await waitFor(() => expect(result.current.searchResults.error).toBe('unavailable'));
    expect(result.current.filteredSessions).toEqual([]);
    expect(result.current.searchResults.loading).toBe(false);
  });
  it('terminates the plaintext Worker immediately on vault lock and membership loss', async () => {
    state.teamIds = ['crew'];
    const { result, rerender } = renderHook(() => useSessions(alice, 'team', filters));
    await act(async () => state.listeners[0]({ docs: [doc('team', { teamId: 'crew' })] }));
    await waitFor(() => expect(result.current.filteredSessions).toHaveLength(1));
    const prior = SearchWorker.instances.at(-1)!;
    state.disposePrepared.mockClear();
    state.teamIds = [];
    rerender();
    expect(prior.terminate).toHaveBeenCalled();
    expect(state.disposePrepared).toHaveBeenCalled();
    expect(result.current.searchResults.hits).toEqual([]);
    const current = SearchWorker.instances.at(-1)!;
    state.disposePrepared.mockClear();
    state.ready = false;
    act(() => state.cryptoChanged?.());
    expect(current.terminate).toHaveBeenCalled();
    expect(state.disposePrepared).toHaveBeenCalled();
    expect(result.current.searchResults.hits).toEqual([]);
  });
  it('delivers semantic-only results to the real palette and suppresses a delayed previous query', async () => {
    const pending: Array<(value: Map<string, number>) => void> = [];
    state.rank.mockImplementation(() => new Promise<Map<string, number>>(resolve => pending.push(resolve)));
    const Integrated = ({ query }: { query: string }) => {
      const value = useSessions(alice, query, filters);
      return <CommandPalette uid="alice" vaultUnlocked searchQuery={query} memories={value.sessions} searchResults={value.searchResults} />;
    };
    const { rerender } = render(<Integrated query="agronomy" />);
    await act(async () => state.listeners[0]({ docs: [doc('a', { text: 'Synthetic orchard evidence', embedding: [1, 0] })] }));
    await waitFor(() => expect(pending).toHaveLength(1));
    expect(screen.queryByText('Synthetic orchard evidence')).not.toBeInTheDocument();
    rerender(<Integrated query="volcano" />);
    await waitFor(() => expect(pending).toHaveLength(2));
    await act(async () => pending[0](new Map([['a', .9]])));
    expect(screen.queryByText('Synthetic orchard evidence')).not.toBeInTheDocument();
    await act(async () => pending[1](new Map()));
    expect(screen.queryByText('Synthetic orchard evidence')).not.toBeInTheDocument();
    rerender(<Integrated query="agronomy" />);
    await waitFor(() => expect(pending).toHaveLength(3));
    await act(async () => pending[2](new Map([['a', .9]])));
    expect(screen.getByRole('button', { name: /Synthetic orchard evidence/ })).toBeInTheDocument();
    state.ready = false;
    act(() => state.cryptoChanged?.());
    expect(screen.queryByText('Synthetic orchard evidence')).not.toBeInTheDocument();
  });
  it('switches to selected search and invalidates its scores immediately on rollback', async () => {
    writeEmbeddingSelection('alice', 'multilingualCandidate');
    state.rank.mockResolvedValue(new Map());
    const { result } = renderHook(() => useSessions(alice, 'query', filters));
    await act(async () => state.listeners[0]({ docs: [doc('a', { embedding: [1, 0] })] }));
    await waitFor(() => expect(result.current.filteredSessions.map(item => item.id)).toEqual(['a']));
    expect(state.selectedRank).toHaveBeenCalled();
    act(() => writeEmbeddingSelection('alice', null));
    expect(result.current.filteredSessions).toEqual([]);
    await waitFor(() => expect(state.rank).toHaveBeenCalled());
  });
  it('keeps unchanged vectors across Firestore updates and decrypts only changed records', async () => {
    const { result } = renderHook(() => useSessions(alice, '', filters));
    await act(async () => state.listeners[0]({ docs: [doc('a', { embedding: [1, 0] }), doc('b')] }));
    await waitFor(()=>expect(result.current.sessions).toHaveLength(2));
    const original = result.current.sessions.find(item => item.id === 'a');
    expect(original).toBeDefined();
    state.resolve.mockClear();
    await act(async () => state.listeners[0]({
      docs: [doc('a', { embedding: [1, 0] }), doc('b', { text: 'updated', updatedAt: 2 })], changedIds: ['b'],
    }));
    await waitFor(()=>expect(result.current.sessions.find(item=>item.id==='b')?.text).toBe('updated'));
    expect(state.resolve).toHaveBeenCalledOnce();
    expect(result.current.sessions.find(item => item.id === 'a')).toBe(original);
    expect(result.current.sessions.find(item => item.id === 'b')?.text).toBe('updated');
    await act(async () => state.listeners[0]({ docs: [doc('b')], changedIds: [] }));
    await waitFor(()=>expect(result.current.sessions.map(item => item.id)).toEqual(['b']));
  });
  it('filters before vector ranking and does not embed operator-only searches', async () => {
    const { result, rerender } = renderHook(({ query }) => useSessions(alice, query, filters),
      { initialProps: { query: 'tag:work cat:note' } });
    await act(async () => state.listeners[0]({ docs: [
      doc('match', { embedding: [1, 0], tags: ['work'], category: 'note' }),
      doc('excluded', { embedding: [1, 0], tags: ['other'], category: 'note' }),
    ] }));
    await waitFor(() => expect(result.current.filteredSessions.map((session) => session.id)).toEqual(['match']));
    expect(state.embed).not.toHaveBeenCalled();
    rerender({ query: 'tag:work cat:note orbit' });
    await waitFor(() => expect(state.rank).toHaveBeenCalled());
    expect(state.embed).toHaveBeenCalledWith('orbit');
    expect(state.rank.mock.calls[0][0].candidates.map((candidate: { id: string }) => candidate.id)).toEqual(['match']);
  });
  it('sends only authorized unlocked IDs and vectors to the ranking worker', async () => {
    state.resolve.mockImplementation(async (data) => ({ text: data.text, encrypted: true, locked: Boolean(data.locked) }));
    renderHook(() => useSessions(alice, 'query', filters));
    await act(async () => state.listeners[0]({ docs: [
      doc('personal', { embedding: [1, 0] }),
      doc('locked', { embedding: [1, 0], locked: true }),
      doc('removed-team', { embedding: [1, 0], teamId: 'crew' }),
    ] }));
    await waitFor(() => expect(state.rank).toHaveBeenCalled());
    expect(state.rank.mock.calls[0][0].candidates).toEqual([
      { id: 'personal', embedding: [1, 0], embeddingModel: undefined },
    ]);
  });
  it('does not reuse vector scores from a different query while inference is pending', async () => {
    const { result, rerender } = renderHook(({ query }) => useSessions(alice, query, filters),
      { initialProps: { query: 'orbit' } });
    await act(async () => state.listeners[0]({ docs: [doc('unrelated', { embedding: [1, 0] })] }));
    await waitFor(() => expect(result.current.filteredSessions).toHaveLength(1));
    state.embed.mockImplementationOnce(() => new Promise(() => undefined));
    rerender({ query: 'volcano' });
    expect(result.current.filteredSessions).toEqual([]);
  });
  it('removes authored team records immediately after membership loss', async () => {
    state.teamIds = ['crew'];
    const { result, rerender } = renderHook(() => useSessions(alice, '', filters));
    await act(async () => state.listeners[0]({ docs: [doc('personal'), doc('team', { teamId: 'crew' })] }));
    await waitFor(()=>expect(result.current.sessions.map((item) => item.id)).toEqual(['personal', 'team']));
    state.disposeIndex.mockClear();
    state.teamIds = [];
    rerender();
    expect(result.current.sessions.map((item) => item.id)).toEqual(['personal']);
    expect(result.current.allSessions.map((item) => item.id)).toEqual(['personal']);
    expect(state.disposeIndex).toHaveBeenCalled();
  });

  it('hides decrypted cache on account change and vault lock', async () => {
    const { result, rerender } = renderHook(({ user }) => useSessions(user, '', filters),
      { initialProps: { user: alice } });
    await act(async () => state.listeners[0]({ docs: [doc('secret')] }));
    await waitFor(()=>expect(result.current.sessions).toHaveLength(1));
    state.disposeIndex.mockClear();
    rerender({ user: { uid: 'bob' } as User });
    expect(result.current.sessions).toEqual([]);
    expect(state.disposeIndex).toHaveBeenCalled();
    rerender({ user: alice });
    state.ready = false;
    state.disposeIndex.mockClear();
    act(() => state.cryptoChanged?.());
    expect(result.current.sessions).toEqual([]);
    expect(result.current.allSessions).toEqual([]);
    expect(state.disposeIndex).toHaveBeenCalled();
  });

  it('does not restore a removed document when an older decryption finishes late', async () => {
    let finish!: (value: { text: string; encrypted: boolean; locked: boolean }) => void;
    state.resolve.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const { result } = renderHook(() => useSessions(alice, '', filters));
    act(() => state.listeners[0]({ docs: [doc('old')] }));
    await act(async () => state.listeners[0]({ docs: [] }));
    await act(async () => finish({ text: 'old private text', encrypted: true, locked: false }));
    expect(result.current.allSessions).toEqual([]);
  });

  it('clears denied subscriptions and ignores an in-flight decryption after denial', async () => {
    const { result } = renderHook(() => useSessions(alice, '', filters));
    await act(async () => state.listeners[0]({ docs: [doc('loaded')] }));
    await waitFor(()=>expect(result.current.allSessions).toHaveLength(1));
    let finish!: (value: { text: string; encrypted: boolean; locked: boolean }) => void;
    state.resolve.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    act(() => state.listeners[0]({ docs: [doc('pending')] }));
    act(() => state.errors[0]());
    expect(result.current.allSessions).toEqual([]);
    await act(async () => finish({ text: 'stale', encrypted: true, locked: false }));
    expect(result.current.allSessions).toEqual([]);
  });
});
