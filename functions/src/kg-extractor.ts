import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';

interface Entity {
    id: string;
    name: string;
    type: string;
}

interface Relation {
    source: string;
    target: string;
    type: string;
}

interface KGExtractionResult {
    entities: Entity[];
    relations: Relation[];
}

type LLMProvider = 'gemini' | 'openai' | 'fallback';

export class LLMKGExtractor {
    private provider: LLMProvider;
    private openai: OpenAI | null = null;
    private gemini: GoogleGenerativeAI | null = null;
    private model: string;

    constructor() {
        // Auto-detect provider (Gemini has priority)
        const geminiKey = process.env.GEMINI_API_KEY;
        const openaiKey = process.env.OPENAI_API_KEY;

        if (geminiKey && geminiKey !== 'your-gemini-key-here') {
            this.provider = 'gemini';
            this.gemini = new GoogleGenerativeAI(geminiKey);
            this.model = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
            console.log('✅ Gemini client initialized with model:', this.model);
        } else if (openaiKey && openaiKey !== 'sk-proj-your-key-here') {
            this.provider = 'openai';
            this.openai = new OpenAI({ apiKey: openaiKey });
            this.model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
            console.log('✅ OpenAI client initialized with model:', this.model);
        } else {
            this.provider = 'fallback';
            this.model = 'regex';
            console.warn('⚠️ No LLM API key configured. Using fallback extraction.');
        }
    }

    /**
     * Extract entities and relations from text using configured LLM provider
     */
    async extract(text: string): Promise<KGExtractionResult> {
        console.log(`🔍 Extracting knowledge graph using provider: ${this.provider}`);

        switch (this.provider) {
            case 'gemini':
                return this.extractWithGemini(text);
            case 'openai':
                return this.extractWithOpenAI(text);
            default:
                return this.fallbackExtraction(text);
        }
    }

    /**
     * Extract using Google Gemini API
     */
    private async extractWithGemini(text: string): Promise<KGExtractionResult> {
        try {
            const model = this.gemini!.getGenerativeModel({
                model: this.model,
                generationConfig: {
                    temperature: 0.3,
                    responseMimeType: 'application/json'
                }
            });

            const prompt = this.buildPrompt(text);

            const result = await model.generateContent(prompt);
            const response = await result.response;
            const content = response.text();

            if (!content) {
                throw new Error('Empty response from Gemini');
            }

            const parsed = JSON.parse(content) as KGExtractionResult;
            console.log(`✅ Gemini extracted ${parsed.entities.length} entities, ${parsed.relations.length} relations`);

            return parsed;
        } catch (error) {
            console.error('❌ Gemini extraction failed:', error);
            console.log('🔄 Falling back to regex extraction');
            return this.fallbackExtraction(text);
        }
    }

    /**
     * Extract using OpenAI API
     */
    private async extractWithOpenAI(text: string): Promise<KGExtractionResult> {
        try {
            const prompt = this.buildPrompt(text);

            const completion = await this.openai!.chat.completions.create({
                model: this.model,
                messages: [
                    {
                        role: 'system',
                        content: 'You are a knowledge graph extraction expert. Extract entities and their relationships from text. Return valid JSON only.'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                temperature: 0.3,
                response_format: { type: 'json_object' }
            });

            const content = completion.choices[0]?.message?.content;
            if (!content) {
                throw new Error('Empty response from OpenAI');
            }

            const result = JSON.parse(content) as KGExtractionResult;
            console.log(`✅ OpenAI extracted ${result.entities.length} entities, ${result.relations.length} relations`);

            return result;
        } catch (error) {
            console.error('❌ OpenAI extraction failed:', error);
            console.log('🔄 Falling back to regex extraction');
            return this.fallbackExtraction(text);
        }
    }

    /**
     * Build optimized prompt for KG extraction
     */
    private buildPrompt(text: string): string {
        return `Extract entities and relationships from the following text as a knowledge graph.

Text: "${text}"

Return a JSON object with this exact structure:
{
  "entities": [
    {"id": "unique_id", "name": "Entity Name", "type": "person|place|concept|event|organization|other"}
  ],
  "relations": [
    {"source": "entity_id_1", "target": "entity_id_2", "type": "relationship_type"}
  ]
}

Rules:
1. Use lowercase IDs with underscores (e.g., "joao_silva")
2. Extract only meaningful entities (people, places, concepts, events, organizations)
3. Identify clear relationships between entities
4. Keep entity names in original language
5. Relationship types should be verbs or prepositions (e.g., "conheceu", "trabalha_em", "discutiu_sobre")
6. Return ONLY the JSON object, no additional text`;
    }

    /**
     * Fallback extraction using regex (when API key is not available)
     */
    private fallbackExtraction(text: string): KGExtractionResult {
        console.log('🔄 Using fallback regex-based extraction');

        // Extract capitalized words as potential entities
        const capitalizedWords = text.match(/\b[A-ZÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝ][a-zàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿ]+\b/g) || [];
        const uniqueWords = [...new Set(capitalizedWords)];

        const entities: Entity[] = uniqueWords.map(word => ({
            id: word.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '_'),
            name: word,
            type: 'concept'
        }));

        // Create relations between entities that appear in the same sentence
        const relations: Relation[] = [];
        const sentences = text.split(/[.!?]+/);

        sentences.forEach(sentence => {
            const foundEntities = entities.filter(e =>
                sentence.includes(e.name)
            );

            for (let i = 0; i < foundEntities.length - 1; i++) {
                relations.push({
                    source: foundEntities[i].id,
                    target: foundEntities[i + 1].id,
                    type: 'relacionado_com'
                });
            }
        });

        console.log(`📊 Fallback extracted ${entities.length} entities, ${relations.length} relations`);

        return { entities, relations };
    }
}
