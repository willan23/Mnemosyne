from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import Session, select
from models import engine, create_db_and_tables, MemorySession, MemoryNode, MemoryLink
import time
import uuid

app = FastAPI(title="Mnemosyne (Echoes) API")

@app.on_event("startup")
def on_startup():
    create_db_and_tables()

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
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

from kg_engine import kg_extractor

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

@app.post("/sessions")
async def create_session(text: str = "Início da jornada Mnemosyne. Design e E2EE são fundamentais.", db: Session = Depends(get_session)):
    new_session = MemorySession(
        id=str(uuid.uuid4()),
        timestamp=time.time(),
        title="Memória: " + text[:20] + "..."
    )
    db.add(new_session)
    db.commit()
    db.refresh(new_session)
    
    # Process the text to extract KG
    process_memory(new_session.id, text, db)
    
    return {"session": new_session, "message": "Memória guardada e grafo atualizado."}



@app.get("/health")
async def health_check():
    return {"status": "ok"}
