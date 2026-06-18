"""
ChromaDB persistent vector store wrapper.
DB is stored at <project_root>/chroma_db/
"""
from pathlib import Path
import chromadb

_DB_PATH = Path(__file__).parent.parent / "chroma_db"
_client: chromadb.ClientAPI | None = None
_collection: chromadb.Collection | None = None


def get_collection() -> chromadb.Collection:
    global _client, _collection
    if _collection is not None:
        return _collection
    _client = chromadb.PersistentClient(path=str(_DB_PATH))
    _collection = _client.get_or_create_collection(
        name="banking_kb",
        metadata={"hnsw:space": "cosine"},
    )
    return _collection


def upsert_chunks(chunks: list[dict], embeddings: list[list[float]]) -> None:
    col = get_collection()
    col.upsert(
        ids=[c["chunk_id"] for c in chunks],
        embeddings=embeddings,
        documents=[c["chunk_text"] for c in chunks],
        metadatas=[{k: v for k, v in c.items() if k not in ("chunk_text",)} for c in chunks],
    )


def query_collection(
    embedding: list[float],
    n_results: int = 15,
    where: dict | None = None,
) -> dict:
    col = get_collection()
    kwargs: dict = {
        "query_embeddings": [embedding],
        "n_results": min(n_results, col.count() or 1),
        "include": ["documents", "metadatas", "distances"],
    }
    if where:
        kwargs["where"] = where
    return col.query(**kwargs)


def get_all(include: list[str] | None = None) -> dict:
    col = get_collection()
    return col.get(include=include or ["documents", "metadatas"])


def delete_by_source(source_file: str) -> None:
    col = get_collection()
    try:
        col.delete(where={"source_file": {"$eq": source_file}})
    except Exception:
        pass


def collection_count() -> int:
    return get_collection().count()
