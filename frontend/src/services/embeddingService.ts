import { CURRENT_EMBEDDING_PROFILE, LEGACY_EMBEDDING_SPACE, sameEmbeddingSpace } from './embeddingModel';
import type { EmbeddingWorkerCommand, EmbeddingWorkerResponse } from './embeddingWorkerProtocol';
import { embeddingProfileSpace, type EmbeddingProfileId } from './embeddingProfile';

interface SearchableMemory {
    id: string;
    text?: string;
    embedding?: number[] | null;
    embeddingModel?: string;
}

/**
 * Serviço de Embeddings Semânticos
 * Usa Transformers.js para gerar embeddings localmente no navegador
 * O texto é processado no navegador; o download inicial do modelo exige rede.
 */
class EmbeddingService {
    private static instance: EmbeddingService;
    private static pinned = new Map<EmbeddingProfileId, EmbeddingService>();
    readonly space: string;
    private profile?: EmbeddingProfileId;
    private worker: Worker | null = null;
    private nextRequestId = 0;
    private pending = new Map<number, {
        resolve: (response: EmbeddingWorkerResponse) => void;
        reject: (error: Error) => void;
    }>();
    private initialized = false;
    private embeddingCache: Map<string, number[]> = new Map();
    private cacheEpoch = 0;
    private initPromise: Promise<void> | null = null;

    private constructor(profile?: EmbeddingProfileId) {
        this.profile = profile;
        this.space = profile ? embeddingProfileSpace(profile) : LEGACY_EMBEDDING_SPACE;
    }

    static forProfile(profile: EmbeddingProfileId): EmbeddingService {
        let service = this.pinned.get(profile);
        if (!service) { service = new EmbeddingService(profile); this.pinned.set(profile, service); }
        return service;
    }

    static getInstance(): EmbeddingService {
        if (!EmbeddingService.instance) {
            EmbeddingService.instance = new EmbeddingService();
        }
        return EmbeddingService.instance;
    }

    /**
     * Inicializa o modelo de embeddings
     * O serviço padrão usa o perfil multilingue fixado, executado num Web Worker.
     * A rota legada mantém o modelo inglês para consultas aos vetores históricos.
     */
    async initialize(): Promise<void> {
        if (this.initialized) return;
        if (this.initPromise) return this.initPromise;
        this.initPromise = this.send({ type: 'initialize' }).then(() => {
            this.initialized = true;
        }).catch((error) => {
            this.initPromise = null;
            throw error;
        });
        return this.initPromise;
    }

