"""
Retrieval audit logger — appends one JSONL record per retrieve_context() call
to logs/retrieval_audit.jsonl for Person 4 evaluation.
"""
import json
from datetime import datetime, timezone
from pathlib import Path

_LOG_DIR = Path(__file__).parent.parent / "logs"


def log_retrieval(
    user_question: str,
    rewritten_query: str,
    question_type: str,
    recommended_action: str,
    chunks_retrieved: int,
    chunks_selected: int,
    sources_used: list[str],
    conflict_detected: bool,
    conflicts: list[dict],
    context_quality_score: float,
    retrieval_time_ms: int,
) -> None:
    _LOG_DIR.mkdir(exist_ok=True)
    entry = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "user_question": user_question,
        "rewritten_query": rewritten_query[:300],
        "question_type": question_type,
        "recommended_action": recommended_action,
        "chunks_retrieved": chunks_retrieved,
        "chunks_selected": chunks_selected,
        "sources_used": sorted(set(sources_used)),
        "conflict_detected": conflict_detected,
        "conflicts": conflicts,
        "context_quality_score": context_quality_score,
        "retrieval_time_ms": retrieval_time_ms,
    }
    log_file = _LOG_DIR / "retrieval_audit.jsonl"
    with open(log_file, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")
