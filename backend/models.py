from typing import List, Optional
from sqlmodel import Field, Relationship, SQLModel, create_engine, Session

class MemoryNode(SQLModel, table=True):
    id: str = Field(primary_key=True)
    name: str
    val: int = 1
    session_id: Optional[str] = Field(default=None, foreign_key="memorysession.id")

class MemoryLink(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    source: str
    target: str
    session_id: Optional[str] = Field(default=None, foreign_key="memorysession.id")

class MemorySession(SQLModel, table=True):
    id: str = Field(primary_key=True)
    timestamp: float
    title: Optional[str] = None
    encrypted_audio_url: Optional[str] = None
    
# Database Setup
sqlite_url = "sqlite:///./mnemosyne.db"
engine = create_engine(sqlite_url)

def create_db_and_tables():
    SQLModel.metadata.create_all(engine)
