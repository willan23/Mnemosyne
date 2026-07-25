import os
import json
from typing import List, Tuple
from models import MemoryNode, MemoryLink
from openai import OpenAI
from dotenv import load_dotenv

# Carrega as variáveis de ambiente do arquivo .env
load_dotenv()

# Inicializar o cliente da OpenAI apontando para a NVIDIA NIM
# Utilizando a chave fornecida como fallback seguro
client = OpenAI(
    base_url="https://integrate.api.nvidia.com/v1",
    api_key=os.getenv("NVIDIA_API_KEY", "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")
)

# Definir o modelo a ser usado (pegando do .env ou fallback)
MODEL_CORE = os.getenv("NVIDIA_MODEL_CORE", "meta/llama-3.1-70b-instruct")

class KGExtractor:
    def __init__(self):
        pass

    def extract(self, text: str, session_id: str) -> Tuple[List[MemoryNode], List[MemoryLink]]:
        """
        Extrai entidades e relações do texto usando a API da NVIDIA (Llama 3.1 70B).
        Substitui o motor de regex antigo por IA de verdade.
        """
        system_prompt = '''
Você é o motor de extração de Grafo de Conhecimento (Knowledge Graph) do Mnemosyne Cognitive OS.
Sua tarefa é analisar o texto do usuário e extrair os conceitos, pessoas, ideias ou objetos principais (entidades) e as relações entre eles.
Responda APENAS com um objeto JSON válido.
O JSON deve ter duas chaves: 'entities' e 'relations'.
- 'entities' é uma lista de objetos com 'id' (snake_case, minúsculo, único) e 'name' (Nome Legível formatado).
- 'relations' é uma lista de objetos com 'source' (id da origem), 'target' (id do destino) e 'relation' (descrição curta do link).

Exemplo:
{
  "entities": [
    {"id": "inteligencia_artificial", "name": "Inteligência Artificial"},
    {"id": "mnemosyne", "name": "Mnemosyne"}
  ],
  "relations": [
    {"source": "mnemosyne", "target": "inteligencia_artificial", "relation": "utiliza"}
  ]
}
'''

        try:
            print(f"[*] Extraindo grafo via NVIDIA NIM usando o modelo {MODEL_CORE}...")
            response = client.chat.completions.create(
                model=MODEL_CORE,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": text}
                ],
                temperature=0.1, # Temperatura baixa para garantir estruturação lógica
                max_tokens=1024,
                response_format={"type": "json_object"}
            )
            
            content = response.choices[0].message.content
            data = json.loads(content)
            
            nodes = []
            for e in data.get("entities", []):
                nodes.append(MemoryNode(
                    id=e["id"], 
                    name=e["name"], 
                    session_id=session_id
                ))
                
            links = []
            for r in data.get("relations", []):
                links.append(MemoryLink(
                    source=r["source"], 
                    target=r["target"], 
                    session_id=session_id
                ))
            
            print(f"[+] Extração concluída: {len(nodes)} nós e {len(links)} conexões geradas.")    
            return nodes, links

        except Exception as e:
            print(f"[-] Erro ao extrair KG via NVIDIA API: {e}")
            # Retorna arrays vazios para não quebrar a aplicação caso a API falhe
            return [], []

kg_extractor = KGExtractor()
