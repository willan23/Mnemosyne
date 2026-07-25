from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import Session, select
from models import engine, create_db_and_tables, MemorySession, MemoryNode, MemoryLink
from bs4 import BeautifulSoup
from pydantic import BaseModel, Field
from typing import Any, Literal
from urllib.parse import parse_qs, quote_plus, unquote, urlparse
import asyncio
import base64
import httpx
import os
import re
import time
import uuid

app = FastAPI(title="Mnemosyne (Echoes) API")

@app.on_event("startup")
def on_startup():
    create_db_and_tables()

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:1420",
        "https://mnemosyne.app",
        "tauri://localhost",
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_session():
    with Session(engine) as session:
        yield session

@app.get("/")
async def root():
    return {"message": "Mnemosyne API is running", "status": "healthy"}

@app.get("/graph")
async def get_graph(db: Session = Depends(get_session)):
    nodes = db.exec(select(MemoryNode)).all()
    links = db.exec(select(MemoryLink)).all()
    return {
        "nodes": [{"id": n.id, "name": n.name, "val": n.val} for n in nodes],
        "links": [{"source": l.source, "target": l.target} for l in links]
    }

from kg_engine import MODEL_CORE, client as hf_or_nvidia_client, kg_extractor

def process_memory(session_id: str, text: str, db: Session):
    nodes, links = kg_extractor.extract(text, session_id)
    for node in nodes:
        # Check if node already exists
        existing = db.get(MemoryNode, node.id)
        if not existing:
            db.add(node)
        else:
            existing.val += 1
            db.add(existing)
    
    for link in links:
        db.add(link)
    
    db.commit()

class SessionRequest(BaseModel):
    text: str

class WebResearchRequest(BaseModel):
    query: str = Field(..., min_length=2, max_length=500)
    mode: Literal["public", "contextual", "private-local"] = "public"
    context: list[str] = Field(default_factory=list, max_length=12)
    max_sources: int = Field(default=8, ge=1, le=12)

class GenerationRequest(BaseModel):
    prompt: str = Field(..., min_length=2, max_length=6000)
    model: str | None = None
    max_tokens: int = Field(default=900, ge=64, le=2048)

class GenerationResponse(BaseModel):
    text: str
    model: str | None = None
    provider: str
    warning: str | None = None

class ImageGenerationRequest(BaseModel):
    prompt: str = Field(..., min_length=2, max_length=4000)
    model: str | None = None
    size: Literal["1024x1024", "1024x1536", "1536x1024", "auto"] = "1024x1024"
    quality: Literal["low", "medium", "high", "auto"] = "medium"
    output_format: Literal["png", "jpeg", "webp"] = "png"

class ImageGenerationResponse(BaseModel):
    image_base64: str | None = None
    image_url: str | None = None
    media_type: str = "image/png"
    model: str
    provider: str = "openai"
    revised_prompt: str | None = None
    warning: str | None = None

class WebSearchResult(BaseModel):
    title: str
    url: str
    snippet: str = ""

class WebResearchSource(BaseModel):
    title: str
    url: str
    snippet: str = ""
    summary: str
    status: Literal["read", "snippet-only", "failed"]

class WebResearchResponse(BaseModel):
    query: str
    mode: str
    summary: str
    key_concepts: list[str]
    main_ideas: list[str]
    suggested_memories: list[str]
    sources: list[WebResearchSource]
    local_comparisons: list[str]

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)

HUGGINGFACE_API_BASE_URL = os.getenv("HUGGINGFACE_API_BASE_URL", "https://router.huggingface.co").rstrip("/")
HUGGINGFACE_TEXT_MODEL_DEFAULT = os.getenv("HUGGINGFACE_TEXT_MODEL", "Qwen/Qwen2.5-72B-Instruct")
HUGGINGFACE_IMAGE_MODEL_DEFAULT = os.getenv("HUGGINGFACE_IMAGE_MODEL", "black-forest-labs/FLUX.1-schnell")
HUGGINGFACE_IMAGE_PROVIDER = os.getenv("HUGGINGFACE_IMAGE_PROVIDER", "hf-inference").strip() or "hf-inference"

def get_huggingface_api_key() -> str | None:
    for name in ("HUGGINGFACE_API_KEY", "HF_TOKEN", "HUGGINGFACE_HUB_TOKEN"):
        api_key = os.getenv(name)
        if api_key and api_key.strip():
            return api_key.strip()
    return None

