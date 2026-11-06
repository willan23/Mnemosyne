import { useEffect, useRef, useCallback, useState } from 'react';
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  Timestamp,
  where,
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import toast from 'react-hot-toast';
import { db, auth } from '../firebase';
import { useUniverseStore } from '../store/universeStore';
import type { MemoryObject,MemorySaveSubmission } from '../types/universe';
import type { Attachment } from '../types/attachments';
import { parseEmbedding } from '../utils/parseEmbedding';
import {
  MemoryCryptoLockedError,
  isLegacyNestedMemoryCandidate,
  onMemoryCryptoChanged,
} from '../services/memoryCrypto';
import {
  parseSessionTeamId,
  resolveSessionSecretFields,
} from '../services/sessionMemoryFields';
import { unlockMembershipTeamKeys, unlockTeamKey } from '../services/teamKeyAccess';
import { watchMyTeams, type TeamRecord } from '../services/teamsService';
import { clearTeamKeyCache, getCachedTeamKey, notifyTeamKeysUpdated, onTeamKeyChanged } from '../services/teamVault';
import { readSessionMnemonic } from '../utils/sessionMnemonic';
import {applyMemoryEdit,captureMemoryEditBaseline,memoryEditStateDigest,MemoryEditError} from '../services/memoryEditRecovery';
import {withPersonalMemoryMutation} from '../services/personalMemoryMutation';
import {createPersonalMemory} from '../services/attachedMemoryRecovery';
import {cognitiveEngine} from '../engines/CognitiveEngine';
import { IncrementalSessionSnapshot, type SessionSnapshotLease } from '../services/incrementalSessionSnapshot';
import { IncrementalMemoryPublication } from '../services/incrementalMemoryPublication';
import {
  parseLaneTag,
  parseProjectStatusTag,
  type ProjectStatus,
  type TaxonomyLane,
} from '../utils/taxonomy';

const CELESTIAL_TYPES = new Set<MemoryObject['celestialType']>([
  'star',
  'sun',
  'planet',
  'moon',
  'comet',
  'black_hole',
  'nebula',
]);

function toMillis(value: unknown, fallback = Date.now()): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Timestamp) return value.toMillis();
  if (
    value &&
    typeof value === 'object' &&
    'toMillis' in value &&
    typeof (value as { toMillis: () => number }).toMillis === 'function'
  ) {
    return (value as { toMillis: () => number }).toMillis();
  }
  return fallback;
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function deterministicPosition(id: string, timestamp: number): [number, number, number] {
  const hash = hashString(`${id}:${timestamp}`);
  const angle = ((hash % 3600) / 3600) * Math.PI * 2;
  const elevation = (((hash >>> 8) % 1000) / 1000 - 0.5) * 14;
  const radius = 8 + ((hash >>> 16) % 1800) / 100;
  return [
    Number((Math.cos(angle) * radius).toFixed(3)),
    Number(elevation.toFixed(3)),
    Number((Math.sin(angle) * radius).toFixed(3)),
  ];
}

function parsePosition(value: unknown, id: string, timestamp: number): [number, number, number] {
  if (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((item) => typeof item === 'number' && Number.isFinite(item))
  ) {
    return value as [number, number, number];
  }
  return deterministicPosition(id, timestamp);
}

function parseTaxonomyLane(data: Record<string, unknown>, tags: string[]): TaxonomyLane | null {
  const raw = data.taxonomyLane;
  if (typeof raw === 'string' && ['A', 'B', 'C', 'D', 'E'].includes(raw.toUpperCase())) {
    return raw.toUpperCase() as TaxonomyLane;
  }
  return parseLaneTag(tags);
}

function parseProjectStatus(data: Record<string, unknown>, tags: string[]): ProjectStatus | null {
  const raw = data.projectStatus;
  if (typeof raw === 'string' && ['planned', 'active', 'done'].includes(raw)) {
    return raw as ProjectStatus;
  }
  return parseProjectStatusTag(tags);
}

function parseCelestialType(value: unknown): MemoryObject['celestialType'] {
  return typeof value === 'string' && CELESTIAL_TYPES.has(value as MemoryObject['celestialType'])
    ? value as MemoryObject['celestialType']
    : 'planet';
}

