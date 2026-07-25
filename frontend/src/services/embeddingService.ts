import { pipeline, env } from '@huggingface/transformers';

// Configurar para usar cache local
env.allowLocalModels = false;
env.allowRemoteModels = true;

/**
 * Serviço de Embeddings Semânticos
 * Usa Transformers.js para gerar embeddings localmente no navegador
 * 100% privado - nenhum dado enviado para servidores
 */
class EmbeddingService {
    private static instance: EmbeddingService;
    private embedder: any = null;
    private embeddingCache: Map<string, number[]> = new Map();
    private isInitializing: boolean = false;
    private initPromise: Promise<void> | null = null;

    private constructor() { }

    static getInstance(): EmbeddingService {
        if (!EmbeddingService.instance) {
            EmbeddingService.instance = new EmbeddingService();
        }
        return EmbeddingService.instance;
    }

    /**
     * Inicializa o modelo de embeddings
     * Modelo: Xenova/all-MiniLM-L6-v2 (80MB)
     * - Rápido e eficiente
     * - Suporta múltiplos idiomas
     * - Ótimo para similaridade semântica
     */
    async initialize(): Promise<void> {
        if (this.embedder) {
            return; // Já inicializado
        }

        if (this.isInitializing) {
            // Aguardar inicialização em andamento
            return this.initPromise!;
        }

        this.isInitializing = true;
        this.initPromise = (async () => {
            try {
                console.log('🧠 Carregando modelo de embeddings...');
                this.embedder = await pipeline(
                    'feature-extraction',
                    'Xenova/all-MiniLM-L6-v2'
                );
                console.log('✅ Modelo de embeddings carregado!');
            } catch (error) {
                console.error('❌ Erro ao carregar modelo:', error);
                throw error;
            } finally {
                this.isInitializing = false;
            }
        })();

        return this.initPromise;
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

        // Usar primeiros 200 caracteres como chave de cache
        const cacheKey = text.substring(0, 200);

        // Verificar cache
        if (this.embeddingCache.has(cacheKey)) {
            return this.embeddingCache.get(cacheKey)!;
        }

        // Garantir que modelo está inicializado
        await this.initialize();

        try {
            // Gerar embedding
            const output = await this.embedder(text, {
                pooling: 'mean',
                normalize: true
            });

            const embedding = Array.from(output.data as Float32Array);

            // Armazenar em cache (limitar tamanho do cache)
            if (this.embeddingCache.size > 1000) {
                // Remover primeira entrada (FIFO simples)
                const firstKey = this.embeddingCache.keys().next().value;
                if (firstKey !== undefined) {
                    this.embeddingCache.delete(firstKey);
                }
            }
            this.embeddingCache.set(cacheKey, embedding);

            return embedding;
        } catch (error) {
            console.error('❌ Erro ao gerar embedding:', error);
            throw error;
        }
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
    async findSimilarMemories(
        targetMemory: any,
        allMemories: any[],
        threshold: number = 0.6,
        limit: number = 5
    ): Promise<Array<{ memory: any; similarity: number }>> {
        if (!targetMemory || !targetMemory.text) {
            return [];
        }

        if (allMemories.length === 0) {
            return [];
        }

        try {
            // Gerar embedding da memória alvo
            const targetEmbedding = await this.getEmbedding(targetMemory.text);

            // Calcular similaridade com todas as outras memórias
            const similarities = await Promise.all(
                allMemories
                    .filter(m =>
                        m.id !== targetMemory.id &&
                        m.text &&
                        typeof m.text === 'string' &&
                        m.text.trim().length > 0
                    )
                    .map(async (memory) => {
                        try {
                            const embedding = await this.getEmbedding(memory.text);
                            const similarity = this.cosineSimilarity(targetEmbedding, embedding);
                            return { memory, similarity };
                        } catch (error) {
                            console.warn('Erro ao processar memória:', memory.id, error);
                            return { memory, similarity: 0 };
                        }
                    })
            );

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
        this.embeddingCache.clear();
        console.log('🗑️ Cache de embeddings limpo');
    }

    /**
     * Retorna estatísticas do cache
     */
    getCacheStats() {
        return {
            size: this.embeddingCache.size,
            maxSize: 1000,
            isInitialized: !!this.embedder,
            isInitializing: this.isInitializing
        };
    }
}

export const embeddingService = EmbeddingService.getInstance();
