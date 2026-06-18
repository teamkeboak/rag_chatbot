"""
Reranker — combines RRF score with source trust multiplier.

Trust multiplier is derived from source_priority.yaml:
lower priority number = higher multiplier (more trusted).

Unlike a hand-tuned weighted formula, this respects the governance decision
from Person 1: approved sources always outrank uploaded notes even if the
uploaded note has higher semantic similarity.
"""
import yaml
from pathlib import Path
from functools import lru_cache

_SOURCE_PRIORITY_FILE = Path(__file__).parent.parent / "metadata" / "source_priority.yaml"


@lru_cache(maxsize=1)
def _load_priorities() -> dict:
    if not _SOURCE_PRIORITY_FILE.exists():
        return {}
    with open(_SOURCE_PRIORITY_FILE, encoding="utf-8") as f:
        return yaml.safe_load(f).get("documents", {})


def rerank(candidates: list[dict]) -> list[dict]:
    """
    Re-score each candidate chunk and return sorted by final_score descending.

    final_score = (0.6 * rrf_score + 0.4 * vector_score) * trust_multiplier
    """
    priorities = _load_priorities()
    max_priority = max((v.get("priority", 9) for v in priorities.values()), default=9)

    for doc in candidates:
        source_file = doc.get("metadata", {}).get("source_file", "")
        priority = priorities.get(source_file, {}).get("priority", 9)

        # trust_multiplier: priority=1 → 1.0, priority=9 → ~0.11 (for max_priority=9)
        trust_multiplier = (max_priority - priority + 1) / max_priority

        rrf = doc.get("rrf_score", 0.0)
        vec = doc.get("vector_score", 0.0)

        doc["final_score"] = (0.6 * rrf + 0.4 * vec) * trust_multiplier
        doc["trust_multiplier"] = round(trust_multiplier, 3)
        doc["source_priority"] = priority

    return sorted(candidates, key=lambda x: x.get("final_score", 0.0), reverse=True)
