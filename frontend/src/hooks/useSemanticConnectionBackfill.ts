import { useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import type { SessionData } from './useSessions';
import type { SemanticConnectionMemory } from '../services/semanticConnectionBackfill';
import { semanticProposalRevision, readSemanticProposalProgress } from '../services/semanticProposalCheckpoint';
import type {
  SemanticProposalWorkerCommand,
  SemanticProposalWorkerResponse,
} from '../services/semanticProposalWorkerProtocol';
import { personalSemanticCandidates } from '../services/personalSemanticScope';
import {prepareSemanticRelationCandidates,persistSemanticRelationSource,semanticRelationWritesEnabled,hasPendingSemanticRelations,observeSemanticRelationResumed} from '../services/semanticRelationRecovery';
import {useSyncFeedback} from './useSyncFeedback';
import {teamRevisionTime} from '../../../functions/src/teamRevisionContract';

const CHECKPOINT_PREFIX = 'mnemosyne.semantic-proposals.v2.';
const PAUSE_BETWEEN_SOURCES_MS = 1000;
const UTC_DAY_MS = 86_400_000;
const MAX_SOURCES_PER_DAY = 500;
const utcDay = () => Math.floor(Date.now() / UTC_DAY_MS);

function readCheckpoint(key: string, revision: string, count: number, day: number, fallback: Map<string, string>) {
  try {
    return readSemanticProposalProgress(fallback.get(key) || localStorage.getItem(key), revision, count, day);
  } catch {
    return readSemanticProposalProgress(fallback.get(key) || null, revision, count, day);
  }
}

function saveCheckpoint(
  key: string, revision: string, next: number, day: number, processedToday: number,
  fallback: Map<string, string>,
): void {
  const value = JSON.stringify({ revision, next, day, processedToday });
  fallback.set(key, value);
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private browsing may deny storage. The current pass can still finish.
  }
}

export const useSemanticConnectionBackfill = (
  user: User | null,
  sessions: SessionData[],
  enabled = true,
) => {
  const [budgetEpoch, setBudgetEpoch] = useState(0);
  const [recoveryEpoch,setRecoveryEpoch]=useState(0);
  const uid=user?.uid;
  useEffect(()=>uid?observeSemanticRelationResumed(uid,()=>setRecoveryEpoch(value=>value+1)):undefined,[uid]);
  const {epoch:feedbackEpoch,capture:captureFeedback}=useSyncFeedback(enabled);
  const fallbackProgressRef = useRef(new Map<string, string>());
  useEffect(() => {
    if (!enabled || !user || !semanticRelationWritesEnabled() || hasPendingSemanticRelations(user.uid) || sessions.length < 2) return;
    const current=captureFeedback(user.uid);
    if(!current())return;
    const candidates: SemanticConnectionMemory[] = personalSemanticCandidates(sessions, user.uid)
      .filter((session) => session.semanticRelationHash && Array.isArray(session.embedding) && session.embedding.length > 0)
      .map((session) => ({
        id: session.id,
        embedding: session.embedding,
        embeddingModel: session.embeddingModel,
        connections: session.connections,
        updatedAt: teamRevisionTime(session.updatedAt)??0,
        viewHash: session.semanticRelationHash,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    if (candidates.length < 2) return;

    const revision = semanticProposalRevision(candidates);
    const checkpointKey = CHECKPOINT_PREFIX + user.uid;
    let day = utcDay();
    const progress = readCheckpoint(checkpointKey, revision, candidates.length, day, fallbackProgressRef.current);
    const startIndex = progress.next;
    let processedToday = progress.processedToday;
    if (startIndex >= candidates.length) return;

    let resumeTimer: number | undefined;
    const scheduleResume = () => {
      const nextDay = (utcDay() + 1) * UTC_DAY_MS;
      resumeTimer = window.setTimeout(() => setBudgetEpoch((current) => current + 1),
        Math.max(1000, nextDay - Date.now() + 1000));
    };
    if (processedToday >= MAX_SOURCES_PER_DAY) {
      scheduleResume();
      return () => window.clearTimeout(resumeTimer);
    }

    let cancelled = false;
    const guard=()=>{if(cancelled||!current())throw Error('O contexto das propostas mudou.');};
    let worker: Worker | null = null;
    let nextId = 0;
    const pending = new Map<number, {
      resolve: (response: SemanticProposalWorkerResponse) => void;
      reject: (error: Error) => void;
    }>();
    const stopWorker = () => {
      worker?.terminate();
      worker = null;
      for (const request of pending.values()) request.reject(new Error('Ranking cancelado.'));
      pending.clear();
    };
    const send = (command: SemanticProposalWorkerCommand): Promise<SemanticProposalWorkerResponse> => {
      if (!worker) return Promise.reject(new Error('Worker de ranking indisponível.'));
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        try {
          worker?.postMessage({ ...command, id });
        } catch {
          pending.delete(id);
          reject(new Error('Falha ao comunicar com o Worker de ranking.'));
        }
      });
    };

    const runBackfill = async () => {
      try {
        const candidateIds=new Set(candidates.map(row=>row.id));
        const views=personalSemanticCandidates(sessions,user.uid).filter(row=>candidateIds.has(row.id)).map(row=>({sessionId:row.id,viewHash:row.semanticRelationHash!}));
        const prepared=await prepareSemanticRelationCandidates(user.uid,views,guard);guard();
        worker = new Worker(new URL('../services/semanticProposalWorker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = (event: MessageEvent<SemanticProposalWorkerResponse>) => {
          const response = event.data;
          const request = pending.get(response.id);
          if (!request) return;
          pending.delete(response.id);
          if (response.ok) request.resolve(response);
          else request.reject(new Error('O ranking local falhou.'));
        };
        worker.onerror = () => stopWorker();
        worker.onmessageerror = () => stopWorker();
        await send({ type: 'load', memories: candidates });

        for (let index = startIndex; index < candidates.length; index += 1) {
          if (cancelled) return;
          const currentDay = utcDay();
          if (currentDay !== day) {
            day = currentDay;
            processedToday = 0;
          }
          if (processedToday >= MAX_SOURCES_PER_DAY) {
            scheduleResume();
            return;
          }
          const response = await send({ type: 'rank', sourceId: candidates[index].id });
          if (!response.ok || cancelled) return;
          await persistSemanticRelationSource(user.uid,prepared,candidates[index].id,response.proposals || [],guard);
          if (cancelled) return;
          processedToday += 1;
          saveCheckpoint(checkpointKey, revision, index + 1, day, processedToday, fallbackProgressRef.current);
          if (index + 1 < candidates.length) {
            await new Promise((resolve) => window.setTimeout(resolve, PAUSE_BETWEEN_SOURCES_MS));
          }
        }
      } catch {
        if (!cancelled&&current()) console.warn('As propostas de relação aguardam confirmação.');
      } finally {
        stopWorker();
      }
    };
    void runBackfill();
    return () => {
      cancelled = true;
      window.clearTimeout(resumeTimer);
      stopWorker();
    };
  }, [enabled, user, sessions, budgetEpoch,feedbackEpoch,captureFeedback,recoveryEpoch]);
};
