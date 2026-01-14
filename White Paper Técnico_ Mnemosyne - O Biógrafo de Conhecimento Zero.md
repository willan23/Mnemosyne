# White Paper Técnico: Mnemosyne - O Biógrafo de Conhecimento Zero

**Autor:** Manus AI (Arquiteto de Produto Visionário)
**Data:** Dezembro 2025

## Resumo Executivo
O Mnemosyne redefine o legado digital ao introduzir o conceito de "Zero-Knowledge Biographer". Esta arquitetura garante que a plataforma não tem acesso ao conteúdo sensível do utilizador, transformando a privacidade de uma funcionalidade numa fundação inegociável.

## 1. O Desafio da Confiança no Legado Digital
A maioria das plataformas de memória digital armazena dados em texto simples ou com cifragem no servidor (que o fornecedor pode aceder). O Mnemosyne aborda este problema com uma solução de ponta a ponta.

## 2. Arquitetura Zero-Knowledge (E2EE)
### 2.1. A Cerimónia da Chave
*   **Derivação da Chave:** Detalhe do uso de PBKDF2 (100.000 iterações) e SHA256 para derivar a chave mestra no dispositivo do cliente.
*   **Cifragem:** Uso de AES-256-GCM para cifrar áudio e transcrições localmente.
*   **Armazenamento no Servidor:** O servidor armazena apenas o *blob* cifrado e o IV. Prova de que o servidor não armazena a chave mestra.

### 2.2. Prova de Zero-Knowledge
Apresentação dos resultados do PoC 1 (simulação do servidor a falhar na decifragem).

## 3. O Private Insight Engine: Grafo de Conhecimento (GC) Zero-Knowledge
### 3.1. O Dilema: Como ser Inteligente sem Ler o Conteúdo?
Explicação de como o LLM opera num enclave seguro (ou com *tokens* de contexto limitados) para extrair apenas a **estrutura** (Nós e Arestas) e não o conteúdo narrativo.
### 3.2. A Estrutura do GC
Tabela detalhada dos 5 Nós e 3 Arestas.
### 3.3. Pipeline de Baixa Latência
Apresentação dos resultados do PoC 2 (tempo total de pipeline inferior a 2.0 segundos).

## 4. Implicações Legais e de Planeamento Sucessório
O Mnemosyne como um "Testamento Digital" complementar. A importância da "Cerimónia da Chave" para o planeamento sucessório (o advogado como guardião da chave).

## Conclusão
O Mnemosyne não é apenas uma ferramenta de memória; é uma infraestrutura de confiança.