def get_nvidia_api_key() -> str | None:
    for name in ("NVIDIA_API_KEY", "NVIDIA_API_KEY_CORE"):
        api_key = os.getenv(name)
        if api_key and api_key.strip():
            return api_key.strip()
    return None

def bearer_json_headers(api_key: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

def is_probably_huggingface_model(model: str | None) -> bool:
    if not model:
        return False
    normalized = model.strip().lower()
    return "/" in normalized and not normalized.startswith(("meta/", "nvidia/", "microsoft/"))

def extract_chat_completion_text(payload: dict[str, Any]) -> str:
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices:
        return ""
    first = choices[0] if isinstance(choices[0], dict) else {}
    message = first.get("message") if isinstance(first.get("message"), dict) else {}
    content = message.get("content")
    if isinstance(content, str):
        return normalize_text(content)
    if isinstance(content, list):
        pieces = [
            part.get("text", "")
            for part in content
            if isinstance(part, dict) and isinstance(part.get("text"), str)
        ]
        return normalize_text("\n".join(pieces))
    return ""

def image_size_to_dimensions(size: str) -> tuple[int, int]:
    if size == "1024x1536":
        return 1024, 1536
    if size == "1536x1024":
        return 1536, 1024
    return 1024, 1024

def image_quality_to_steps(quality: str) -> int:
    if quality == "high":
        return int(os.getenv("HUGGINGFACE_IMAGE_STEPS_HIGH", "16"))
    if quality == "low":
        return int(os.getenv("HUGGINGFACE_IMAGE_STEPS_LOW", "4"))
    return int(os.getenv("HUGGINGFACE_IMAGE_STEPS_MEDIUM", "8"))

STOPWORDS = {
    "about", "after", "again", "also", "because", "before", "being", "between", "could",
    "every", "first", "from", "have", "into", "more", "most", "other", "over", "same",
    "such", "than", "that", "their", "there", "these", "they", "this", "through", "under",
    "were", "what", "when", "where", "which", "while", "with", "would",
    "ainda", "algo", "anos", "antes", "aqui", "cada", "como", "contra", "depois", "desde",
    "deste", "desta", "entre", "esta", "este", "foram", "mais", "mas", "mesmo", "muito",
    "para", "pela", "pelo", "pode", "pois", "porque", "quando", "sobre", "tambem", "todos",
    "uma", "usar", "isso", "esse", "essa", "eles", "elas", "com", "dos", "das", "que",
}

BLOCKED_RESULT_HOSTS = {
    "duckduckgo.com",
    "www.duckduckgo.com",
    "bing.com",
    "www.bing.com",
    "google.com",
    "www.google.com",
}

BLOCKED_RESULT_PATHS = (
    "/y.js",
    "/aclick",
    "/ads/",
    "/ad/",
)

def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()

def words(value: str) -> list[str]:
    return [
        token.lower()
        for token in re.findall(r"[A-Za-zÀ-ÿ0-9]{4,}", value)
        if token.lower() not in STOPWORDS
    ]

def split_sentences(value: str) -> list[str]:
    return [
        sentence.strip()
        for sentence in re.split(r"(?<=[.!?])\s+", normalize_text(value))
        if len(sentence.strip()) >= 40
    ]

def resolve_duckduckgo_url(href: str) -> str:
    if href.startswith("//"):
        href = "https:" + href
    parsed = urlparse(href)
    if "duckduckgo.com" in parsed.netloc and parsed.path.startswith("/l/"):
        uddg = parse_qs(parsed.query).get("uddg", [""])[0]
        return unquote(uddg)
    return href

def is_usable_result_url(url: str) -> bool:
    if not url.startswith(("http://", "https://")):
        return False
    parsed = urlparse(url)
    host = parsed.netloc.lower()
    path = parsed.path.lower()
    if host in BLOCKED_RESULT_HOSTS:
        return False
    if any(path.startswith(blocked) for blocked in BLOCKED_RESULT_PATHS):
        return False
    if "ad_domain=" in parsed.query or "ad_provider=" in parsed.query:
        return False
    return True

def extract_page_text(html: str) -> tuple[str, str]:
    soup = BeautifulSoup(html, "html.parser")
    for element in soup(["script", "style", "noscript", "svg", "nav", "footer", "header", "form"]):
        element.decompose()

    title = normalize_text(soup.title.get_text(" ", strip=True) if soup.title else "")
    pieces: list[str] = []
    meta = soup.find("meta", attrs={"name": "description"})
    if meta and meta.get("content"):
        pieces.append(str(meta["content"]))
    for selector in ["h1", "h2", "p", "li"]:
        for element in soup.select(selector):
            text = normalize_text(element.get_text(" ", strip=True))
            if len(text) >= 60:
                pieces.append(text)
            if sum(len(piece) for piece in pieces) > 18000:
                break
        if sum(len(piece) for piece in pieces) > 18000:
            break
    return title, normalize_text(" ".join(pieces))

def rank_summary(text: str, query: str, limit: int = 4) -> str:
    sentences = split_sentences(text)
    if not sentences:
        return normalize_text(text)[:700]

    query_terms = set(words(query))
    scored: list[tuple[int, int, str]] = []
    for index, sentence in enumerate(sentences[:80]):
        sentence_terms = set(words(sentence))
        score = len(query_terms.intersection(sentence_terms)) * 3 + min(len(sentence) // 120, 3)
        scored.append((score, -index, sentence))

    selected = [sentence for _, _, sentence in sorted(scored, reverse=True)[:limit]]
    return " ".join(selected)[:1200]

def extract_concepts(text: str, limit: int = 12) -> list[str]:
    counts: dict[str, int] = {}
    for token in words(text):
        counts[token] = counts.get(token, 0) + 1
    return [
        token
        for token, _ in sorted(counts.items(), key=lambda item: (-item[1], item[0]))[:limit]
    ]

async def search_duckduckgo(query_text: str, max_sources: int) -> list[WebSearchResult]:
    async with httpx.AsyncClient(
        headers={"User-Agent": USER_AGENT},
        follow_redirects=True,
        timeout=httpx.Timeout(12.0),
    ) as client:
        response = await client.get("https://duckduckgo.com/html/", params={"q": query_text})
        response.raise_for_status()
        soup = BeautifulSoup(response.text, "html.parser")

    results: list[WebSearchResult] = []
    seen: set[str] = set()
    for result in soup.select(".result"):
        classes = set(result.get("class") or [])
        if "result--ad" in classes or "result--ads" in classes:
            continue
        link = result.select_one("a.result__a") or result.select_one(".result__title a")
        if not link or not link.get("href"):
            continue
        url = resolve_duckduckgo_url(str(link["href"]))
        if not is_usable_result_url(url) or url in seen:
            continue
        seen.add(url)
        snippet = normalize_text(result.select_one(".result__snippet").get_text(" ", strip=True)) if result.select_one(".result__snippet") else ""
        title = normalize_text(link.get_text(" ", strip=True)) or url
        results.append(WebSearchResult(title=title, url=url, snippet=snippet))
        if len(results) >= max_sources:
            break
    return results

async def search_duckduckgo_lite(query_text: str, max_sources: int) -> list[WebSearchResult]:
    async with httpx.AsyncClient(
        headers={"User-Agent": USER_AGENT},
        follow_redirects=True,
        timeout=httpx.Timeout(12.0),
    ) as client:
        response = await client.post("https://lite.duckduckgo.com/lite/", data={"q": query_text})
        response.raise_for_status()
        soup = BeautifulSoup(response.text, "html.parser")

    results: list[WebSearchResult] = []
    seen: set[str] = set()
    for link in soup.select("a.result-link, a[href]"):
        href = str(link.get("href") or "")
        title = normalize_text(link.get_text(" ", strip=True))
        if not title or len(title) < 3:
            continue
        url = resolve_duckduckgo_url(href)
        if not is_usable_result_url(url) or url in seen:
            continue
        seen.add(url)
        snippet = ""
        row = link.find_parent("tr")
        if row and row.find_next_sibling("tr"):
            snippet = normalize_text(row.find_next_sibling("tr").get_text(" ", strip=True))
        results.append(WebSearchResult(title=title, url=url, snippet=snippet))
        if len(results) >= max_sources:
            break
    return results

async def search_wikipedia(query_text: str, max_sources: int) -> list[WebSearchResult]:
    async with httpx.AsyncClient(
        headers={"User-Agent": USER_AGENT},
        follow_redirects=True,
        timeout=httpx.Timeout(10.0),
    ) as client:
        response = await client.get(
            "https://en.wikipedia.org/w/api.php",
            params={
                "action": "opensearch",
                "search": query_text,
                "limit": max_sources,
                "namespace": 0,
                "format": "json",
            },
        )
        response.raise_for_status()
        payload = response.json()

    titles = payload[1] if len(payload) > 1 and isinstance(payload[1], list) else []
    snippets = payload[2] if len(payload) > 2 and isinstance(payload[2], list) else []
    urls = payload[3] if len(payload) > 3 and isinstance(payload[3], list) else []
    results: list[WebSearchResult] = []
    for title, snippet, url in zip(titles, snippets, urls):
        if isinstance(title, str) and isinstance(url, str) and is_usable_result_url(url):
            results.append(WebSearchResult(title=title, url=url, snippet=snippet if isinstance(snippet, str) else ""))
        if len(results) >= max_sources:
            break
    return results

async def search_public_web(query_text: str, max_sources: int) -> list[WebSearchResult]:
    collected: list[WebSearchResult] = []
    seen: set[str] = set()
    searchers = [search_duckduckgo, search_duckduckgo_lite, search_wikipedia]

    for searcher in searchers:
        if len(collected) >= max_sources:
            break
        try:
            results = await searcher(query_text, max_sources)
        except Exception as error:
            print(f"[web-search] {searcher.__name__} failed: {error}")
            continue
        for result in results:
            if result.url in seen or not is_usable_result_url(result.url):
                continue
            seen.add(result.url)
            collected.append(result)
            if len(collected) >= max_sources:
                break
    return collected

def build_direct_search_sources(query_text: str, max_sources: int) -> list[WebResearchSource]:
    encoded = quote_plus(query_text)
    return [
        WebResearchSource(
            title="Google Search",
            url=f"https://www.google.com/search?q={encoded}",
            snippet="Pesquisa pública direta.",
            summary="Abre esta fonte quando os motores automáticos limitarem o acesso a resultados públicos.",
            status="snippet-only",
        ),
        WebResearchSource(
            title="DuckDuckGo",
            url=f"https://duckduckgo.com/?q={encoded}",
            snippet="Pesquisa pública direta.",
            summary="Alternativa pública para procurar sem enviar memórias locais.",
            status="snippet-only",
        ),
        WebResearchSource(
            title="Bing",
            url=f"https://www.bing.com/search?q={encoded}",
            snippet="Pesquisa pública direta.",
            summary="Alternativa útil quando outro motor devolve poucos resultados.",
            status="snippet-only",
        ),
        WebResearchSource(
            title="Google Scholar",
            url=f"https://scholar.google.com/scholar?q={encoded}",
            snippet="Pesquisa de literatura e referências técnicas.",
            summary="Útil para estudos, papers, documentação técnica e fontes académicas.",
            status="snippet-only",
        ),
    ][:max_sources]

async def fetch_research_source(client: httpx.AsyncClient, result: WebSearchResult, query_text: str) -> WebResearchSource:
    try:
        response = await client.get(result.url)
        content_type = response.headers.get("content-type", "")
        if response.status_code >= 400 or "text/html" not in content_type:
            fallback_text = result.snippet or result.title
            return WebResearchSource(
                title=result.title,
                url=result.url,
                snippet=result.snippet,
                summary=rank_summary(fallback_text, query_text, 1),
                status="snippet-only",
            )

        page_title, page_text = extract_page_text(response.text)
        if len(page_text) < 160:
            fallback_text = " ".join([result.snippet, page_text, result.title])
            return WebResearchSource(
                title=page_title or result.title,
                url=str(response.url),
                snippet=result.snippet,
                summary=rank_summary(fallback_text, query_text, 1),
                status="snippet-only",
            )
        return WebResearchSource(
            title=page_title or result.title,
            url=str(response.url),
            snippet=result.snippet,
            summary=rank_summary(page_text, query_text, 3),
            status="read",
        )
    except Exception:
        return WebResearchSource(
            title=result.title,
            url=result.url,
            snippet=result.snippet,
            summary=rank_summary(result.snippet or result.title, query_text, 1),
            status="failed",
        )

def compare_with_context(context: list[str], web_text: str) -> list[str]:
    comparisons: list[str] = []
    web_terms = set(words(web_text))
    for index, memory in enumerate(context[:8], start=1):
        memory_terms = set(words(memory))
        overlap = sorted(web_terms.intersection(memory_terms))[:8]
        if not overlap:
            continue
        comparisons.append(
            f"Memória {index}: encontrou sobreposição com {', '.join(overlap)}. Rever localmente para confirmar alinhamento ou tensão."
        )
    return comparisons[:6]

@app.post("/api/v1/extract")
async def extract_knowledge(request: SessionRequest):
    """
    Endpoint puro para extração de conhecimento via NVIDIA NIM/HuggingFace.
    Não salva no banco de dados local (SQLite).
    Utilizado pelo frontend para persistência no Firebase.
    """
    nodes, links = kg_extractor.extract(request.text, "temp-session")
    return {
        "nodes": [{"id": n.id, "name": n.name, "val": n.val} for n in nodes],
        "links": [{"source": l.source, "target": l.target} for l in links]
    }

@app.post("/api/v1/web/research", response_model=WebResearchResponse)
async def research_web(request: WebResearchRequest):
    """
    Pesquisa pública controlada pelo utilizador.
    O backend só recebe contexto privado se o cliente o enviar depois de consentimento explícito.
    """
    query_text = normalize_text(request.query)
    if not query_text:
        raise HTTPException(status_code=400, detail="A query de pesquisa está vazia.")

    search_results = await search_public_web(query_text, request.max_sources)

    if search_results:
        async with httpx.AsyncClient(
            headers={"User-Agent": USER_AGENT},
            follow_redirects=True,
            timeout=httpx.Timeout(12.0),
        ) as client:
            sources = await asyncio.gather(*[
                fetch_research_source(client, result, query_text)
                for result in search_results
            ])
    else:
        sources = build_direct_search_sources(query_text, request.max_sources)

    combined_text = " ".join([source.summary for source in sources if source.summary])
    key_concepts = extract_concepts(f"{query_text} {combined_text}")
    summary = rank_summary(combined_text, query_text, 6) if combined_text else (
        f"Pesquisa preparada para '{query_text}'. Não foi possível ler resultados automaticamente, "
        "mas deixei fontes públicas diretas para continuar a investigação."
    )
    main_ideas = [
        f"{source.title}: {source.summary}"
        for source in sources
        if source.summary
    ][:5]
    suggested_memories = [
        f"Pesquisa web sobre {concept}: {summary[:220]}"
        for concept in key_concepts[:3]
    ]
    local_comparisons = compare_with_context(request.context, combined_text) if request.context else []

    return WebResearchResponse(
        query=query_text,
        mode=request.mode,
        summary=summary,
        key_concepts=key_concepts,
        main_ideas=main_ideas,
        suggested_memories=suggested_memories,
        sources=sources,
        local_comparisons=local_comparisons,
    )

def fallback_generated_text(prompt: str) -> str:
    topic = normalize_text(prompt)
    concepts = extract_concepts(topic, 6)
    concept_line = ", ".join(concepts) if concepts else "tema principal"

    if re.search(r"\b(frase curta|slogan|uma frase)\b", topic, re.IGNORECASE):
        return "Mnemosyne transforma memórias dispersas num universo vivo, pesquisável e pronto para agir."

    if re.search(r"\b(lista|checklist|passos)\b", topic, re.IGNORECASE):
        return "\n".join([
            f"Checklist para: {topic}",
            "",
            "1. Definir o objetivo em uma frase.",
            "2. Separar factos confirmados de hipóteses.",
            "3. Recolher fontes ou memórias relevantes.",
            "4. Criar uma ação concreta para o próximo passo.",
            "5. Guardar o resultado como memória ligada ao tema.",
        ])

    if re.search(r"\b(resumo|resumir|sumariza)\b", topic, re.IGNORECASE):
        return "\n".join([
            f"Resumo de trabalho sobre {concept_line}:",
            "",
            "O pedido aponta para organizar informação dispersa num formato curto e acionável. "
            "A versão final deve destacar o ponto central, as evidências principais e a próxima decisão prática.",
        ])

    return "\n".join([
        "Rascunho gerado a partir do pedido:",
        "",
        topic,
        "",
        "Estrutura sugerida:",
        f"1. Contexto: delimitar {concept_line} e explicar por que isto importa agora.",
        "2. Desenvolvimento: separar factos, hipóteses and próximos passos.",
        "3. Ação: transformar o resultado numa memória, plano ou checklist verificável.",
        "",
        "Próximo passo recomendado: revê este rascunho, ajusta o tom e guarda como memória se fizer sentido.",
    ])

VAULT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "vault"))

