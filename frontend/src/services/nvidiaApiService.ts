/**
 * Serviço de Conexão com o Motor de IA Mnemosyne (NVIDIA NIM)
 * Responsável por enviar o texto para o backend e receber o grafo extraído.
 */
import { getLocalAiConfig } from './localAiConfig';


export interface NVIDIAEntity {
    id: string;
    name: string;
    val: number;
}

export interface NVIDIARelation {
    source: string;
    target: string;
}

export interface NVIDIAExtractionResult {
    nodes: NVIDIAEntity[];
    links: NVIDIARelation[];
}

class NVIDIAApiService {
    private static instance: NVIDIAApiService;
    private fallbackBaseUrl: string = import.meta.env.VITE_API_URL || 'http://localhost:8000';

    private constructor() {}

    static getInstance(): NVIDIAApiService {
        if (!NVIDIAApiService.instance) {
            NVIDIAApiService.instance = new NVIDIAApiService();
        }
        return NVIDIAApiService.instance;
    }

    async extract(text: string): Promise<NVIDIAExtractionResult> {
        try {
            const config = getLocalAiConfig();
            const nvidiaConfig = config.providers.nvidia;
            const baseUrl = nvidiaConfig.endpoint || this.fallbackBaseUrl;
            console.log('🌌 [NVIDIA NIM] Solicitando extração ao backend...');
            const response = await fetch(`${baseUrl}/api/v1/extract`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ text, model: nvidiaConfig.model || undefined }),
            });

            if (!response.ok) {
                throw new Error(`Falha na extração: ${response.statusText}`);
            }

            const data = await response.json();
            console.log('✅ [NVIDIA NIM] Grafo recebido com sucesso.');
            return data;
        } catch (error) {
            console.error('❌ [NVIDIA NIM] Erro ao comunicar com o backend:', error);
            throw error;
        }
    }
}

export const nvidiaApiService = NVIDIAApiService.getInstance();
