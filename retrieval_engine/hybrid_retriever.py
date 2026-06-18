"""
Hybrid retriever — ChromaDB vector search + BM25 keyword search,
merged with Reciprocal Rank Fusion (RRF).

BM25 catches exact banking terms (PAR30, NPL, DPD, WriteOffBalance) that
semantic search may miss when the question is phrased differently.
"""
from rank_bm25 import BM25Okapi
from embedding_service import embed_text
from vector_store import query_collection, get_all

_DOCUMENT_TYPE_MAP: dict[str, list[str]] = {
    "business_rule": ["business_rule"],
    "glossary": ["glossary"],
    "schema_mapping": ["schema"],
    "sql_example": ["sql_example"],
    "anomaly_rule": ["schema", "business_rule"],
    "dq_rule": ["schema", "business_rule"],
    "uploaded_doc": ["uploaded_doc"],
}


def _rrf(ranked_a: list[str], ranked_b: list[str], k: int = 60) -> dict[str, float]:
    scores: dict[str, float] = {}
    for rank, doc_id in enumerate(ranked_a):
        scores[doc_id] = scores.get(doc_id, 0.0) + 1.0 / (k + rank + 1)
    for rank, doc_id in enumerate(ranked_b):
        scores[doc_id] = scores.get(doc_id, 0.0) + 1.0 / (k + rank + 1)
    return scores


def hybrid_retrieve(
    query: str,
    retrieval_needed: list[str],
    n_results: int = 20,
) -> list[dict]:
    # Resolve allowed document types from retrieval_needed
    allowed_types: set[str] = set()
    for need in retrieval_needed:
        allowed_types.update(_DOCUMENT_TYPE_MAP.get(need, [need]))

    # --- Vector search ---
    embedding = embed_text(query)
    where_filter = {
        "$and": [
            {"status": {"$eq": "approved"}},
            {"can_use_for_official_answer": {"$eq": "True"}},
        ]
    }
    v_results = query_collection(embedding, n_results=n_results, where=where_filter)

    vector_ids: list[str] = v_results["ids"][0] if v_results["ids"] else []
    vector_docs: list[str] = v_results["documents"][0] if v_results["documents"] else []
    vector_metas: list[dict] = v_results["metadatas"][0] if v_results["metadatas"] else []
    vector_distances: list[float] = v_results["distances"][0] if v_results["distances"] else []

    # Build lookup keyed by chunk_id
    lookup: dict[str, dict] = {}
    for i, cid in enumerate(vector_ids):
        lookup[cid] = {
            "chunk_id": cid,
            "text": vector_docs[i],
            "metadata": vector_metas[i],
            "vector_score": 1.0 - vector_distances[i],
            "bm25_score": 0.0,
        }

    # --- BM25 keyword search over full corpus ---
    corpus = get_all(include=["documents", "metadatas"])
    all_texts: list[str] = corpus.get("documents") or []
    all_metas: list[dict] = corpus.get("metadatas") or []
    all_ids: list[str] = [m.get("chunk_id", f"_{i}") for i, m in enumerate(all_metas)]

    bm25_ids: list[str] = []
    if all_texts:
        tokenized = [t.lower().split() for t in all_texts]
        bm25 = BM25Okapi(tokenized)
        bm25_scores = bm25.get_scores(query.lower().split())
        ranked = sorted(enumerate(bm25_scores), key=lambda x: x[1], reverse=True)

        for idx, score in ranked[:n_results]:
            if score <= 0:
                break
            meta = all_metas[idx]
            if meta.get("status") != "approved":
                continue
            cid = all_ids[idx]
            bm25_ids.append(cid)
            if cid not in lookup:
                lookup[cid] = {
                    "chunk_id": cid,
                    "text": all_texts[idx],
                    "metadata": meta,
                    "vector_score": 0.0,
                    "bm25_score": score,
                }
            else:
                lookup[cid]["bm25_score"] = score

    # --- RRF merge ---
    rrf_scores = _rrf(vector_ids, bm25_ids)

    # Score, filter by type, sort
    results: list[dict] = []
    for cid, rrf_score in sorted(rrf_scores.items(), key=lambda x: x[1], reverse=True):
        doc = lookup.get(cid)
        if not doc:
            continue
        doc_type = doc["metadata"].get("document_type", "")
        if allowed_types and doc_type not in allowed_types:
            continue
        doc["rrf_score"] = rrf_score
        results.append(doc)

    return results[:n_results]