def ensure_vault():
    os.makedirs(VAULT_DIR, exist_ok=True)

def handle_write_local_note(filename: str, content: str) -> str:
    ensure_vault()
    safe_name = os.path.basename(filename)
    if not safe_name.endswith((".txt", ".md", ".json", ".csv")):
        safe_name += ".md"
    file_path = os.path.join(VAULT_DIR, safe_name)
    with open(file_path, "w", encoding="utf-8") as f:
        f.write(content)
    return f"Ficheiro '{safe_name}' gravado com sucesso localmente em Mnemosyne Vault."

def handle_read_local_note(filename: str) -> str:
    ensure_vault()
    safe_name = os.path.basename(filename)
    file_path = os.path.join(VAULT_DIR, safe_name)
    if not os.path.exists(file_path):
        return f"Erro: Ficheiro '{safe_name}' não existe no Vault."
    with open(file_path, "r", encoding="utf-8") as f:
        return f.read()

def handle_list_local_notes() -> str:
    ensure_vault()
    files = [f for f in os.listdir(VAULT_DIR) if os.path.isfile(os.path.join(VAULT_DIR, f))]
    if not files:
        return "Nenhum ficheiro de notas encontrado no Vault local."
    return "Ficheiros locais no Vault:\n" + "\n".join(files)

