import { useState, useEffect, useMemo, useRef } from 'react';
import { collection, query, where, orderBy, onSnapshot, type Query } from 'firebase/firestore';
import { db } from '../firebase';
import type { User } from 'firebase/auth';
import { IncrementalSearchClient } from '../services/incrementalSearchClient';
import { HybridSearchClient } from '../services/hybridSearchClient';
import { HybridSearchCorpus, type HybridCorpusSnapshot } from '../services/hybridSearchCorpus';
import type { HybridSearchHit } from '../services/hybridSearchProtocol';
import { appendLocalMemoryActivity, type LocalMemoryActivity } from '../services/localMemoryActivity';
import { IncrementalSessionSnapshot } from '../services/incrementalSessionSnapshot';
import { IncrementalMemoryPublication, type MemoryPublicationDelta } from '../services/incrementalMemoryPublication';
import { onEmbeddingSelectionChanged, readEmbeddingSelection } from '../services/embeddingSelection';
import { searchSelectedEmbeddingProfile } from '../services/selectedEmbeddingSearch';
import { PreparedEmbeddingSearchCache } from '../services/preparedEmbeddingSearchCache';
import type { Attachment } from '../types/attachments';
import { parseSearchQuery, type MemorySearchHit } from '../utils/searchMemories';
import { parseEmbedding } from '../utils/parseEmbedding';
import { isMemoryCryptoReady, onMemoryCryptoChanged } from '../services/memoryCrypto';
import { canReadCachedMemory } from '../services/memoryReadScope';
import { parseSessionTeamId, resolveSessionSecretFields } from '../services/sessionMemoryFields';
import { onTeamKeyChanged } from '../services/teamVault';
import {semanticClusterGraphHash} from '../services/semanticClusterRecovery';
import {semanticRelationViewHash} from '../services/semanticRelationRecovery';
import {syncConflictViewDigest} from '../services/syncConflictResolution';
import { useMyTeams, useTeamIds, useUnlockTeamKeys } from './useMyTeams';

const NO_SEARCH_HITS: MemorySearchHit[] = [];

export interface FilterOptions {
    dateRange: string;
    tags: string[];
    category?: string;
}

/** Current authorized query result, including an authoritative empty result. */
export interface SessionSearchResults {
    uid: string;
    query: string;
    hits: MemorySearchHit[];
    loading: boolean;
    error?: 'unavailable';
}

// Definindo tipos para evitar 'any'
export interface SessionData {
    id: string;
    text: string;
    timestamp: number;
    updatedAt: number;
    uid: string;
    /** Campo não confiável do Firestore; partilhas são excluídas do cálculo pessoal. */
    sharedWithIds?: unknown;
    tags?: string[];
    category?: string;
    lastViewedAt?: number;
    nodes?: Array<{ id: string; label: string; type: string }>;
    links?: Array<{ source: string; target: string }>;
    embedding?: number[];
    embeddingModel?: string;
    connections?: string[];
    semanticClusterId?: string;
    semanticGraphHash?: string;
    semanticRelationHash?: string;
    syncConflictDigest?: string;
    position?: [number, number, number];
    importance?: number;
    celestialType?: string;
    title?: string;
    attachments?: Attachment[];
    generatedImagePrompt?: string;
    generatedImageProvider?: string;
    generatedImageModel?: string;
    semanticScore?: number;
    deletedAt?: number;
    deletedByDeviceId?: string;
    originalMemoryId?: string;
    conflictReason?: string;
    parentId?: string;
    processingMethod?: string | null;
    /** Memória de equipa E2EE — decifrada com teamKey, não com a mnemónica pessoal. */
    teamId?: string;
    /** `teamId` presente mas inválido; não usar em cálculos pessoais. */
    teamScopeAmbiguous?: boolean;
    /** true quando o documento está cifrado em repouso (envelope enc). */
    encrypted?: boolean;
    /** true quando está cifrado mas a chave atual não consegue decifrar. */
    encLocked?: boolean;
}

