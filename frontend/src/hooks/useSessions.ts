import { useState, useEffect, useMemo } from 'react';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import type { User } from 'firebase/auth';
import { embeddingService } from '../services/embeddingService';

export interface FilterOptions {
    dateRange: string;
    tags: string[];
    category?: string;
}

// Definindo tipos para evitar 'any'
export interface SessionData {
    id: string;
    text: string;
    timestamp: number;
    updatedAt: number;
    uid: string;
    tags?: string[];
    category?: string;
    lastViewedAt?: number;
    nodes?: Array<{ id: string; label: string; type: string }>;
    links?: Array<{ source: string; target: string }>;
    embedding?: number[];
    connections?: string[];
    semanticClusterId?: string;
    position?: [number, number, number];
    importance?: number;
    celestialType?: string;
    title?: string;
    semanticScore?: number;
    deletedAt?: number;
    deletedByDeviceId?: string;
    originalMemoryId?: string;
    conflictReason?: string;
}

export const useSessions = (user: User | null, searchQuery: string, filters: FilterOptions) => {
    const [sessions, setSessions] = useState<SessionData[]>([]);
    const [allSessions, setAllSessions] = useState<SessionData[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [orphanedCount, setOrphanedCount] = useState(0);
    const [semanticScores, setSemanticScores] = useState<Map<string, number>>(new Map());

    // Firestore Listener
    useEffect(() => {
        if (!user) {
            setSessions([]);
            setIsLoading(false);
            return;
        }

        const q = query(
            collection(db, "sessions"),
            where("uid", "==", user.uid),
            orderBy("timestamp", "desc")
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const nextAllSessions: SessionData[] = [];

            snapshot.forEach((doc) => {
                const data = doc.data();
                const rawEmbedding = data.embedding;
                const embedding = Array.isArray(rawEmbedding)
                    ? rawEmbedding
                    : (typeof rawEmbedding === 'string' ? JSON.parse(rawEmbedding || '[]') : []);
                const rawPosition = data.position;
                // Garantir tipagem básica ao ler do Firestore
                nextAllSessions.push({
                    id: doc.id,
                    text: data.text || '',
                    title: data.title,
                    timestamp: data.timestamp || 0,
                    updatedAt: data.updatedAt || data.timestamp || 0,
                    uid: data.uid,
                    tags: data.tags,
                    category: data.category,
                    lastViewedAt: data.lastViewedAt,
                    nodes: data.nodes,
                    links: data.links,
                    embedding,
                    connections: Array.isArray(data.connections) ? data.connections : [],
                    semanticClusterId: typeof data.semanticClusterId === 'string' ? data.semanticClusterId : undefined,
                    position: Array.isArray(rawPosition) && rawPosition.length === 3 ? rawPosition as [number, number, number] : undefined,
                    importance: data.importance,
                    celestialType: data.celestialType,
                    deletedAt: data.deletedAt,
                    deletedByDeviceId: data.deletedByDeviceId,
                    originalMemoryId: data.originalMemoryId,
                    conflictReason: data.conflictReason,
                } as SessionData);
            });

            setAllSessions(nextAllSessions);
            const visibleSessions = nextAllSessions.filter((session) => !session.deletedAt);
            setSessions(visibleSessions);
            setIsLoading(false);

            // Verificar órfãos (lógica movida do App.tsx, mas simplificada aqui)
            // A verificação de chave mnemônica deve ser feita no componente visual se necessário
            setOrphanedCount(visibleSessions.length);
        });

        return () => unsubscribe();
    }, [user]);

    useEffect(() => {
        let cancelled = false;
        const runSemanticSearch = async () => {
            const queryText = searchQuery.trim();
            if (queryText.length < 3 || sessions.every((session) => !session.embedding?.length)) {
                setSemanticScores(new Map());
                return;
            }

            try {
                const queryEmbedding = await embeddingService.getEmbedding(queryText);
                const nextScores = new Map<string, number>();
                for (const session of sessions) {
                    if (!session.embedding?.length || session.embedding.length !== queryEmbedding.length) continue;
                    const score = embeddingService.cosineSimilarity(queryEmbedding, session.embedding);
                    if (score >= 0.42) nextScores.set(session.id, score);
                }
                if (!cancelled) setSemanticScores(nextScores);
            } catch (error) {
                console.warn('Semantic search unavailable:', error);
                if (!cancelled) setSemanticScores(new Map());
            }
        };

        runSemanticSearch();
        return () => { cancelled = true; };
    }, [searchQuery, sessions]);

    // Lógica de Filtro e Busca
    const filteredSessions = useMemo(() => {
        let result = [...sessions];

        // Filtro de Texto
        if (searchQuery.trim()) {
            const queryText = searchQuery.toLowerCase();
            result = result.filter(s =>
                s.text?.toLowerCase().includes(queryText) ||
                s.tags?.some((tag: string) => tag.toLowerCase().includes(queryText)) ||
                (semanticScores.get(s.id) || 0) >= 0.42
            ).map((session) => ({
                ...session,
                semanticScore: semanticScores.get(session.id) || 0,
            })).sort((a, b) => {
                const semanticDelta = (b.semanticScore || 0) - (a.semanticScore || 0);
                return Math.abs(semanticDelta) > 0.01 ? semanticDelta : b.timestamp - a.timestamp;
            });
        }

        // Filtro de Data
        if (filters.dateRange !== 'all') {
            const now = Date.now();
            const ranges: Record<string, number> = {
                today: 24 * 60 * 60 * 1000,
                week: 7 * 24 * 60 * 60 * 1000,
                month: 30 * 24 * 60 * 60 * 1000,
                year: 365 * 24 * 60 * 60 * 1000
            };
            const cutoff = now - (ranges[filters.dateRange] || 0);
            result = result.filter(s => s.timestamp > cutoff);
        }

        // Filtro de Tags
        if (filters.tags.length > 0) {
            result = result.filter(s =>
                s.tags?.some((tag: string) => filters.tags.includes(tag))
            );
        }

        // Filtro de Categoria
        if (filters.category) {
            result = result.filter(s => s.category === filters.category);
        }

        return result;
    }, [sessions, searchQuery, filters, semanticScores]);

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
        allSessions,
        filteredSessions,
        isLoading,
        orphanedCount,
        availableTags: availableResources.tags,
        availableCategories: availableResources.categories
    };
};