async def handle_search_web_tool(query: str) -> str:
    try:
        results = await search_public_web(query, max_sources=3)
        if not results:
            return "Nenhum resultado público encontrado para esta pesquisa."
        lines = []
        for r in results:
            lines.append(f"Título: {r.title}\nURL: {r.url}\nResumo: {r.snippet}\n")
        return "\n".join(lines)
    except Exception as e:
        return f"Erro na pesquisa web: {str(e)}"

# Definição de ferramentas locais para o Agente NVIDIA NIM
tools = [
    {
        "type": "function",
        "function": {
            "name": "write_local_note",
            "description": "Cria ou atualiza um ficheiro de texto (.txt ou .md) no diretório de notas local do Mnemosyne.",
            "parameters": {
                "type": "object",
                "properties": {
                    "filename": {"type": "string", "description": "Nome do ficheiro (ex: notas.md, checklist.txt)"},
                    "content": {"type": "string", "description": "Conteúdo de texto completo a escrever no ficheiro"}
                },
                "required": ["filename", "content"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "read_local_note",
            "description": "Lê o conteúdo completo de um ficheiro de texto existente no diretório de notas local.",
            "parameters": {
                "type": "object",
                "properties": {
                    "filename": {"type": "string", "description": "Nome do ficheiro a ler (ex: notas.md)"}
                },
                "required": ["filename"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "list_local_notes",
            "description": "Lista todos os ficheiros de notas disponíveis no diretório de notas local.",
            "parameters": {
                "type": "object",
                "properties": {}
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "search_web_tool",
            "description": "Pesquisa na internet pública para obter factos atualizados ou referências.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Termo de pesquisa a enviar para os motores de busca"}
                },
                "required": ["query"]
            }
        }
    }
]

async def generate_text_with_nvidia(prompt: str, requested_model: str | None, max_tokens: int) -> GenerationResponse:
    api_key = get_nvidia_api_key()
    if not api_key:
        raise RuntimeError("NVIDIA_API_KEY não configurada no backend.")

    model = requested_model if requested_model else os.getenv("NVIDIA_MODEL_CORE", "nvidia/nemotron-3-ultra-550b-a55b")
    
    # Inicializa o cliente apontando para a NVIDIA
    nvidia_client = OpenAI(
        base_url=os.getenv("NVIDIA_BASE_URL", "https://integrate.api.nvidia.com/v1"),
        api_key=api_key,
    )

    messages = [
        {
            "role": "system",
            "content": (
                "És o assistente executivo e motor cognitivo do Mnemosyne Cognitive OS. "
                "Tens acesso a ferramentas locais para gerir notas no disco rígido do utilizador (o Vault) "
                "e para pesquisar na web. Responde sempre em português europeu claro e profissional. "
                "Utiliza as ferramentas sempre que o utilizador te pedir para ler, escrever, listar notas, "
                "ou pesquisar por factos atualizados. Quando gravares uma nota, confirma o nome e o conteúdo."
            ),
        },
        {"role": "user", "content": prompt},
    ]

    extra_body = {
        "chat_template_kwargs": {"enable_thinking": True},
        "reasoning_budget": 2048
    }

    # Loop do Agente para resolver Tool Calls
    for _ in range(5):
        try:
            response = nvidia_client.chat.completions.create(
                model=model,
                messages=messages,
                tools=tools,
                tool_choice="auto",
                temperature=0.2,
                max_tokens=max_tokens,
                extra_body=extra_body if "nemotron" in model else None
            )
        except Exception as e:
            raise RuntimeError(f"Erro na API NVIDIA: {str(e)}")

        response_message = response.choices[0].message
        
        # Converte a resposta do assistente para dicionário
        assistant_message = {"role": "assistant"}
        if response_message.content:
            assistant_message["content"] = response_message.content
        if response_message.tool_calls:
            assistant_message["tool_calls"] = [
                {
                    "id": tc.id,
                    "type": "function",
                    "function": {
                        "name": tc.function.name,
                        "arguments": tc.function.arguments
                    }
                }
                for tc in response_message.tool_calls
            ]
        messages.append(assistant_message)

        if not response_message.tool_calls:
            final_text = response_message.content or ""
            return GenerationResponse(text=final_text, model=model, provider="nvidia")

        # Processa as chamadas de ferramentas
        for tool_call in response_message.tool_calls:
            function_name = tool_call.function.name
            function_args = json.loads(tool_call.function.arguments)
            
            print(f"[*] Agente Mnemosyne a executar ferramenta local: {function_name}({function_args})")
            
            tool_response = ""
            if function_name == "write_local_note":
                tool_response = handle_write_local_note(
                    filename=function_args.get("filename"),
                    content=function_args.get("content")
                )
            elif function_name == "read_local_note":
                tool_response = handle_read_local_note(
                    filename=function_args.get("filename")
                )
            elif function_name == "list_local_notes":
                tool_response = handle_list_local_notes()
            elif function_name == "search_web_tool":
                tool_response = await handle_search_web_tool(
                    query=function_args.get("query")
                )
            else:
                tool_response = f"Erro: Ferramenta '{function_name}' não suportada."

            # Adiciona a resposta da ferramenta à conversa
            messages.append({
                "tool_call_id": tool_call.id,
                "role": "tool",
                "name": function_name,
                "content": tool_response,
            })

    # Se atingiu o limite de iterações
    final_text = messages[-1].get("content", "") if isinstance(messages[-1], dict) else getattr(messages[-1], "content", "")
    return GenerationResponse(text=final_text, model=model, provider="nvidia")

async def generate_text_with_huggingface(prompt: str, requested_model: str | None, max_tokens: int) -> GenerationResponse:
    api_key = get_huggingface_api_key()
    if not api_key:
        raise RuntimeError("HUGGINGFACE_API_KEY/HF_TOKEN não configurada no backend.")

    model = requested_model if is_probably_huggingface_model(requested_model) else HUGGINGFACE_TEXT_MODEL_DEFAULT
    payload: dict[str, Any] = {
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": (
                    "És o assistente do Mnemosyne Cognitive OS. Responde em português europeu por defeito, "
                    "com texto útil, claro e pronto para o utilizador rever ou guardar como memória."
                ),
            },
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.4,
        "max_tokens": max_tokens,
        "stream": False,
    }

    async with httpx.AsyncClient(timeout=httpx.Timeout(60.0)) as client:
        response = await client.post(
            f"{HUGGINGFACE_API_BASE_URL}/v1/chat/completions",
            headers=bearer_json_headers(api_key),
            json=payload,
        )
        response.raise_for_status()
        data = response.json()

    text = extract_chat_completion_text(data)
    if not text:
        raise RuntimeError("A Hugging Face devolveu resposta vazia.")

    return GenerationResponse(text=text, model=model, provider="huggingface")