function parseAttachments(value: unknown): Attachment[] {
  if (!Array.isArray(value)) return [];
  return value.filter((attachment): attachment is Attachment => (
    attachment &&
    typeof attachment === 'object' &&
    typeof attachment.url === 'string' &&
    typeof attachment.name === 'string' &&
    ['image', 'audio', 'document', 'video'].includes(String(attachment.type))
  ));
}

async function fromFirestore(data: Record<string, unknown>, id: string, fallbackUid: string): Promise<MemoryObject> {
  const timestamp = toMillis(data.timestamp ?? data.createdAt);
  const updatedAt = toMillis(data.updatedAt, timestamp);
  const secret = await resolveSessionSecretFields(data);
  const text = secret.text;
  const title = secret.title || (text && !secret.locked ? text.slice(0, 80) : undefined);

  return {
    id,
    text,
    title,
    teamId: parseSessionTeamId(data) ?? undefined,
    teamScopeAmbiguous: data.teamId != null && !parseSessionTeamId(data),
    encLocked: secret.locked || undefined,
    celestialType: parseCelestialType(data.celestialType),
    position: parsePosition(data.position, id, timestamp),
    embedding: parseEmbedding(data.embedding),
    embeddingModel: typeof data.embeddingModel === 'string' ? data.embeddingModel : undefined,
    connections: toStringArray(data.connections),
    semanticClusterId: typeof data.semanticClusterId === 'string' ? data.semanticClusterId : undefined,
    importance: typeof data.importance === 'number' ? data.importance : 0.5,
    timestamp,
    updatedAt,
    persistedUpdatedAt: updatedAt,
    persistedStateDigest: await memoryEditStateDigest(data),
    persistedTitle: secret.title??null,
    uid: typeof data.uid === 'string' ? data.uid : fallbackUid,
    sharedWithIds: data.sharedWithIds,
    tags: toStringArray(data.tags),
    category: typeof data.category === 'string' ? data.category : undefined,
    attachments: parseAttachments(data.attachments),
    generatedImagePrompt: typeof data.generatedImagePrompt === 'string' ? data.generatedImagePrompt : undefined,
    generatedImageProvider: typeof data.generatedImageProvider === 'string' ? data.generatedImageProvider : undefined,
    generatedImageModel: typeof data.generatedImageModel === 'string' ? data.generatedImageModel : undefined,
    color: typeof data.color === 'string' ? data.color : undefined,
    scale: typeof data.scale === 'number' ? data.scale : undefined,
    orbitRadius: typeof data.orbitRadius === 'number' ? data.orbitRadius : undefined,
    orbitSpeed: typeof data.orbitSpeed === 'number' ? data.orbitSpeed : undefined,
    parentId: typeof data.parentId === 'string' ? data.parentId : undefined,
    entities: data.entities as MemoryObject['entities'] ?? undefined,
    taxonomyLane: parseTaxonomyLane(data, toStringArray(data.tags)),
    projectStatus: parseProjectStatus(data, toStringArray(data.tags)),
  };
}

interface UniverseSnapshotValue {
  memory: MemoryObject | null;
  tombstone: boolean;
  legacyPlaintext: boolean;
}
type UniverseSnapshotLease = Pick<SessionSnapshotLease<UniverseSnapshotValue>, 'changed' | 'removed' | 'order'>;
/** The common publisher can consume this projection without reading the snapshot again. */
function universeBucketPatch(lease: UniverseSnapshotLease) {
  return {
    changed: lease.changed.map(({ id, value }) => ({ id, value: value.memory })),
    removed: lease.removed,
    order: lease.order,
  };
}
function applyUniverseBucketLease(bucket: Map<string, MemoryObject>, order: string[], lease: UniverseSnapshotLease) {
  const patch = universeBucketPatch(lease);
  if (patch.order.reset) bucket.clear();
  for (const id of patch.removed) bucket.delete(id);
  for (const { id, value } of patch.changed) {
    if (value) bucket.set(id, value); else bucket.delete(id);
  }
  const nextOrder = patch.order.reset ? [...patch.order.reset] : order;
  for (const change of patch.order.changes) {
    if (change.type === 'modified' && change.oldIndex === change.newIndex) continue;
    if (change.type !== 'added') nextOrder.splice(change.oldIndex, 1);
    if (change.type !== 'removed') nextOrder.splice(change.newIndex, 0, change.id);
  }
  return nextOrder;
}
function* orderedUniverseBucket(bucket: Map<string, MemoryObject>, order: string[]) {
  for (const id of order) {
    const memory = bucket.get(id);
    if (memory) yield memory;
  }
}

