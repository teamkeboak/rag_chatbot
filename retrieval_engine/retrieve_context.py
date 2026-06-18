"""
Person 2 main entry point — FastAPI service on :8001.

Endpoints:
  POST /retrieve   — full pipeline: plan → rewrite → retrieve → rerank → pack
  POST /plan       — Person 1 classification only (no retrieval)
  GET  /health     — liveness check

Start with:
    cd retrieval_engine
    uvicorn retrieve_context:app --host 0.0.0.0 --port 8001

server.js calls POST http://localhost:8001/retrieve instead of getMetadataContext().
"""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parent.parent / "planner"))

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from question_classifier import classify
from tool_router import route
from query_rewriter import rewrite_query
from hybrid_retriever import hybrid_retrieve
from reranker import rerank
from conflict_detector import detect_conflicts
from context_packer import pack_context, compute_quality_score
from retrieval_audit_logger import log_retrieval

app = FastAPI(title="Banking RAG Retrieval Engine", version="1.0.0")


# ── Request models ────────────────────────────────────────────────────────────

class RetrieveRequest(BaseModel):
    user_question: str
    mode: str = "sql"
    # Optional: pre-classified plan from Person 1
    question_type: str | None = None
    recommended_action: str | None = None
    retrieval_needed: list[str] | None = None
    sql_needed: bool = False
    safety_status: str = "safe"


class PlanRequest(BaseModel):
    user_question: str
    mode: str = "sql"


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/plan")
def plan_only(req: PlanRequest) -> dict:
    """Person 1 classification — returns agent plan without doing retrieval."""
    q_type = classify(req.user_question)
    routing = route(q_type)
    return {
        "user_question": req.user_question,
        "question_type": q_type,
        "recommended_action": routing["recommended_action"],
        "retrieval_needed": routing["retrieval_needed"],
        "sql_needed": routing["sql_needed"],
        "safety_status": "blocked" if q_type == "unsafe" else "safe",
        "mode": req.mode,
    }


@app.post("/retrieve")
def retrieve(req: RetrieveRequest) -> dict:
    """
    Full Person 2 pipeline:
      classify → rewrite (HyDE) → hybrid retrieve → rerank → conflict detect → pack context
    """
    start = time.time()

    # 1. Classify if not pre-classified by Person 1
    q_type = req.question_type or classify(req.user_question)
    routing = route(q_type)

    # 2. Block unsafe questions immediately
    effective_status = req.safety_status if req.question_type else (
        "blocked" if q_type == "unsafe" else "safe"
    )
    if effective_status == "blocked":
        return {
            "user_question": req.user_question,
            "question_type": q_type,
            "recommended_action": "block",
            "retrieved_context": [],
            "conflict_detected": False,
            "conflicts": [],
            "context_quality_score": 0.0,
            "retrieval_time_ms": int((time.time() - start) * 1000),
            "blocked": True,
        }

    retrieval_needed = req.retrieval_needed or routing["retrieval_needed"]
    recommended_action = req.recommended_action or routing["recommended_action"]

    # 3. HyDE query rewriting
    rewritten = rewrite_query(req.user_question, mode=req.mode)

    # 4. Hybrid retrieval (vector + BM25 + RRF)
    candidates = hybrid_retrieve(rewritten, retrieval_needed, n_results=20)

    # 5. Rerank by trust-weighted score
    ranked = rerank(candidates)

    # 6. Conflict detection across top chunks
    conflict_result = detect_conflicts(ranked[:12])

    # 7. Context packing — ordered, trimmed, position-aware
    packed = pack_context(ranked, q_type)
    quality = compute_quality_score(packed)

    elapsed_ms = int((time.time() - start) * 1000)

    # 8. Audit log
    real_packed = [c for c in packed if not c.get("_anchor")]
    log_retrieval(
        user_question=req.user_question,
        rewritten_query=rewritten,
        question_type=q_type,
        recommended_action=recommended_action,
        chunks_retrieved=len(candidates),
        chunks_selected=len(real_packed),
        sources_used=[c["source"] for c in real_packed],
        conflict_detected=conflict_result["conflict_detected"],
        conflicts=conflict_result.get("conflicts", []),
        context_quality_score=quality,
        retrieval_time_ms=elapsed_ms,
    )

    return {
        "user_question": req.user_question,
        "question_type": q_type,
        "recommended_action": recommended_action,
        "sql_needed": routing["sql_needed"],
        "retrieved_context": packed,
        "conflict_detected": conflict_result["conflict_detected"],
        "conflicts": conflict_result.get("conflicts", []),
        "context_quality_score": quality,
        "retrieval_time_ms": elapsed_ms,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001, reload=False)