async def generate_image_with_huggingface(request: ImageGenerationRequest) -> ImageGenerationResponse:
    api_key = get_huggingface_api_key()
    if not api_key:
        raise RuntimeError("HUGGINGFACE_API_KEY/HF_TOKEN não configurada no backend.")

    model = request.model if request.model else HUGGINGFACE_IMAGE_MODEL_DEFAULT
    width, height = image_size_to_dimensions(request.size)
    payload: dict[str, Any] = {
        "inputs": normalize_text(request.prompt),
        "parameters": {
            "width": width,
            "height": height,
            "num_inference_steps": image_quality_to_steps(request.quality),
        },
    }
    negative_prompt = os.getenv("HUGGINGFACE_IMAGE_NEGATIVE_PROMPT")
    if negative_prompt:
        payload["parameters"]["negative_prompt"] = negative_prompt

    async with httpx.AsyncClient(timeout=httpx.Timeout(120.0)) as client:
        response = await client.post(
            f"{HUGGINGFACE_API_BASE_URL}/{HUGGINGFACE_IMAGE_PROVIDER}/models/{model}",
            headers=bearer_json_headers(api_key),
            json=payload,
        )

    if not response.is_success:
        detail = response.text[:500]
        raise RuntimeError(f"Hugging Face imagem falhou: {response.status_code} {detail}")

    content_type = response.headers.get("content-type", "image/png").split(";")[0].strip() or "image/png"
    if "application/json" in content_type:
        detail = response.text[:500]
        raise RuntimeError(f"Hugging Face não devolveu bytes de imagem: {detail}")

    return ImageGenerationResponse(
        image_base64=base64.b64encode(response.content).decode("ascii"),
        image_url=None,
        media_type=content_type,
        model=model,
        provider="huggingface",
        revised_prompt=None,
    )

