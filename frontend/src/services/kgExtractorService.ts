import { pipeline, env } from '@huggingface/transformers';

// Configuração para utilizar CDN Remote e Models Locais de forma eficiente no Browser sem quebrar a privacidade
env.allowLocalModels = false;
env.allowRemoteModels = true; // Baixa o modelo da CDN do HuggingFace para o Cache do Browser

export interface Entity {
    id: string;
    name: string;
    type: string;
    val: number;
}

export interface Relation {
    source: string;
    target: string;
    type: string;
}

export interface KGExtractionResult {
    entities: Entity[];
    relations: Relation[];
}

/**
 * Serviço de Extração Semântica e Entidades (NER) E2EE (Local-first)
 * Roda totalmente do lado do cliente utilizando modelos quantizados.
 * Não envia texto cru para lado nenhum garantindo integridade Zero Knowledge.
 */
class LocalKGExtractorService {
    private static instance: LocalKGExtractorService;
    private nerPipeline: any = null;
    private isInitializing = false;
    private initPromise: Promise<void> | null = null;

    private constructor() {}

    static getInstance(): LocalKGExtractorService {
        if (!LocalKGExtractorService.instance) {
            LocalKGExtractorService.instance = new LocalKGExtractorService();
        }
        return LocalKGExtractorService.instance;
    }

    async initialize(): Promise<void> {
        if (this.nerPipeline) return;
        if (this.isInitializing) return this.initPromise!;

        this.isInitializing = true;
        this.initPromise = (async () => {
            try {
                console.log('🧠 [Zero-Knowledge] Carregando NER Transformer local...');
                // Utilizamos um modelo leve de token-classification para extração de Entidades Nomeadas (NER)
                // O Xenova/bert-base-NER é um modelo robusto para token-classification.
                this.nerPipeline = await pipeline(
                    'token-classification',
                    'Xenova/bert-base-NER'
                );
                console.log('✅ [Zero-Knowledge] Motor T-NER inicializado localmente!');
            } catch (error) {
                console.error('❌ Erro no init do motor NLP:', error);
                throw error;
            } finally {
                this.isInitializing = false;
            }
        })();

        return this.initPromise;
    }

    private slugify(text: string): string {
        return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    }

    async extract(text: string): Promise<KGExtractionResult> {
        if (!text || text.trim() === '') return { entities: [], relations: [] };
        
        await this.initialize();
        console.log('🔍 [Zero-Knowledge] Extraindo Grafo de Conhecimento localmente...');

        try {
            // Executa Named Entity Recognition (Pessoas, Lugares, Organizações)
            const nerResults = await this.nerPipeline(text);
            
            // Reconstrução de entidades quebradas devido a sub-word tokenization
            const entitiesMap = new Map<string, Entity>();
            
            let currentEntity = "";
            let currentType = "";
            let currentScore = 0;

            nerResults.forEach((token: any) => {
                const word = token.word.replace('##', '');
                // B- = Beginning, I- = Inner
                if (token.entity.startsWith('B-')) {
                    if (currentEntity.length > 0) {
                        const id = this.slugify(currentEntity);
                        if (id.length > 2) {
                            entitiesMap.set(id, { id, name: currentEntity.trim(), type: currentType, val: currentScore });
                        }
                    }
                    currentEntity = word;
                    currentType = token.entity.replace('B-', '');
                    currentScore = token.score;
                } else if (token.entity.startsWith('I-')) {
                    currentEntity += (token.word.startsWith('##') ? word : ' ' + word);
                    currentScore = Math.max(currentScore, token.score);
                }
            });

            if (currentEntity.length > 2) {
                const id = this.slugify(currentEntity);
                entitiesMap.set(id, { id, name: currentEntity.trim(), type: currentType, val: currentScore });
            }

            // Fallback Regex para Apanhar Nomes Próprios que o modelo ignorou, 
            // e também extrair conceitos abstractos.
            const capitalizedWords = text.match(/\b[A-ZÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝ][a-zàáâãäåçèéêëìíîïðñòóôõöøùúûüý]+\b/g) || [];
            
            capitalizedWords.forEach(word => {
                const id = this.slugify(word);
                if (id.length > 2 && !entitiesMap.has(id)) {
                    entitiesMap.set(id, { id, name: word, type: 'CONCEPT', val: 0.5 });
                }
            });

            const entitiesArray = Array.from(entitiesMap.values());
            
            // Normalizar valores para gráfico visual (2-7 force-graph nodes)
            entitiesArray.forEach(e => {
                e.val = Math.max(3, Math.min(8, e.val * 10)); 
            });

            // Extrair Relações Básicas usando Co-ocorrência em frases
            const relations: Relation[] = [];
            const sentences = text.split(/[.!?\n]+/);

            sentences.forEach(sentence => {
                const entitiesInSentence = entitiesArray.filter(e => sentence.toLowerCase().includes(e.name.toLowerCase()));
                
                // Conectar entidades que co-ocorrem
                for (let i = 0; i < entitiesInSentence.length; i++) {
                    for (let j = i + 1; j < entitiesInSentence.length; j++) {
                        // Verifica se ja existe
                        const exists = relations.find(r => 
                            (r.source === entitiesInSentence[i].id && r.target === entitiesInSentence[j].id) ||
                            (r.target === entitiesInSentence[i].id && r.source === entitiesInSentence[j].id)
                        );
                        
                        if (!exists) {
                            relations.push({
                                source: entitiesInSentence[i].id,
                                target: entitiesInSentence[j].id,
                                type: 'related'
                            });
                        }
                    }
                }
            });

            console.log(`✅ [Zero-Knowledge] Extraídos localmente ${entitiesArray.length} nós e ${relations.length} conexões.`);

            return {
                entities: entitiesArray,
                relations: relations
            };
        } catch (e) {
            console.error('❌ Falha na extração local:', e);
            return { entities: [], relations: [] };
        }
    }
}

export const localKGExtractorService = LocalKGExtractorService.getInstance();