export function useUniverseMemories(accountReady = true) {
  const { loadMemories, setIsLoading } = useUniverseStore();
  const [legacyPlaintextCount, setLegacyPlaintextCount] = useState(0);
  const uidRef = useRef<string | null>(null);
  const subscriptionEpochRef = useRef(0);
  const unsubscribeRefs = useRef<Array<() => void>>([]);
  const sessionMemoriesRef = useRef<Map<string, MemoryObject>>(new Map());
  const sessionOrderRef = useRef<string[]>([]);
  const personalTombstonesRef=useRef(new Set<string>());
  const tombstoneOwnerRef=useRef<string|null>(null);
  const legacyMemoriesRef = useRef<Map<string, MemoryObject>>(new Map());
  const legacyOrderRef = useRef<string[]>([]);
  const teamMemoriesRef = useRef<Map<string, Map<string, MemoryObject>>>(new Map());
  const teamOrdersRef = useRef(new Map<string, string[]>());
  const teamRecordsRef = useRef<Map<string, TeamRecord>>(new Map());
  const teamQueryUnsubsRef = useRef<Array<() => void>>([]);
  const publicationRef = useRef<IncrementalMemoryPublication<MemoryObject> | null>(null);
  const semanticRevisionRef = useRef(0);

  const subscribeToMemories = useCallback((uid: string) => {
    if(tombstoneOwnerRef.current!==uid){personalTombstonesRef.current.clear();tombstoneOwnerRef.current=uid;}
    publicationRef.current?.clear();
    unsubscribeRefs.current.forEach((unsubscribe) => unsubscribe());
    const epoch = ++subscriptionEpochRef.current;
    const publication = new IncrementalMemoryPublication<MemoryObject>('asc', { sourceBase: 2 });
    publicationRef.current = publication;
    const listenerCaches = new Set<IncrementalSessionSnapshot<UniverseSnapshotValue>>();
    const createCache = () => {
      const cache = new IncrementalSessionSnapshot<UniverseSnapshotValue>();
      listenerCaches.add(cache);
      return cache;
    };
    const retireCache = (cache: IncrementalSessionSnapshot<UniverseSnapshotValue>) => {
      if (listenerCaches.delete(cache)) cache.reset();
    };
    const retireCaches = () => { for (const cache of listenerCaches) cache.reset(); listenerCaches.clear(); };
    const isCurrent = () => publicationRef.current === publication && subscriptionEpochRef.current === epoch && uidRef.current === uid;
    const publishMemories = () => {
      semanticRevisionRef.current++;
      void publication.publish(isCurrent, loadMemories).catch(() => {
        if (isCurrent()) { publication.clear(); loadMemories([]); setIsLoading(false); }
      });
    };
    // Rekey/account changes retire the old view synchronously, before a task can yield.
    loadMemories([]);
    for (const id of personalTombstonesRef.current) publication.exclude('legacy', id, true);
    unsubscribeRefs.current = [];
    teamQueryUnsubsRef.current.forEach((unsubscribe) => unsubscribe());
    teamQueryUnsubsRef.current = [];
    sessionMemoriesRef.current.clear();
    sessionOrderRef.current = [];
    legacyMemoriesRef.current.clear();
    legacyOrderRef.current = [];
    setLegacyPlaintextCount(0);
    teamMemoriesRef.current.clear();
    teamOrdersRef.current.clear();
    teamRecordsRef.current.clear();

    setIsLoading(true);
    const sessionsRef = collection(db, 'sessions');
    // Deploy only after uid + teamId + timestamp index and personal backfill.
    // We normalize chronological order locally when publishing merged memories.
    const sessionsQuery = query(sessionsRef, where('uid', '==', uid), where('teamId', '==', null), orderBy('timestamp', 'desc'));
    const legacyRef = collection(db, 'users', uid, 'memories');
    // Older nested records may have no timestamp. Server ordering would omit them.
    const legacyQuery = query(legacyRef);

    let sessionsRevision = 0;
    let sessionsCache = createCache();
    const clearSessions = () => {
      if (!isCurrent()) return;
      ++sessionsRevision;
      retireCache(sessionsCache); sessionsCache = createCache();
      sessionMemoriesRef.current.clear();
      sessionOrderRef.current = [];
      publication.removeSource('personal');
      loadMemories([]);
      publishMemories();
      setIsLoading(false);
    };
    const unsubSessions = onSnapshot(sessionsQuery, (snapshot) => {
      if (!isCurrent()) return;
      const revision = ++sessionsRevision;
      const cache = sessionsCache;
      void (async () => {
        const lease = await cache.prepare(snapshot, async docSnap => {
          const data = docSnap.data() as Record<string, unknown>;
          const tombstone = data.deletedAt != null;
          return { memory: data.deletedAt ? null : await fromFirestore(data, docSnap.id, uid), tombstone, legacyPlaintext: false };
        });
        if (!isCurrent() || revision !== sessionsRevision || !lease.isCurrent()) return;
        if (!lease.commit()) return;
        if (lease.order.reset) {
          for (const id of personalTombstonesRef.current) publication.exclude('legacy', id, false);
          personalTombstonesRef.current.clear();
        }
        for (const id of lease.removed) {
          personalTombstonesRef.current.delete(id);
          publication.exclude('legacy', id, false);
        }
        for (const { id, value } of lease.changed) {
          if (value.tombstone) personalTombstonesRef.current.add(id); else personalTombstonesRef.current.delete(id);
          publication.exclude('legacy', id, value.tombstone);
        }
        sessionOrderRef.current = applyUniverseBucketLease(sessionMemoriesRef.current, sessionOrderRef.current, lease);
        publication.apply('personal', universeBucketPatch(lease), 1);
        publishMemories();
        setIsLoading(false);
      })().catch(() => { if (revision === sessionsRevision) clearSessions(); });
    }, clearSessions);

    let legacyRevision = 0;
    let legacyCache = createCache();
    const legacyFlags = new Map<string, boolean>();
    let legacyCount = 0;
    const clearLegacy = () => {
      if (!isCurrent()) return;
      ++legacyRevision;
      retireCache(legacyCache); legacyCache = createCache();
      legacyMemoriesRef.current.clear();
      legacyOrderRef.current = [];
      legacyFlags.clear();
      legacyCount = 0;
      setLegacyPlaintextCount(0);
      publication.removeSource('legacy');
      loadMemories([]);
      publishMemories();
      setIsLoading(false);
    };
    const unsubLegacy = onSnapshot(legacyQuery, (snapshot) => {
      if (!isCurrent()) return;
      const revision = ++legacyRevision;
      const cache = legacyCache;
      void (async () => {
        const lease = await cache.prepare(snapshot, async docSnap => {
          const data = docSnap.data() as Record<string, unknown>;
          return { memory: await fromFirestore(data, docSnap.id, uid), tombstone: false,
            legacyPlaintext: isLegacyNestedMemoryCandidate(data, uid) };
        });
        if (!isCurrent() || revision !== legacyRevision || !lease.isCurrent()) return;
        if (!lease.commit()) return;
        if (lease.order.reset) { legacyFlags.clear(); legacyCount = 0; }
        for (const id of lease.removed) {
          legacyCount -= Number(legacyFlags.get(id) ?? false);
          legacyFlags.delete(id);
        }
        for (const { id, value } of lease.changed) {
          legacyCount += Number(value.legacyPlaintext) - Number(legacyFlags.get(id) ?? false);
          legacyFlags.set(id, value.legacyPlaintext);
        }
        setLegacyPlaintextCount(legacyCount);
        legacyOrderRef.current = applyUniverseBucketLease(legacyMemoriesRef.current, legacyOrderRef.current, lease);
        publication.apply('legacy', universeBucketPatch(lease), 0);
        publishMemories();
        setIsLoading(false);
      })().catch(() => { if (revision === legacyRevision) clearLegacy(); });
    }, clearLegacy);

    let teamsRevision = 0;
    const stopTeams = watchMyTeams(uid, (teams) => {
      if (!isCurrent()) return;
      const teamGeneration = ++teamsRevision;
      const nextIds = new Set(teams.map((team) => team.id));
      let removedTeamKey = false;
      for (const previousId of teamRecordsRef.current.keys()) {
        if (!nextIds.has(previousId)) {
          clearTeamKeyCache(previousId, false);
          removedTeamKey = true;
        }
      }
      teamRecordsRef.current = new Map(teams.map((team) => [team.id, team]));
      void unlockMembershipTeamKeys(uid, teams, readSessionMnemonic(),
        (teamId) => isCurrent() && teamGeneration === teamsRevision && teamRecordsRef.current.has(teamId));
      teamQueryUnsubsRef.current.forEach((unsubscribe) => unsubscribe());
      teamQueryUnsubsRef.current = [];
      Array.from(teamMemoriesRef.current.keys()).forEach((teamId) => {
        if (!nextIds.has(teamId)) {
          teamMemoriesRef.current.delete(teamId); teamOrdersRef.current.delete(teamId);
          publication.removeSource(`team:${teamId}`);
          // A large replacement view may yield; never retain revoked rows meanwhile.
          loadMemories([]);
        }
      });
      for (const team of teams) {
        const teamQuery = query(
          sessionsRef,
          where('teamId', '==', team.id),
          orderBy('timestamp', 'desc'),
        );
        let revision = 0;
        let cache = createCache();
        const epochUnlocks = new Map<number, Promise<void>>();
        const loadedEpochs = new Set<number>();
        const teamCurrent = () => isCurrent() && teamGeneration === teamsRevision && teamRecordsRef.current.has(team.id);
        const clearTeam = () => {
          if (!teamCurrent()) return;
          ++revision;
          retireCache(cache); cache = createCache();
          epochUnlocks.clear();
          loadedEpochs.clear();
          teamMemoriesRef.current.delete(team.id);
          teamOrdersRef.current.delete(team.id);
          publication.removeSource(`team:${team.id}`);
          loadMemories([]);
          publishMemories();
          setIsLoading(false);
        };
        const unsubTeam = onSnapshot(teamQuery, (snapshot) => {
          if (!teamCurrent()) return;
          const snapshotRevision = ++revision;
          const currentCache = cache;
          void (async () => {
            const lease = await currentCache.prepare(snapshot, async docSnap => {
              const data = docSnap.data() as Record<string, unknown>;
              if (data.deletedAt) return { memory: null, tombstone: false, legacyPlaintext: false };
              const epoch = Number.isSafeInteger(data.keyEpoch) && (data.keyEpoch as number) >= 1 ? data.keyEpoch as number : 1;
              const mnemonic = readSessionMnemonic();
              if (mnemonic && !getCachedTeamKey(team.id, epoch)) {
                let pending = epochUnlocks.get(epoch);
                if (!pending) {
                  pending = unlockTeamKey(team, uid, mnemonic, { epoch, notify: false, isCurrent: teamCurrent })
                    .then(() => { if (teamCurrent()) loadedEpochs.add(epoch); });
                  epochUnlocks.set(epoch, pending);
                  const captured = pending;
                  void pending.catch(() => { if (epochUnlocks.get(epoch) === captured) epochUnlocks.delete(epoch); });
                }
                try { await pending; } catch { /* A missing historical wrap leaves only that epoch locked. */ }
              }
              if (!teamCurrent()) throw new Error('Team snapshot changed');
              return { memory: await fromFirestore(data, docSnap.id, uid), tombstone: false, legacyPlaintext: false };
            });
            if (!teamCurrent() || snapshotRevision !== revision || !lease.isCurrent()) return;
            if (!lease.commit()) return;
            let bucket = teamMemoriesRef.current.get(team.id);
            if (!bucket) { bucket = new Map(); teamMemoriesRef.current.set(team.id, bucket); }
            teamOrdersRef.current.set(team.id, applyUniverseBucketLease(bucket, teamOrdersRef.current.get(team.id) ?? [], lease));
            publication.apply(`team:${team.id}`, universeBucketPatch(lease));
            publishMemories();
            setIsLoading(false);
            if (loadedEpochs.size) { loadedEpochs.clear(); notifyTeamKeysUpdated(); }
          })().catch(() => { if (snapshotRevision === revision) clearTeam(); });
        }, clearTeam);
        teamQueryUnsubsRef.current.push(() => {
          retireCache(cache); epochUnlocks.clear(); loadedEpochs.clear(); unsubTeam();
        });
      }
      publishMemories();
      if (removedTeamKey) notifyTeamKeysUpdated();
    });

    unsubscribeRefs.current = [
      () => {
        retireCaches();
        publication.clear();
        if (publicationRef.current === publication) { publicationRef.current = null; loadMemories([]); }
        if (subscriptionEpochRef.current === epoch) ++subscriptionEpochRef.current;
      },
      unsubSessions,
      unsubLegacy,
      stopTeams,
      () => {
        teamQueryUnsubsRef.current.forEach((unsubscribe) => unsubscribe());
        teamQueryUnsubsRef.current = [];
      },
    ];
    return () => {
      unsubSessions();
      retireCaches();
      publication.clear();
      if (publicationRef.current === publication) { publicationRef.current = null; loadMemories([]); }
      if (subscriptionEpochRef.current === epoch) ++subscriptionEpochRef.current;
      unsubLegacy();
      stopTeams();
      teamQueryUnsubsRef.current.forEach((unsubscribe) => unsubscribe());
      teamQueryUnsubsRef.current = [];
    };
  }, [loadMemories, setIsLoading]);

  useEffect(() => {
    if (!accountReady) {
      uidRef.current = null;
      publicationRef.current?.clear();
      loadMemories([]);
    }
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      if (user && accountReady) {
        uidRef.current = user.uid;
        subscribeToMemories(user.uid);
      } else {
        uidRef.current = null;
        publicationRef.current?.clear();
        publicationRef.current = null;
        unsubscribeRefs.current.forEach((unsubscribe) => unsubscribe());
        unsubscribeRefs.current = [];
        sessionMemoriesRef.current.clear();
        sessionOrderRef.current = [];
        legacyMemoriesRef.current.clear();
        legacyOrderRef.current = [];
        personalTombstonesRef.current.clear();tombstoneOwnerRef.current=null;
        setLegacyPlaintextCount(0);
        teamMemoriesRef.current.clear();
        teamOrdersRef.current.clear();
        teamRecordsRef.current.clear();
        loadMemories([]);
      }
    });

    const refreshDecrypt = () => {
      if (uidRef.current) subscribeToMemories(uidRef.current);
    };
    const unsubCrypto = onMemoryCryptoChanged(refreshDecrypt);
    const unsubTeamKeys = onTeamKeyChanged(refreshDecrypt);

    return () => {
      unsubAuth();
      unsubCrypto();
      unsubTeamKeys();
      unsubscribeRefs.current.forEach((unsubscribe) => unsubscribe());
      unsubscribeRefs.current = [];
    };
  }, [subscribeToMemories, loadMemories, accountReady]);

  const saveMemory = useCallback(async (memory: MemoryObject,submission?:MemorySaveSubmission):Promise<{id:string}> => {
    const uid = uidRef.current;
    if (!uid) throw new Error('Conta indisponível para guardar a memória.');
    const captured=structuredClone(memory),epoch=subscriptionEpochRef.current;
    try {
      if(!submission||captured.encLocked||captured.teamScopeAmbiguous)throw new MemoryEditError('baseline');
      return await withPersonalMemoryMutation(uid,async context=>{
        const guard=()=>{context.assertCurrent();submission.assertCurrent();if(uidRef.current!==uid||subscriptionEpochRef.current!==epoch)throw new MemoryEditError('baseline');};guard();
        if(submission.kind==='create'){
          if(captured.teamId||captured.uid!==uid||captured.persistedStateDigest||captured.connections.length||captured.attachments?.length)throw new MemoryEditError('baseline');
          const created=await createPersonalMemory({uid,text:captured.text,title:captured.title??null,metadata:{tags:captured.tags??[],category:captured.category??'Universe',embedding:captured.embedding.length?captured.embedding:null,embeddingModel:captured.embedding.length?captured.embeddingModel??null:null,semanticClusterId:captured.semanticClusterId??null,position:captured.position,importance:captured.importance,celestialType:captured.celestialType,connections:[],processingMethod:'universe+local-embedding'}},undefined,guard);guard();return{id:created.id};
        }
        if(submission.baseline.sessionId!==captured.id||submission.baseline.teamId!==(captured.teamId??null)||submission.baseline.stateDigest!==captured.persistedStateDigest||submission.baseline.authorUid!==captured.uid)throw new MemoryEditError('baseline');
        let semanticPending=false;const metadata=structuredClone(submission.metadata);
        await applyMemoryEdit({uid,id:captured.id,teamId:captured.teamId??null,operation:'edit',baseline:submission.baseline,assertCurrent:guard,prepare:async current=>{guard();current();let changes:Record<string,unknown>={...metadata};
          if(submission.refreshSemantic){
            const revision=semanticRevisionRef.current;
            const semanticGuard=()=>{guard();current();if(revision!==semanticRevisionRef.current)throw new MemoryEditError('baseline');};
            function* candidates(){
              yield* orderedUniverseBucket(sessionMemoriesRef.current,sessionOrderRef.current);
              for(const[teamId,bucket]of teamMemoriesRef.current)yield* orderedUniverseBucket(bucket,teamOrdersRef.current.get(teamId)??[]);
            }
            try{const result=await cognitiveEngine.processMemory(captured.text,candidates(),{assertCurrent:semanticGuard,eligible:row=>row.id!==captured.id&&!row.deletedAt&&!row.encLocked&&!row.teamScopeAmbiguous&&(captured.teamId?row.teamId===captured.teamId:!row.teamId&&row.uid===uid&&(row.sharedWithIds==null||Array.isArray(row.sharedWithIds)&&row.sharedWithIds.length===0))});semanticGuard();changes={embedding:result.embedding,embeddingModel:result.embeddingModel,semanticClusterId:result.semanticClusterId,position:result.position,importance:result.importance,celestialType:result.celestialType,entities:null,processingMethod:'universe:manual-edit+local-embedding',...metadata};}
            catch{semanticGuard();semanticPending=true;changes={embedding:null,embeddingModel:null,semanticClusterId:null,entities:null,processingMethod:'universe:manual-edit:semantic-pending',...metadata};}
          }
          return{text:captured.text,title:submission.title,metadata:changes};}});guard();if(semanticPending)toast('Memória guardada. A análise semântica local ficou pendente neste dispositivo.');return{id:captured.id};
      });
    } catch (err) {
      if (err instanceof MemoryCryptoLockedError&&uidRef.current===uid&&subscriptionEpochRef.current===epoch) {
        toast.error(err.message);
      }
      if (captured.teamId) {
        if(uidRef.current===uid&&subscriptionEpochRef.current===epoch)toast.error('Não foi possível confirmar a memória de equipa. O pedido e o rascunho foram conservados.');
        throw new Error('Não foi possível guardar a memória de equipa.');
      }
      if (!(err instanceof MemoryCryptoLockedError)&&uidRef.current===uid&&subscriptionEpochRef.current===epoch) toast.error('Não foi possível confirmar a memória. O pedido e o rascunho foram conservados.');
      throw new Error('Não foi possível guardar a memória.');
    }
  }, []);

  const deleteMemory = useCallback(async (id: string,source?:MemoryObject,assertCurrent:()=>void=()=>{}) => {
    const uid = uidRef.current;
    if (!uid) throw new Error('Conta indisponível para apagar a memória.');
    const epoch=subscriptionEpochRef.current;
    try {
      const memory=source?structuredClone(source):null;
      if(!memory||memory.id!==id||memory.teamScopeAmbiguous||memory.encLocked||!memory.persistedStateDigest||memory.persistedTitle===undefined)throw new MemoryEditError('baseline');
      await withPersonalMemoryMutation(uid,async context=>{const guard=()=>{context.assertCurrent();assertCurrent();if(uidRef.current!==uid||subscriptionEpochRef.current!==epoch)throw new MemoryEditError('baseline');};guard();
        const baseline=await captureMemoryEditBaseline({uid,id,teamId:memory.teamId??null,viewDigest:memory.persistedStateDigest!,expected:{text:memory.text,title:memory.persistedTitle!,authorUid:memory.uid},assertCurrent:guard});guard();await applyMemoryEdit({uid,id,teamId:memory.teamId??null,operation:'delete',baseline,assertCurrent:guard});guard();});
    } catch {
      if(uidRef.current===uid&&subscriptionEpochRef.current===epoch)toast.error('Não foi possível confirmar o apagamento. O pedido foi conservado para recuperação.');
      throw new Error('Não foi possível apagar a memória.');
    }
  }, []);

  return { saveMemory, deleteMemory, legacyPlaintextCount };
}
