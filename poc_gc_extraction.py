import json
import time

# --- DADOS DE ENTRADA (Simulação) ---
# Simulação da transcrição de 10 segundos de áudio (saída do Whisper)
TRANSCRICAO_EXEMPLO = "A minha avó, Maria, ensinou-me a importância da perseverança durante a crise financeira de 2008. Ela costumava dizer que o dinheiro só serve para te dar tempo. Tempo para as pessoas que amas. Essa lição foi o meu maior artefacto."

# O prompt JSON (simplificado para a simulação)
PROMPT_GC_TEMPLATE = {
    "instrucao": "Você é um motor de extração de Grafo de Conhecimento (GC). Extraia entidades e relações estritamente no formato JSON. NÃO sumarize. A saída DEVE conter 'nos' e 'arestas'.",
    "transcricao_a_analisar": TRANSCRICAO_EXEMPLO
}

# --- SIMULAÇÃO DO LLM (Extração do GC) ---
def simular_llm_gc_extraction(transcricao: str) -> dict:
    """
    Simula a chamada ao LLM (GPT-4.1-Nano) para extrair o Grafo de Conhecimento.
    O LLM recebe a transcrição e retorna o JSON estruturado.
    """
    # Simulação da latência do LLM (Assumimos 1.5 segundos para o LLM leve)
    time.sleep(1.5)

    # Simulação da saída JSON do LLM (Baseado no prompt e na transcrição)
    gc_json = {
        "nos": [
            {"tipo": "PESSOA", "nome": "Maria", "contexto": "Avó do biografado."},
            {"tipo": "CONCEITO", "nome": "Perseverança", "contexto": "Lição aprendida."},
            {"tipo": "EVENTO", "nome": "Crise Financeira 2008", "contexto": "Contexto da lição."},
            {"tipo": "ARTEFACTO", "nome": "Lição sobre o dinheiro", "contexto": "O maior artefacto mencionado."}
        ],
        "arestas": [
            {"origem_nome": "Maria", "destino_nome": "Perseverança", "tipo": "EMOCIONAL_AVALIATIVA", "relacao": "ENSINOU"},
            {"origem_nome": "Crise Financeira 2008", "destino_nome": "Perseverança", "tipo": "TEMPORAL", "relacao": "CONTEXTO_DE"},
            {"origem_nome": "Lição sobre o dinheiro", "destino_nome": "ARTEFACTO", "tipo": "CONVERSACIONAL", "relacao": "CLASSIFICADO_COMO"}
        ]
    }
    return gc_json

# --- EXECUÇÃO DO POC ---
def executar_poc_gc():
    print("--- INÍCIO DO PoC 2: PIPELINE DE VOZ E EXTRAÇÃO DO GC ---")
    start_time = time.time()

    # 1. Simulação da Transcrição (Latência do Whisper simulada em 0.3s)
    time.sleep(0.3)
    print(f"1. Transcrição (0.3s): '{TRANSCRICAO_EXEMPLO[:50]}...'")

    # 2. Extração do GC pelo LLM
    gc_resultado = simular_llm_gc_extraction(TRANSCRICAO_EXEMPLO)
    
    # 3. Validação e Atualização do GC (Simulação de 0.1s)
    time.sleep(0.1)
    
    end_time = time.time()
    tempo_total = end_time - start_time

    print("\n2. Resultado da Extração do GC (JSON):")
    print(json.dumps(gc_resultado, indent=2))
    print(f"\n3. Tempo Total do Pipeline (Transcrição + LLM + GC Update): {tempo_total:.2f} segundos")

    if tempo_total < 2.0:
        print("SUCESSO: O tempo total está abaixo do limite de 2.0 segundos, garantindo uma experiência conversacional fluida.")
    else:
        print("FALHA: O tempo total excede o limite de 2.0 segundos. Necessário otimizar o LLM ou o modelo de transcrição.")

executar_poc_gc()
