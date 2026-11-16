import {useEffect, useRef, useState} from 'react';
import type {User} from 'firebase/auth';
import type {SessionData} from './useSessions';
import {useSyncFeedback} from './useSyncFeedback';
import {observeSemanticClusterRequests} from '../services/semanticClusterRecovery';
import {runSemanticClusterMaintenance, semanticClusterMaintenanceKey} from '../services/semanticClusterMaintenance';

export const useSemanticClusterBackfill = (user: User | null, allSessions: readonly SessionData[], enabled = true) => {
  const feedback = useSyncFeedback(enabled);
  const running = useRef(false), attempted = useRef(''), alive = useRef(false);
  const [, refresh] = useState(0);
  useEffect(() => {alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(() => observeSemanticClusterRequests(() => refresh(value => value + 1)), []);
  useEffect(() => {
    if (!enabled || !user || running.current || !allSessions.length) return;
    const key = JSON.stringify([feedback.epoch, semanticClusterMaintenanceKey(user.uid, allSessions)]);
    if (attempted.current === key) return;
    attempted.current = key;
    const current = feedback.capture(user.uid);
    if (!current()) return;
    running.current = true;
    const assertCurrent = () => { if (!current()) throw Error('O contexto da manutenção mudou.'); };
    void runSemanticClusterMaintenance(user.uid, allSessions, assertCurrent).catch(() => {
      // The saved request is recovered explicitly. Avoid automatic retries of a stale component.
    }).finally(() => {running.current = false; if (alive.current) refresh(value => value + 1);});
  });
};
