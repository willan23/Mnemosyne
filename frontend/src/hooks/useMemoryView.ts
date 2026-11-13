import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MemoryObject } from '../types/universe';
import { MemoryViewClient, type MemoryViewResult } from '../services/memoryViewClient';
import type { MemoryViewOptions } from '../services/memoryViewProtocol';
import { onMemoryCryptoChanged } from '../services/memoryCrypto';
import { onTeamKeyChanged } from '../services/teamVault';
import { memorySnapshotScopeActive } from '../services/memorySnapshot';

const empty: MemoryViewResult = { memories: [], lookup: new Map(), count: 0 };
export function useMemoryView(memories: readonly MemoryObject[], options: MemoryViewOptions, enabled = true) {
  const activation = useMemo(() => ({ enabled, client: new MemoryViewClient(options.mode) }), [options.mode, enabled]);
  const client = activation.client;
  const source = useRef(memories);
  useLayoutEffect(() => { source.current = memories; }, [memories]);
  const [retired, setRetired] = useState<readonly MemoryObject[] | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt(value => value + 1), []);
  const [result, setResult] = useState<{ client: MemoryViewClient; source: readonly MemoryObject[]; options: MemoryViewOptions; attempt: number; value: MemoryViewResult; error: boolean } | null>(null);
  useEffect(() => () => client.dispose(), [client]);
  useEffect(() => {
    const retire = () => { client.dispose(); setRetired(source.current); setResult(null); };
    const personal = onMemoryCryptoChanged(retire), team = onTeamKeyChanged(retire);
    return () => { personal(); team(); };
  }, [client]);
  useEffect(() => {
    if (!enabled) { client.dispose(); return; }
    if (retired === memories || !memorySnapshotScopeActive(memories)) return;
    const controller = new AbortController(); let active = true;
    void client.select(memories, options, controller.signal).then(value => {
      if (active) setResult({ client, source: memories, options, attempt, value, error: false });
    }).catch(() => { if (active) setResult({ client, source: memories, options, attempt, value: empty, error: true }); });
    return () => { active = false; controller.abort(); };
  }, [client, memories, options, attempt, retired, enabled]);
  // A removed account/key/filter must never render the previous result while a new job runs.
  const live = retired !== memories && memorySnapshotScopeActive(memories);
  const current = activation.enabled && live && result?.client === client && result.source === memories && result.options === options && result.attempt === attempt;
  return { ...(current ? result.value : empty), ready: !enabled || Boolean(current && !result.error), loading: enabled && live && memories.length > 0 && !current,
    error: current && result.error, retry };
}
