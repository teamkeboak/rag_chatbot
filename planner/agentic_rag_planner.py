"""
Agentic RAG Planner (Person 1 main entry point).

Receives a user question + mode, returns the agent plan dict for Person 2.

Usage:
    from planner.agentic_rag_planner import plan
    agent_plan = plan("Why did PAR 90 increase?", mode="sql")
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from question_classifier import classify
from tool_router import route


def plan(user_question: str, mode: str = "sql") -> dict:
    """
    Returns:
        {
          user_question, question_type, recommended_action,
          retrieval_needed, sql_needed, safety_status, mode
        }
    """
    question_type = classify(user_question)
    routing = route(question_type)

    return {
        "user_question": user_question,
        "question_type": question_type,
        "recommended_action": routing["recommended_action"],
        "retrieval_needed": routing["retrieval_needed"],
        "sql_needed": routing["sql_needed"],
        "safety_status": "blocked" if question_type == "unsafe" else "safe",
        "mode": mode,
    }


if __name__ == "__main__":
    import json
    q = " ".join(sys.argv[1:]) or "Which branch has the highest PAR 30?"
    print(json.dumps(plan(q), indent=2, ensure_ascii=False))
