"""
Embedding service — uses Ollama nomic-embed-text (local, no external API).

Pull the model once:  ollama pull nomic-embed-text
"""
import os
import httpx

OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")
EMBED_MODEL = os.getenv("EMBED_MODEL", "nomic-embed-text")


def embed_text(text: str) -> list[float]:
    """Embed a single text string. Returns a float vector."""
    resp = httpx.post(
        f"{OLLAMA_HOST}/api/embeddings",
        json={"model": EMBED_MODEL, "prompt": text},
        timeout=30.0,
    )
    resp.raise_for_status()
    return resp.json()["embedding"]


def embed_batch(texts: list[str]) -> list[list[float]]:
    """Embed multiple texts sequentially (Ollama has no batch endpoint)."""
    return [embed_text(t) for t in texts]
