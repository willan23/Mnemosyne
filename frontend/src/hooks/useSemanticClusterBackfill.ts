import { useEffect, useRef } from 'react';
import type { User } from 'firebase/auth';
import { doc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import type { SessionData } from './useSessions';
import { buildSemanticClusterBackfillPatches } from '../services/semanticClusterBackfill';

const BATCH_SIZE = 400;

export const useSemanticClusterBackfill = (
  user: User | null,
  sessions: SessionData[],
  enabled = true
) => {
  const lastRunKeyRef = useRef('');

  useEffect(() => {
    if (!enabled || !user || sessions.length === 0) return;

    const patches = buildSemanticClusterBackfillPatches(sessions);
    if (patches.length === 0) return;

    const runKey = `${user.uid}:${patches.map((patch) => `${patch.id}:${patch.semanticClusterId}`).join('|')}`;
    if (lastRunKeyRef.current === runKey) return;
    lastRunKeyRef.current = runKey;

    let cancelled = false;

    const runBackfill = async () => {
      try {
        for (let index = 0; index < patches.length; index += BATCH_SIZE) {
          if (cancelled) return;

          const batch = writeBatch(db);
          patches.slice(index, index + BATCH_SIZE).forEach((patch) => {
            batch.update(doc(db, 'sessions', patch.id), {
              semanticClusterId: patch.semanticClusterId,
            });
          });
          await batch.commit();
        }

        console.info(`Semantic cluster backfill applied to ${patches.length} memories.`);
      } catch (error) {
        lastRunKeyRef.current = '';
        console.warn('Semantic cluster backfill failed:', error);
      }
    };

    runBackfill();

    return () => {
      cancelled = true;
    };
  }, [enabled, user, sessions]);
};
