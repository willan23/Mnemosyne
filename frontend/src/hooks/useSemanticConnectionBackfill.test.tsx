import { act, renderHook } from '@testing-library/react';
import type { User } from 'firebase/auth';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionData } from './useSessions';
import { buildSemanticRelationProposalsForSource, type SemanticConnectionMemory,type SemanticRelationProposal } from '../services/semanticConnectionBackfill';
import { useSemanticConnectionBackfill } from './useSemanticConnectionBackfill';

const firestore = vi.hoisted(() => ({
  set: vi.fn(),
  runTransaction: vi.fn(),
}));

vi.mock('../firebase', () => ({ db: {} }));
vi.mock('./useSyncFeedback',()=>({useSyncFeedback:()=>({epoch:0,capture:()=>()=>true})}));
vi.mock('../services/semanticRelationRecovery',()=>({semanticRelationWritesEnabled:()=>true,hasPendingSemanticRelations:()=>false,observeSemanticRelationResumed:()=>()=>{},prepareSemanticRelationCandidates:async(uid:string,views:Array<{sessionId:string;viewHash:string}>)=>({kind:'candidates',ownerUid:uid,dependencies:views.map(row=>({sessionId:row.sessionId,stateHash:'a'.repeat(64),revision:1}))}),persistSemanticRelationSource:async(_uid:string,_base:unknown,sourceId:string,proposals:SemanticRelationProposal[])=>{for(const proposal of proposals)firestore.set('sessions/'+sourceId+'/relationSuggestions/'+proposal.targetId,proposal);return{status:'committed'};}}));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...parts: string[]) => parts.join('/'),
  runTransaction: (...args: unknown[]) => firestore.runTransaction(...args),
}));

class FakeRankingWorker {
  static ranks = 0;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  memories: SemanticConnectionMemory[] = [];
  terminated = false;

  postMessage(message: { id: number; type: 'load' | 'rank'; memories?: SemanticConnectionMemory[]; sourceId?: string }) {
    queueMicrotask(() => {
      if (this.terminated) return;
      if (message.type === 'load') this.memories = message.memories || [];
      if (message.type === 'rank') FakeRankingWorker.ranks += 1;
      const source = this.memories.find((memory) => memory.id === message.sourceId);
      const proposals = source ? buildSemanticRelationProposalsForSource(source, this.memories) : [];
      this.onmessage?.({ data: { id: message.id, ok: true, proposals } } as MessageEvent);
    });
  }

  terminate() {
    this.terminated = true;
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-25T12:00:00Z'));
  FakeRankingWorker.ranks = 0;
  localStorage.clear();
  firestore.set.mockReset();
  firestore.runTransaction.mockReset().mockImplementation(async (_db, callback) => callback({
    get: async () => ({ exists: () => false }),
    set: firestore.set,
    update: vi.fn(),
  }));
  vi.stubGlobal('Worker', FakeRankingWorker);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('useSemanticConnectionBackfill', () => {
  it('processes a late candidate, persists progress and resumes without new writes', async () => {
    const session = (id: string, embedding: number[]): SessionData => ({
      id, uid: 'alice', text: 'synthetic', timestamp: 1, updatedAt: 1, embedding, connections: [],semanticRelationHash:'a'.repeat(64),
    });
    const sessions = [session('source', [1, 0]),
      ...Array.from({ length: 100 }, (_, index) => session(`other-${index}`, [0, 1])),
      session('late', [1, 0])];
    const user = { uid: 'alice' } as User;
    const first = renderHook(() => useSemanticConnectionBackfill(user, sessions));
    await act(async () => { await vi.runAllTimersAsync(); });
    const checkpoint = JSON.parse(localStorage.getItem('mnemosyne.semantic-proposals.v2.alice') || '{}');
    expect(checkpoint.next).toBe(sessions.length);
    expect(firestore.set.mock.calls.some(([path]) => path === 'sessions/source/relationSuggestions/late'))
      .toBe(true);
    const writes = firestore.set.mock.calls.length;
    first.unmount();

    const second = renderHook(() => useSemanticConnectionBackfill(user, sessions));
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(firestore.set).toHaveBeenCalledTimes(writes);
    second.unmount();
  });

  it('caps background sources per UTC day and resumes on the next day', async () => {
    const sessions: SessionData[] = Array.from({ length: 501 }, (_, index) => ({
      id: `memory-${index}`, uid: 'alice', text: 'synthetic', timestamp: 1,
      updatedAt: 1, embedding: [1, 0],semanticRelationHash:'a'.repeat(64),
      connections: Array.from({ length: 7 }, (_, n) => `manual-${n}`),
    }));
    const hook = renderHook(() => useSemanticConnectionBackfill({ uid: 'alice' } as User, sessions));
    await act(async () => { await vi.advanceTimersByTimeAsync(510_000); });
    const key = 'mnemosyne.semantic-proposals.v2.alice';
    const first = JSON.parse(localStorage.getItem(key) || '{}');
    expect(first.next).toBe(500);
    expect(first.processedToday).toBe(500);
    expect(firestore.runTransaction).not.toHaveBeenCalled();

    await act(async () => { await vi.advanceTimersByTimeAsync(43_000_000); });
    const resumed = JSON.parse(localStorage.getItem(key) || '{}');
    expect(resumed.next).toBe(501);
    expect(resumed.processedToday).toBe(1);
    hook.unmount();
  });

  it('keeps the daily cap across rerenders when browser storage is unavailable', async () => {
    const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage denied');
    });
    const sessions: SessionData[] = Array.from({ length: 501 }, (_, index) => ({
      id: `memory-${index}`, uid: 'alice', text: 'synthetic', timestamp: 1,
      updatedAt: 1, embedding: [1, 0],semanticRelationHash:'a'.repeat(64),
      connections: Array.from({ length: 7 }, (_, n) => `manual-${n}`),
    }));
    const user = { uid: 'alice' } as User;
    const hook = renderHook(({ items }) => useSemanticConnectionBackfill(user, items), {
      initialProps: { items: sessions },
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(510_000); });
    expect(FakeRankingWorker.ranks).toBe(500);
    hook.rerender({ items: [...sessions] });
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(FakeRankingWorker.ranks).toBe(500);
    hook.unmount();
    storage.mockRestore();
  });
});