async function mapSessionDoc(docSnap: { id: string; data: () => Record<string, unknown> }): Promise<SessionData> {
    const data = docSnap.data() as Record<string, unknown>;
    const secret = await resolveSessionSecretFields(data);
    const rawPosition = data.position;
    let semanticGraphHash: string | undefined;
    try {semanticGraphHash=await semanticClusterGraphHash(docSnap.id,data);}catch{semanticGraphHash=undefined;}
    let semanticRelationHash: string | undefined;
    try {semanticRelationHash=await semanticRelationViewHash(docSnap.id,data);}catch{semanticRelationHash=undefined;}
    let syncConflictDigest:string|undefined;
    try {syncConflictDigest=await syncConflictViewDigest(data);}catch{syncConflictDigest=undefined;}
    return {
        id: docSnap.id,
        semanticGraphHash,
        semanticRelationHash,
        syncConflictDigest,
        text: secret.text,
        title: secret.title ?? undefined,
        encrypted: secret.encrypted,
        encLocked: secret.locked,
        teamId: parseSessionTeamId(data) ?? undefined,
        teamScopeAmbiguous: data.teamId != null && !parseSessionTeamId(data),
        attachments: Array.isArray(data.attachments) ? data.attachments : [],
        generatedImagePrompt: data.generatedImagePrompt as SessionData['generatedImagePrompt'],
        generatedImageProvider: data.generatedImageProvider as SessionData['generatedImageProvider'],
        generatedImageModel: data.generatedImageModel as SessionData['generatedImageModel'],
        timestamp: (data.timestamp as number) || 0,
        updatedAt: (data.updatedAt as number) || (data.timestamp as number) || 0,
        uid: data.uid as string,
        sharedWithIds: data.sharedWithIds,
        tags: data.tags as string[] | undefined,
        category: data.category as string | undefined,
        lastViewedAt: data.lastViewedAt as number | undefined,
        nodes: data.nodes as SessionData['nodes'],
        links: data.links as SessionData['links'],
        embedding: parseEmbedding(data.embedding),
        embeddingModel: typeof data.embeddingModel === 'string' ? data.embeddingModel : undefined,
        connections: Array.isArray(data.connections) ? data.connections as string[] : [],
        semanticClusterId: typeof data.semanticClusterId === 'string' ? data.semanticClusterId : undefined,
        position: Array.isArray(rawPosition) && rawPosition.length === 3 ? rawPosition as [number, number, number] : undefined,
        importance: data.importance as number | undefined,
        celestialType: data.celestialType as string | undefined,
        parentId: data.parentId as string | undefined,
        deletedAt: data.deletedAt as number | undefined,
        deletedByDeviceId: data.deletedByDeviceId as string | undefined,
        originalMemoryId: data.originalMemoryId as string | undefined,
        conflictReason: data.conflictReason as string | undefined,
        processingMethod: data.processingMethod as string | null | undefined,
    };
}

