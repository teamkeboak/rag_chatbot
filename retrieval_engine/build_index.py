"""
Build (or incrementally update) the ChromaDB vector index from approved metadata docs.

Usage:
    python build_index.py            # index only changed files
    python build_index.py --force    # re-index all files

Reads from:
  - metadata/          (existing approved docs: business_rules, kpi_glossary, etc.)
  - metadata/approved_kb/  (new docs: data_dictionary, schema_relationships)

Run once before starting the retrieval service, then re-run after editing any metadata file.
"""
import sys
import json
import hashlib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import yaml
from chunker import chunk_markdown
from embedding_service import embed_text
from vector_store import upsert_chunks, delete_by_source, collection_count

_ROOT = Path(__file__).parent.parent
_METADATA_DIRS = [
    _ROOT / "metadata",
    _ROOT / "metadata" / "approved_kb",
]
_SOURCE_PRIORITY = _ROOT / "metadata" / "source_priority.yaml"
_HASH_CACHE = _ROOT / "chroma_db" / ".index_hashes.json"


def _load_priorities() -> dict:
    if not _SOURCE_PRIORITY.exists():
        return {}
    with open(_SOURCE_PRIORITY, encoding="utf-8") as f:
        return yaml.safe_load(f).get("documents", {})


def _file_hash(path: Path) -> str:
    return hashlib.md5(path.read_bytes()).hexdigest()


def _load_cache() -> dict:
    if _HASH_CACHE.exists():
        return json.loads(_HASH_CACHE.read_text(encoding="utf-8"))
    return {}


def _save_cache(cache: dict) -> None:
    _HASH_CACHE.parent.mkdir(parents=True, exist_ok=True)
    _HASH_CACHE.write_text(json.dumps(cache, indent=2), encoding="utf-8")


def build_index(force: bool = False) -> None:
    priorities = _load_priorities()
    hash_cache = _load_cache()

    # Collect all .md files from both directories (deduplicate by filename)
    seen_names: set[str] = set()
    md_files: list[Path] = []
    for d in _METADATA_DIRS:
        if d.is_dir():
            for f in sorted(d.glob("*.md")):
                if f.name not in seen_names:
                    seen_names.add(f.name)
                    md_files.append(f)

    total_chunks = 0
    skipped = 0

    for md_file in md_files:
        fname = md_file.name
        current_hash = _file_hash(md_file)

        if not force and hash_cache.get(fname) == current_hash:
            skipped += 1
            continue

        doc_meta = priorities.get(fname, {})
        document_type = doc_meta.get("document_type", "document")
        priority = doc_meta.get("priority", 9)
        status = doc_meta.get("status", "pending")
        trust_level = doc_meta.get("trust_level", "low")
        can_use = doc_meta.get("can_use_for_official_answer", False)

        text = md_file.read_text(encoding="utf-8")
        raw_chunks = chunk_markdown(text, fname, document_type)

        # Remove stale entries for this file before re-inserting
        delete_by_source(fname)

        chunks_to_store: list[dict] = []
        embeddings: list[list[float]] = []

        for i, chunk in enumerate(raw_chunks):
            chunk_text = chunk["chunk_text"].strip()
            if not chunk_text:
                continue

            chunk_id = f"{fname}_{i:04d}"
            try:
                vec = embed_text(chunk_text)
            except Exception as e:
                print(f"    [WARN] embed failed for chunk {chunk_id}: {e}")
                continue

            chunks_to_store.append({
                "chunk_id": chunk_id,
                "chunk_text": chunk_text,
                "source_file": fname,
                "document_type": document_type,
                "section": chunk.get("parent_section", ""),
                "chunk_type": chunk.get("chunk_type", "text"),
                "priority": priority,
                "status": status,
                "trust_level": trust_level,
                "can_use_for_official_answer": str(can_use),
            })
            embeddings.append(vec)

        if chunks_to_store:
            upsert_chunks(chunks_to_store, embeddings)

        hash_cache[fname] = current_hash
        total_chunks += len(chunks_to_store)
        print(f"  [OK] {fname}: {len(chunks_to_store)} chunks  (type={document_type}, priority={priority})")

    _save_cache(hash_cache)
    print(f"\nDone. {total_chunks} chunks indexed, {skipped} files skipped (unchanged).")
    print(f"Total vectors in DB: {collection_count()}")


if __name__ == "__main__":
    force = "--force" in sys.argv
    if force:
        print("Force mode: re-indexing all files.\n")
    build_index(force=force)
