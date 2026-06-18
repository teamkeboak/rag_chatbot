"""
Context packer — selects, orders, and trims the best chunks before sending to Person 3.

Ordering (from "Lost in the Middle" paper):
  1. Official business rule  (priority 1)
  2. KPI glossary            (priority 2)
  3. Schema / data dict      (priority 3-4)
  4. Approved SQL example    (priority 5)
  5. Policy / other          (priority 7+)

Position-aware trick: the most important chunk is also appended at the end
so the LLM attends to it even in a long context window.
"""

_TYPE_ORDER: dict[str, int] = {
    "business_rule": 1,
    "glossary": 2,
    "schema": 3,
    "sql_example": 4,
    "policy": 5,
}

MAX_CHUNKS = 8
MAX_CHARS = 5500  # keeps total context well within 8192-token window


def pack_context(ranked_chunks: list[dict], question_type: str = "sql_analytics") -> list[dict]:
    """
    Returns an ordered list of context dicts ready for Person 3.
    Each dict: { text, source, document_type, section, priority, confidence }
    """
    seen: set[str] = set()
    packed: list[dict] = []
    total_chars = 0

    def sort_key(c: dict) -> tuple:
        doc_type = c.get("metadata", {}).get("document_type", "zzz")
        type_rank = _TYPE_ORDER.get(doc_type, 6)
        # Section summaries go after detail chunks of the same type
        is_summary = int(c.get("metadata", {}).get("chunk_type", "") == "section_summary")
        return (type_rank, is_summary, -c.get("final_score", 0.0))

    for chunk in sorted(ranked_chunks, key=sort_key):
        text = chunk.get("text", "").strip()
        if not text or text in seen:
            continue
        if len(packed) >= MAX_CHUNKS:
            break
        if total_chars + len(text) > MAX_CHARS:
            break

        seen.add(text)
        meta = chunk.get("metadata", {})
        packed.append({
            "text": text,
            "source": meta.get("source_file", ""),
            "document_type": meta.get("document_type", ""),
            "section": meta.get("section", ""),
            "priority": chunk.get("source_priority", 9),
            "confidence": round(min(chunk.get("final_score", 0.0) * 2.5, 0.99), 3),
        })
        total_chars += len(text)

    # Position-aware: repeat the top-priority chunk at the end for LLM attention
    if len(packed) > 3:
        anchor = {**packed[0], "_anchor": True}
        packed.append(anchor)

    return packed


def compute_quality_score(packed: list[dict]) -> float:
    real = [c for c in packed if not c.get("_anchor")]
    if not real:
        return 0.0
    avg_conf = sum(c.get("confidence", 0) for c in real) / len(real)
    type_diversity = len({c.get("document_type") for c in real})
    diversity_bonus = min(type_diversity * 0.04, 0.20)
    return round(min(avg_conf + diversity_bonus, 1.0), 3)
