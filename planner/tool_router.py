"""
Maps classified question type → retrieval strategy for Person 2.
"""

ROUTING: dict[str, dict] = {
    "definition": {
        "recommended_action": "rag_only",
        "retrieval_needed": ["business_rule", "glossary"],
        "sql_needed": False,
    },
    "sql_analytics": {
        "recommended_action": "rag_plus_sql",
        "retrieval_needed": ["business_rule", "schema_mapping", "sql_example"],
        "sql_needed": True,
    },
    "data_quality": {
        "recommended_action": "rag_plus_dq",
        "retrieval_needed": ["business_rule", "schema_mapping", "dq_rule"],
        "sql_needed": True,
    },
    "anomaly_root_cause": {
        "recommended_action": "rag_plus_anomaly_sql",
        "retrieval_needed": ["business_rule", "anomaly_rule", "schema_mapping", "sql_example"],
        "sql_needed": True,
    },
    "uploaded_doc_qa": {
        "recommended_action": "temporary_rag",
        "retrieval_needed": ["uploaded_doc"],
        "sql_needed": False,
    },
    "unsafe": {
        "recommended_action": "block",
        "retrieval_needed": [],
        "sql_needed": False,
    },
}


def route(question_type: str) -> dict:
    return ROUTING.get(question_type, ROUTING["sql_analytics"])