    private ensureWorker(): Worker {
        if (this.worker) return this.worker;
        if (typeof Worker === 'undefined') {
            throw new Error('Web Workers não estão disponíveis neste dispositivo.');
        }
        const worker = new Worker(new URL('./embeddingWorker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = (event: MessageEvent<EmbeddingWorkerResponse>) => {
            const response = event.data;
            const pending = this.pending.get(response.id);
            if (!pending) return;
            this.pending.delete(response.id);
            if (response.ok) pending.resolve(response);
            else pending.reject(new Error(response.error));
        };
        worker.onerror = () => {
            if (this.worker === worker) this.stopWorker('O processamento local de embeddings falhou.');
        };
        worker.onmessageerror = () => {
            if (this.worker === worker) this.stopWorker('O processamento local de embeddings falhou.');
        };
        this.worker = worker;
        return worker;
    }

    private send(request: EmbeddingWorkerCommand): Promise<EmbeddingWorkerResponse> {
        const worker = this.ensureWorker();
        const id = ++this.nextRequestId;
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            try {
                worker.postMessage({ ...request, id, ...(this.profile ? { profile: this.profile } : {}) });
            } catch {
                this.pending.delete(id);
                reject(new Error('Falha ao comunicar com o processamento local de embeddings.'));
            }
        });
    }

    private stopWorker(message: string): void {
        this.worker?.terminate();
        this.worker = null;
        this.initialized = false;
        this.initPromise = null;
        for (const pending of this.pending.values()) pending.reject(new Error(message));
        this.pending.clear();
    }

    /**
     * Gera uma chave de cache resistente a colisões baseada no conteúdo completo
     */
    private getCacheKey(text: string): string {
        let h1 = 0xdeadbeef;
        let h2 = 0x41c6ce57;
        for (let i = 0; i < text.length; i++) {
            const ch = text.charCodeAt(i);
            h1 = Math.imul(h1 ^ ch, 2654435761);
            h2 = Math.imul(h2 ^ ch, 1597334677);
        }
        h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
        h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
        h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
        h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
        return `${text.length}_${(h1 >>> 0).toString(16)}_${(h2 >>> 0).toString(16)}`;
    }

    /**
     * Gera embedding para um texto
     * @param text Texto para gerar embedding
     * @returns Array de números representando o embedding
     */
    async getEmbedding(text: string): Promise<number[]> {
        if (!text || text.trim().length === 0) {
            throw new Error('Texto vazio não pode gerar embedding');
        }

        // Chave de cache resistente a colisões baseada no texto completo
        const cacheKey = this.getCacheKey(text);
        const cacheEpoch = this.cacheEpoch;

        // Verificar cache
        if (this.embeddingCache.has(cacheKey)) {
            return this.embeddingCache.get(cacheKey)!;
        }

        // Garantir que modelo está inicializado
        await this.initialize();
        if (cacheEpoch !== this.cacheEpoch) throw new Error('O cofre mudou durante o processamento de embeddings.');

        const response = await this.send({ type: 'embed', text });
        if (cacheEpoch !== this.cacheEpoch) throw new Error('O cofre mudou durante o processamento de embeddings.');
        const embedding = response.ok && response.embedding;
        if (!embedding) throw new Error('O modelo local não devolveu um embedding.');

        // Armazenar em cache (limitar tamanho do cache)
        if (this.embeddingCache.size >= 1000) {
            // Remover primeira entrada (FIFO simples)
            const firstKey = this.embeddingCache.keys().next().value;
            if (firstKey !== undefined) {
                this.embeddingCache.delete(firstKey);
            }
        }
        if (cacheEpoch === this.cacheEpoch) this.embeddingCache.set(cacheKey, embedding);

        return embedding;
    }

    /**
     * Calcula similaridade de cosseno entre dois embeddings
     * @param a Primeiro embedding
     * @param b Segundo embedding
     * @returns Valor entre 0 e 1 (1 = idêntico, 0 = completamente diferente)
     */
    cosineSimilarity(a: number[], b: number[]): number {
        if (a.length !== b.length) {
            throw new Error('Embeddings devem ter o mesmo tamanho');
        }

        const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
        const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
        const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));

        if (magnitudeA === 0 || magnitudeB === 0) {
            return 0;
        }

        return dotProduct / (magnitudeA * magnitudeB);
    }

    /**
     * Encontra memórias similares a uma memória alvo
     * @param targetMemory Memória de referência
     * @param allMemories Todas as memórias disponíveis
     * @param threshold Limiar de similaridade (0-1)
     * @param limit Número máximo de resultados
     * @returns Array de memórias similares com score de similaridade
     */
    async findSimilarMemories<T extends SearchableMemory>(
        targetMemory: T,
        allMemories: T[],
        threshold: number = 0.6,
        limit: number = 5
    ): Promise<Array<{ memory: T; similarity: number }>> {
        if (!targetMemory || !targetMemory.text) {
            return [];
        }

        if (allMemories.length === 0) {
            return [];
        }

        try {
            const validStoredVector = (memory: SearchableMemory): number[] | null => (
                Array.isArray(memory.embedding) && memory.embedding.length > 0 &&
                memory.embedding.every((value: unknown) => typeof value === 'number' && Number.isFinite(value))
                    ? memory.embedding : null
            );
            // A pesquisa não deve calcular um vetor do modelo atual para um
            // documento que declara um espaço futuro ainda não carregado.
            const targetEmbedding = sameEmbeddingSpace(targetMemory.embeddingModel, this.space)
                ? await this.getEmbedding(targetMemory.text)
                : validStoredVector(targetMemory);
            if (!targetEmbedding) return [];

            // Reusar vetores persistidos e enviar no máximo um texto de cada vez
            // para não acumular conteúdo de todo o cofre na fila do Worker.
            const similarities: Array<{ memory: T; similarity: number }> = [];
            for (const memory of allMemories) {
                if (memory.id === targetMemory.id || typeof memory.text !== 'string' ||
                    !memory.text.trim() || !sameEmbeddingSpace(memory.embeddingModel, targetMemory.embeddingModel)) continue;
                try {
                    const stored = validStoredVector(memory);
                    const embedding = stored || (sameEmbeddingSpace(memory.embeddingModel, this.space)
                        ? await this.getEmbedding(memory.text) : null);
                    if (!embedding || embedding.length !== targetEmbedding.length) continue;
                    const similarity = this.cosineSimilarity(targetEmbedding, embedding);
                    similarities.push({ memory, similarity });
                } catch {
                    // A failure for one memory must not discard other matches.
                }
            }

            // Filtrar por threshold e ordenar por similaridade
            return similarities
                .filter(s => s.similarity >= threshold)
                .sort((a, b) => b.similarity - a.similarity)
                .slice(0, limit);
        } catch (error) {
            console.error('❌ Erro ao encontrar memórias similares:', error);
            return [];
        }
    }

    /**
     * Limpa o cache de embeddings
     */
    clearCache(): void {
        if (this === EmbeddingService.instance) {
            for (const service of EmbeddingService.pinned.values()) service.clearCache();
        }
        this.cacheEpoch += 1;
        this.embeddingCache.clear();
        this.stopWorker('O cofre mudou durante o processamento de embeddings.');
    }

    /**
     * Retorna estatísticas do cache
     */
    getCacheStats() {
        return {
            size: this.embeddingCache.size,
            maxSize: 1000,
            isInitialized: this.initialized,
            isInitializing: !!this.initPromise && !this.initialized
        };
    }
}

export const legacyEmbeddingService = EmbeddingService.getInstance();
export const embeddingService = EmbeddingService.forProfile(CURRENT_EMBEDDING_PROFILE);
export const embeddingServiceForProfile = (profile: EmbeddingProfileId) => EmbeddingService.forProfile(profile);
/** Account/vault invalidation must also retire legacy queries and other pinned profiles. */
export const resetEmbeddingServices = () => legacyEmbeddingService.clearCache();