export const useSessions = (user: User | null, searchQuery: string, filters: FilterOptions) => {
    const [allSessions, setAllSessions] = useState<SessionData[]>([]);
    const activeCorpus = useRef<HybridSearchCorpus | null>(null);
    const activePublication = useRef<IncrementalMemoryPublication<SessionData> | null>(null);
    const [searchCorpus, setSearchCorpus] = useState<{
        uid: string; cryptoEpoch: number; teamIds: string[]; snapshot: HybridCorpusSnapshot | 'unavailable';
    } | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [rankedResult, setRankedResult] = useState<{
        uid: string; query: string; source: SessionData[]; filters: FilterOptions; hits: MemorySearchHit[];
        candidateIds: string[]; loading: boolean; error?: 'unavailable'; selectionEpoch: number;
    } | null>(null);
    // Incrementa quando a chave pessoal ou uma teamKey muda (unlock/lock) para re-decifrar.
    const [cryptoEpoch, setCryptoEpoch] = useState(0);
    const [searchIndex] = useState(() => new IncrementalSearchClient());
    const [hybridIndex] = useState(() => new HybridSearchClient());
    const [preparedSearchCache] = useState(() => new PreparedEmbeddingSearchCache());
    const [selectionEpoch, setSelectionEpoch] = useState(0);
    const selectedProfile = user ? readEmbeddingSelection(user.uid) : null;
    useEffect(() => {
        if (!user) return;
        return onEmbeddingSelectionChanged(user.uid, () => {
            searchIndex.dispose();
            hybridIndex.dispose();
            preparedSearchCache.dispose();
            setRankedResult(null);
            setSelectionEpoch(value => value + 1);
        });
    }, [user, searchIndex, hybridIndex, preparedSearchCache]);
    const [loadedScope, setLoadedScope] = useState<{ uid: string; cryptoEpoch: number; teamIds: string[] | null }>({ uid: '', cryptoEpoch: -1, teamIds: null });
    const teams = useMyTeams(user?.uid ?? null);
    const teamIds = useTeamIds(teams);
    useEffect(() => () => { searchIndex.dispose(); hybridIndex.dispose(); preparedSearchCache.dispose(); setRankedResult(null); }, [searchIndex, hybridIndex, preparedSearchCache, user?.uid, cryptoEpoch, teamIds]);
    useUnlockTeamKeys(user?.uid ?? null, teams);
    const authorizedAllSessions = useMemo(() => {
        if (!user || !isMemoryCryptoReady() || loadedScope.uid !== user.uid ||
            loadedScope.cryptoEpoch !== cryptoEpoch) return [];
        // Publications already passed this captured ACL. Only a membership change
        // before its replacement publication needs to filter the prior array.
        if (loadedScope.teamIds === teamIds) return allSessions;
        const scope = { uid: user.uid, teamIds: new Set(teamIds) };
        return allSessions.filter((session) => canReadCachedMemory(session, scope));
    }, [user, loadedScope, cryptoEpoch, teamIds, allSessions]);
    const sessions = useMemo(() => authorizedAllSessions.filter((session) => !session.deletedAt),
        [authorizedAllSessions]);
    const currentCorpus = searchCorpus?.uid === user?.uid && searchCorpus?.cryptoEpoch === cryptoEpoch &&
        searchCorpus?.teamIds === teamIds ? searchCorpus.snapshot : null;
    const resultCurrent = rankedResult?.uid === user?.uid && rankedResult?.query === searchQuery.trim() &&
        rankedResult?.source === sessions && rankedResult?.filters === filters && rankedResult?.selectionEpoch === selectionEpoch;
    const needsSearch = Boolean(searchQuery.trim() || filters.dateRange !== 'all' || filters.tags.length || filters.category);

    useEffect(() => {
        const invalidate = () => { activeCorpus.current?.clear(); activePublication.current?.clear(); searchIndex.dispose(); hybridIndex.dispose(); preparedSearchCache.dispose(); setRankedResult(null); setCryptoEpoch((epoch) => epoch + 1); };
        const stopMemory = onMemoryCryptoChanged(invalidate);
        const stopTeam = onTeamKeyChanged(invalidate);
        return () => {
            stopMemory();
            stopTeam();
        };
    }, [searchIndex, hybridIndex, preparedSearchCache]);

    // Firestore: memórias pessoais (uid) + memórias das equipas de que o user é membro.
    useEffect(() => {
        if (!user) {
            setAllSessions([]);
            setSearchCorpus(null);
            setIsLoading(false);
            return;
        }

        const publication = new IncrementalMemoryPublication<SessionData>('desc');
        activePublication.current = publication;
        const corpus = new HybridSearchCorpus();
        activeCorpus.current = corpus;
        let corpusUnavailable = false;
        const readScope = { uid: user.uid, teamIds: new Set(teamIds) };
        let active = true;
        let publicationRevision = 0;

        const publish = (delta: MemoryPublicationDelta<SessionData>) => {
            if (!active) return;
            let snapshot: HybridCorpusSnapshot | 'unavailable' = 'unavailable';
            if (!corpusUnavailable) {
                try { corpus.update(delta.changed, delta.removed); snapshot = corpus.capture(); }
                catch { corpusUnavailable = true; }
            }
            const revision = ++publicationRevision;
            void publication.publish(() => active && revision === publicationRevision, nextAllSessions => {
                setSearchCorpus({ uid: user.uid, cryptoEpoch, teamIds, snapshot });
                setAllSessions(nextAllSessions);
                setLoadedScope({ uid: user.uid, cryptoEpoch, teamIds });
                setIsLoading(false);
            }).catch(() => {
                if (!active || revision !== publicationRevision) return;
                publication.clear(); corpus.clear(); corpusUnavailable = true;
                setAllSessions([]); setSearchCorpus({ uid: user.uid, cryptoEpoch, teamIds, snapshot: 'unavailable' });
                setIsLoading(false);
                console.warn('Session publication unavailable.');
            });
        };

        const listen = (bucketKey: string, firestoreQuery: Query) => {
            let revision = 0;
            const cache = new IncrementalSessionSnapshot<SessionData | null>();
            const clear = () => {
                if (!active) return;
                ++revision; cache.reset();
                // Permission errors must retire the visible view before a large
                // replacement array yields to the next task.
                setAllSessions([]); setSearchCorpus(null); setRankedResult(null);
                publish(publication.removeSource(bucketKey));
            };
            const unsubscribe = onSnapshot(firestoreQuery, (snapshot) => {
                if (!active) return;
                const currentRevision = ++revision;
                void (async () => {
                    const lease = await cache.prepare(snapshot, async docSnap => {
                        const data = docSnap.data() as Record<string, unknown>, teamId = parseSessionTeamId(data);
                        if (!canReadCachedMemory({ uid: data.uid as string, teamId: teamId ?? undefined,
                            teamScopeAmbiguous: data.teamId != null && !teamId, sharedWithIds: data.sharedWithIds }, readScope)) return null;
                        return mapSessionDoc({ id: docSnap.id, data: () => data });
                    });
                    if (!active || currentRevision !== revision || !lease.isCurrent() || !lease.commit()) return;
                    publish(publication.apply(bucketKey, { ...lease,
                        changed: lease.changed.map(({ id, value }) => ({ id, value: value && canReadCachedMemory(value, readScope) ? value : null })) }));
                })().catch(() => {
                    if (!active || currentRevision !== revision) return;
                    clear();
                    console.warn('Session snapshot unavailable.');
                });
            }, () => {
                if (!active) return;
                clear();
                console.warn('Session subscription unavailable.');
            });
            return () => { ++revision; cache.reset(); unsubscribe(); };
        };

        const sessionsRef = collection(db, 'sessions');
        const unsubs = [
            listen(
                'personal',
                query(sessionsRef, where('uid', '==', user.uid), where('teamId', '==', null), orderBy('timestamp', 'desc')),
            ),
            ...teamIds.map((teamId) => listen(
                `team:${teamId}`,
                query(sessionsRef, where('teamId', '==', teamId), orderBy('timestamp', 'desc')),
            )),
        ];

        return () => {
            active = false;
            corpus.clear();
            publication.clear();
            if (activePublication.current === publication) activePublication.current = null;
            if (activeCorpus.current === corpus) activeCorpus.current = null;
            unsubs.forEach((unsubscribe) => unsubscribe());
        };
    }, [user, cryptoEpoch, teamIds]);

    useEffect(() => {
        let cancelled = false;
        const controller = new AbortController();
        const runSearch = async () => {
            if (!needsSearch || !user || !isMemoryCryptoReady() || !currentCorpus) {
                hybridIndex.dispose(); searchIndex.dispose(); preparedSearchCache.dispose(); setRankedResult(null); return;
            }
            const byId = new Map(sessions.map(session => [session.id, session]));
            const publish = (rows: HybridSearchHit[], candidateIds: string[], loading: boolean, error?: 'unavailable') => {
                if (cancelled) return;
                const hits: MemorySearchHit[] = rows.flatMap(row => {
                    const memory = byId.get(row.id);
                    return memory && !memory.encLocked && !memory.deletedAt
                        ? [{ memory: { ...memory, semanticScore: row.semanticScore }, score: row.score,
                            matchKind: row.matchKind, snippet: row.snippet, matchedTags: row.matchedTags }] : [];
                });
                setRankedResult({ uid: user.uid, query: searchQuery.trim(), source: sessions, filters,
                    hits, candidateIds, loading, error, selectionEpoch });
            };
            try {
                if (currentCorpus === 'unavailable') throw new Error('Local search unavailable');
                const lease = await hybridIndex.prepare({ corpus: currentCorpus, query: searchQuery, filters,
                    limit: 500, floor: .38 }, controller.signal);
                if (cancelled) return;
                const record = (resultCount: number) => {
                    if (cancelled) return;
                    void (async () => {
                        const at = Date.now();
                        const rows: LocalMemoryActivity[] = [{ id: crypto.randomUUID(), kind: 'retrieve', operation: 'search', at, resultCount }];
                        if (lease.stats.changed || lease.stats.removed) rows.unshift({ id: crypto.randomUUID(), kind: 'index', at,
                            changed: lease.stats.changed, removed: lease.stats.removed, indexed: lease.stats.indexed });
                        await appendLocalMemoryActivity(user.uid, rows);
                    })().catch(() => console.warn('Local memory activity unavailable.'));
                };
                const candidates = lease.candidateIds.map(id => byId.get(id)!);
                const queryText = parseSearchQuery(searchQuery).text;
                const hasSemantic = queryText.length >= 2 && candidates.length > 0 &&
                    Boolean(selectedProfile || candidates.some(session => session.embedding?.length));
                publish(lease.hits, lease.candidateIds, hasSemantic);
                if (!hasSemantic) {
                    searchIndex.dispose();
                    record(searchQuery.trim() ? lease.hits.length : lease.candidateIds.length);
                    return;
                }
                let scores = new Map<string, number>();
                try {
                    scores = await searchSelectedEmbeddingProfile(user.uid, selectedProfile, candidates,
                        queryText, controller.signal, (request, signal) => searchIndex.rank(request, signal), preparedSearchCache);
                } catch {
                    if (!cancelled) console.warn('Semantic search unavailable.');
                }
                if (cancelled) return;
                const hits = await hybridIndex.rank(lease, scores, controller.signal);
                publish(hits, lease.candidateIds, false);
                record(hits.length);
            } catch {
                if (!cancelled) {
                    console.warn('Local search unavailable.');
                    publish([], [], false, 'unavailable');
                }
            }
        };

        void runSearch();
        return () => { cancelled = true; controller.abort(); };
    }, [searchQuery, sessions, currentCorpus, filters, needsSearch, searchIndex, hybridIndex, preparedSearchCache, selectedProfile, selectionEpoch, user]);

    const searchHits = resultCurrent ? rankedResult.hits : NO_SEARCH_HITS;

    // ACL precedes the Worker. Only current query/scope IDs may reach the views.
    const filteredSessions = useMemo(() => {
        if (!needsSearch) return sessions;
        if (!resultCurrent) return [];
        const byId = new Map(sessions.map(session => [session.id, session]));
        if (!searchQuery.trim()) return rankedResult.candidateIds.flatMap(id => {
            const session = byId.get(id); return session ? [session] : [];
        });
        return searchHits.flatMap(hit => {
            const session = byId.get(hit.memory.id);
            return session ? [{ ...session, semanticScore: hit.score }] : [];
        });
    }, [sessions, searchQuery, needsSearch, resultCurrent, rankedResult, searchHits]);

    const searchResults: SessionSearchResults = useMemo(() => ({
        uid: user?.uid ?? '', query: searchQuery.trim(), hits: searchHits,
        loading: needsSearch && (!resultCurrent || rankedResult.loading),
        error: resultCurrent ? rankedResult.error : undefined,
    }), [user?.uid, searchQuery, searchHits, needsSearch, resultCurrent, rankedResult]);

    // Extrair Tags e Categorias disponíveis para a UI
    const availableResources = useMemo(() => {
        const tags = new Set<string>();
        const categories = new Set<string>();

        sessions.forEach(s => {
            s.tags?.forEach(tag => tags.add(tag));
            if (s.category) categories.add(s.category);
        });

        return {
            tags: Array.from(tags).sort(),
            categories: Array.from(categories).sort()
        };
    }, [sessions]);

    return {
        sessions,
        allSessions: authorizedAllSessions,
        filteredSessions,
        searchResults,
        isLoading,
        availableTags: availableResources.tags,
        availableCategories: availableResources.categories
    };
};
