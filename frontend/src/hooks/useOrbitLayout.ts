import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebase';
import type { MemoryObject } from '../types/universe';
import type { OrbitPosition } from '../engines/orbitMath';
import { OrbitLayoutClient, type OrbitSelection } from '../services/orbitLayoutClient';
import { canReadCachedMemory, type MemoryReadScope } from '../services/memoryReadScope';
import { isMemoryCryptoReady, onMemoryCryptoChanged } from '../services/memoryCrypto';
import { onTeamKeyChanged } from '../services/teamVault';
import { memorySnapshotDelta, memorySnapshotScopeActive } from '../services/memorySnapshot';

export interface OrbitPositionAccess { get(id: string): OrbitPosition | undefined; active(): boolean }
const emptyPositions: OrbitPositionAccess = Object.freeze({ get: () => undefined, active: () => false });
const emptyMap: ReadonlyMap<string, OrbitPosition> = new Map();
type Spec = { source: readonly MemoryObject[]; ids: readonly string[]; scope: MemoryReadScope; enabled: boolean; attempt: number };
type Frame = { client: OrbitLayoutClient; spec: Spec; value: OrbitSelection };
/** RAF requests coalesce behind one Worker operation. Only metadata/selection readiness re-renders React. */
export function useOrbitLayout(source: readonly MemoryObject[], ids: readonly string[], scope: MemoryReadScope, enabled = true) {
  const activation = useMemo(() => ({ scope, enabled, client: new OrbitLayoutClient(scope) }), [scope, enabled]);
  const [retired, setRetired] = useState<readonly MemoryObject[] | null>(null), [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt(value => value + 1), []);
  const current = useRef<Spec>({ source, ids, scope, enabled, attempt });
  useLayoutEffect(() => { current.current = { source, ids, scope, enabled, attempt }; }, [source, ids, scope, enabled, attempt]);
  const promoted = useRef<Frame | null>(null), positionsRef = useRef<OrbitPositionAccess>(emptyPositions), clock = useRef({ time: 0, now: 0 }), scheduler = useRef<(() => void) | null>(null);
  const [result, setResult] = useState<{ client: OrbitLayoutClient; spec: Spec; zero: OrbitSelection | null; error: boolean } | null>(null);
  const requestFrame = useCallback((time: number, now: number) => { if (!Number.isFinite(time) || !Number.isFinite(now)) return; clock.current = { time, now }; scheduler.current?.(); }, []);
  useEffect(() => () => activation.client.dispose(), [activation]);
  useEffect(() => {
    const retire = () => { activation.client.dispose(); promoted.current = null; setRetired(current.current.source); setResult(null); };
    const personal = onMemoryCryptoChanged(retire), team = onTeamKeyChanged(retire), account = onAuthStateChanged(auth, user => { if (user?.uid !== activation.scope.uid) retire(); });
    return () => { personal(); team(); account(); };
  }, [activation]);
  useEffect(() => {
    const client = activation.client;
    if (!activation.enabled || !activation.scope.uid) { client.dispose(); return; }
    const controller = new AbortController(); let active = true, running = false, requested = false, runningSource: readonly MemoryObject[] | null = null;
    let readySpec: Spec | null = null, failedSpec: Spec | null = null;
    let inspectedSource: readonly MemoryObject[] | null = null, retiredFence: readonly MemoryObject[] | null = null;
    const guard = () => { const value = current.current; if (!active || !value.enabled || value.scope !== activation.scope || auth.currentUser?.uid !== activation.scope.uid || !isMemoryCryptoReady()) throw new Error('orbit_layout_unavailable'); };
    const same = (a: Spec | null, b: Spec) => Boolean(a && a.source === b.source && a.ids === b.ids && a.scope === b.scope && a.attempt === b.attempt);
    const frame = () => { const value = promoted.current, latest = current.current; if (!active || !value || value.client !== client || !same(value.spec, latest) || !memorySnapshotScopeActive(latest.source)) return; try { guard(); return value.value; } catch { client.dispose(); promoted.current = null; return; } };
    positionsRef.current = { active: () => Boolean(frame()), get: id => frame()?.positions.get(id) };
    const drain = () => {
      if (!memorySnapshotScopeActive(current.current.source)) { if (retiredFence !== current.current.source) { retiredFence = current.current.source; client.dispose(); promoted.current = null; } return; }
      if (same(failedSpec, current.current)) return; requested = true;
      if (running) {
        if (runningSource && runningSource !== current.current.source && inspectedSource !== current.current.source) {
          inspectedSource = current.current.source;
          const delta = memorySnapshotScopeActive(runningSource) && memorySnapshotScopeActive(current.current.source) ? memorySnapshotDelta(runningSource, current.current.source) : undefined;
          if (!delta || delta.removed.length || delta.changed.some(row => row.deletedAt || !canReadCachedMemory(row, activation.scope))) client.dispose();
        }
        return;
      }
      running = true;
      void (async () => {
        while (active && requested) {
          requested = false; const captured = current.current; if (retired === captured.source || !memorySnapshotScopeActive(captured.source)) break; runningSource = inspectedSource = captured.source;
          try {
            const initial = !same(readySpec, captured), requestedClock = clock.current;
            const value = await client.select(captured.source, captured.ids, initial ? 0 : requestedClock.time, requestedClock.now || Date.now(), controller.signal, guard);
            if (!active) break; if (!same(captured, current.current)) { requested = true; continue; }
            failedSpec = null; promoted.current = { client, spec: captured, value };
            if (initial) { readySpec = captured; setResult({ client, spec: captured, zero: value, error: false }); }
          } catch {
            if (!active) break; if (!same(captured, current.current)) { requested = true; continue; }
            failedSpec = captured; readySpec = null; requested = false; promoted.current = null; setResult({ client, spec: captured, zero: null, error: true }); break;
          }
        }
      })().finally(() => { running = false; runningSource = null; if (active && requested) drain(); });
    };
    scheduler.current = drain;
    return () => { active = false; requested = false; if (scheduler.current === drain) scheduler.current = null; positionsRef.current = emptyPositions; promoted.current = null; controller.abort(); client.dispose(); };
  }, [activation, retired, attempt]);
  useEffect(() => { scheduler.current?.(); }, [source, ids, activation, retired, attempt]);
  const live = enabled && Boolean(scope.uid) && retired !== source && memorySnapshotScopeActive(source);
  const visible = live && result?.client === activation.client && result.spec.source === source && result.spec.ids === ids && result.spec.attempt === attempt;
  return { positionsRef, requestFrame, zeroTime: visible ? result.zero?.positions ?? emptyMap : emptyMap,
    ready: !enabled || Boolean(visible && !result.error), loading: enabled && live && !visible, error: enabled && (!live || Boolean(visible && result.error)), retry };
}
