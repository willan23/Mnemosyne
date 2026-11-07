import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { SessionData } from './useSessions';
import { CapturePreviewClient, type CapturePreviewResult, type CapturePreviewScope } from '../services/capturePreviewClient';
import { onMemoryCryptoChanged } from '../services/memoryCrypto';
import { onTeamKeyChanged } from '../services/teamVault';
import { memorySnapshotScopeActive } from '../services/memorySnapshot';

/** Optional local suggestions; scope/query changes hide old results before the next effect. */
export function useCapturePreview(source: readonly SessionData[], query: string, scope: CapturePreviewScope | null): CapturePreviewResult[] {
  const client = useMemo(() => scope ? new CapturePreviewClient(scope) : null, [scope]);
  const latest = useRef(source); useLayoutEffect(() => { latest.current = source; }, [source]);
  const [retired, setRetired] = useState<readonly SessionData[] | null>(null);
  const [result, setResult] = useState<{ client: CapturePreviewClient; source: readonly SessionData[]; query: string; hits: CapturePreviewResult[] } | null>(null);
  useEffect(() => () => client?.dispose(), [client]);
  useEffect(() => {
    const retire = () => { client?.dispose(); setRetired(latest.current); setResult(null); };
    const personal = onMemoryCryptoChanged(retire), team = onTeamKeyChanged(retire);
    return () => { personal(); team(); };
  }, [client]);
  useEffect(() => {
    if (!client || retired === source) return;
    let active = true; const controller = new AbortController();
    void client.select(source, query, controller.signal).then(hits => {
      if (active) setResult({ client, source, query, hits });
    }).catch(() => { if (active) setResult(null); });
    return () => { active = false; controller.abort(); };
  }, [client, source, query, retired]);
  return memorySnapshotScopeActive(source) && retired !== source && result?.client === client && result.source === source && result.query === query ? result.hits : [];
}
