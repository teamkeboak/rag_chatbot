"""
Query rewriter — True HyDE (Hypothetical Document Embeddings).

Instead of keyword expansion, asks the local LLM to write a short hypothetical
expert answer, then concatenates it with the original question for retrieval.
This dramatically improves recall for vague queries like "risk up today".
"""
import os
import httpx

OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")
_DEFAULT_MODEL = "qwen2.5-coder:3b"

_PROMPT_TEMPLATE = """\
You are a senior banking data warehouse analyst.
Write a concise, technical answer to the question below using correct banking terms,
KPI names (PAR30, PAR60, PAR90, NPL, DPD, WriteOffBalance, RecoveryAmount),
and SQL view names (VW_LOAN_PORTFOLIO_DAILY, VW_DAILY_KPI_SUMMARY, etc.) where relevant.
Keep it under 120 words. Do not say "I don't know".

Question: {question}

Answer:"""


def rewrite_query(user_question: str, mode: str = "sql") -> str:
    """
    Generate a hypothetical expert answer and combine it with the original question.
    Falls back to the original question if Ollama is unavailable.
    """
    model = _DEFAULT_MODEL if mode == "sql" else "gemma4:e4b-it-q4_K_M"
    prompt = _PROMPT_TEMPLATE.format(question=user_question.strip())

    try:
        resp = httpx.post(
            f"{OLLAMA_HOST}/api/generate",
            json={
                "model": model,
                "prompt": prompt,
                "stream": False,
                "options": {"num_predict": 150, "temperature": 0.1},
            },
            timeout=20.0,
        )
        resp.raise_for_status()
        hypothetical = resp.json().get("response", "").strip()
        if hypothetical:
            return f"{user_question} {hypothetical}"
    except Exception:
        pass  # graceful fallback

    return user_question