async def generate_image_with_nvidia(request: ImageGenerationRequest) -> ImageGenerationResponse:
    api_key = get_nvidia_api_key()
    if not api_key:
        raise RuntimeError("NVIDIA_API_KEY não configurada no backend.")

    # NVIDIA NIM image models (standard SDXL endpoint)
    model = request.model if request.model else "stabilityai/stable-diffusion-xl"
    url = f"https://ai.api.nvidia.com/v1/genai/{model}"
    
    payload = {
        "text_prompts": [{"text": normalize_text(request.prompt), "weight": 1}],
        "cfg_scale": 7,
        "steps": 25,
        "samples": 1
    }

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Accept": "application/json"
    }

    async with httpx.AsyncClient(timeout=httpx.Timeout(120.0)) as client:
        response = await client.post(
            url,
            headers=headers,
            json=payload,
        )

    if not response.is_success:
        detail = response.text[:500]
        raise RuntimeError(f"NVIDIA NIM imagem falhou: {response.status_code} {detail}")

    data = response.json()
    artifacts = data.get("artifacts", [])
    if not artifacts:
        raise RuntimeError(f"NVIDIA NIM não devolveu artefatos de imagem: {response.text[:500]}")

    image_base64 = artifacts[0].get("base64")
    if not image_base64:
        raise RuntimeError("NVIDIA NIM devolveu resposta sem dados base64.")

    return ImageGenerationResponse(
        image_base64=image_base64,
        image_url=None,
        media_type="image/png",
        model=model,
        provider="nvidia",
        revised_prompt=None,
    )

@app.post("/api/v1/generate", response_model=GenerationResponse)
async def generate_text(request: GenerationRequest):
    prompt = normalize_text(request.prompt)
    if not prompt:
        raise HTTPException(status_code=400, detail="O prompt está vazio.")

    warnings: list[str] = []

    # Tenta NVIDIA NIM se a chave estiver configurada
    if get_nvidia_api_key():
        try:
            return await generate_text_with_nvidia(prompt, request.model, request.max_tokens)
        except Exception as error:
            warnings.append(f"NVIDIA NIM: {str(error)[:180]}")

    # Fallback para Hugging Face
    if get_huggingface_api_key():
        try:
            return await generate_text_with_huggingface(prompt, request.model, request.max_tokens)
        except Exception as error:
            warnings.append(f"Hugging Face: {str(error)[:180]}")

    return GenerationResponse(
        text=fallback_generated_text(prompt),
        model=request.model or HUGGINGFACE_TEXT_MODEL_DEFAULT,
        provider="local-fallback",
        warning=" | ".join(warnings + ["Sem provider cloud disponível."]),
    )

@app.post("/api/v1/images/generate", response_model=ImageGenerationResponse)
async def generate_image(request: ImageGenerationRequest):
    prompt = normalize_text(request.prompt)
    if not prompt:
        raise HTTPException(status_code=400, detail="O prompt está vazio.")

    warnings: list[str] = []

    # Tenta NVIDIA NIM se a chave estiver configurada
    if get_nvidia_api_key():
        try:
            return await generate_image_with_nvidia(request)
        except Exception as error:
            warnings.append(f"NVIDIA NIM: {str(error)[:220]}")

    # Fallback para Hugging Face
    if get_huggingface_api_key():
        try:
            return await generate_image_with_huggingface(request)
        except Exception as error:
            warnings.append(f"Hugging Face: {str(error)[:220]}")

    raise HTTPException(
        status_code=503,
        detail="Nenhum provider de imagem conseguiu gerar o resultado. " + " | ".join(warnings),
    )

@app.post("/sessions")
async def create_session(request: SessionRequest, db: Session = Depends(get_session)):
    new_session = MemorySession(
        id=str(uuid.uuid4()),
        timestamp=time.time(),
        title="Memória: " + request.text[:20] + "..."
    )
    db.add(new_session)
    db.commit()
    db.refresh(new_session)
    
    # Process the text to extract KG
    process_memory(new_session.id, request.text, db)
    
    return {"session": new_session, "message": "Memória guardada e grafo atualizado."}

@app.get("/health")
async def health_check():
    return {"status": "ok"}
