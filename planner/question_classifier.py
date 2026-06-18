"""
Question classifier — rule-based first, no LLM needed for speed.
Returns one of: definition | sql_analytics | data_quality | anomaly_root_cause |
                uploaded_doc_qa | unsafe
"""
import re
from typing import Literal

QuestionType = Literal[
    "definition",
    "sql_analytics",
    "data_quality",
    "anomaly_root_cause",
    "uploaded_doc_qa",
    "unsafe",
]

_UNSAFE = [
    r"\bdelete\b",
    r"\bdrop\b",
    r"\btruncate\b",
    r"\bupdate\s+\w",
    r"\binsert\s+into\b",
    r"\bexec(ute)?\b",
    r"customer\s+phone",
    r"customer\s+password",
    r"show\s+(me\s+)?all\s+customer",
    r"ignore\s+(previous|prior|all)\s+instructions?",
    r"reveal\s+(system|hidden|your|the)\s+prompt",
    r"you\s+are\s+now\s+",
    r"act\s+as\s+if\s+you",
    r"pretend\s+(you\s+are|to\s+be)",
    r"disregard\s+(your|all|previous)",
    r"source\s+database",
    r"staging\s+database",
    r"\bFLEXCUBE\b",
    r"\bSRC_\w+",
    r"\bSTG_\w+",
]

_ANOMALY = [
    r"\bwhy\b.{0,60}\b(increase|decrease|spike|drop|surge|fell|risen|went\s+up|went\s+down)\b",
    r"\b(increase|decrease|spike|drop|surge|fall|risen)\b.{0,60}\b(PAR|NPL|DPD|overdue|anomaly)\b",
    r"\banomaly\b",
    r"\babnormal\b",
    r"\bunusual\s+(trend|movement|change|increase|decrease)\b",
    r"\broot.?cause\b",
    r"\bwhat\s+caused\b",
    r"\bwhy\s+(did|is|are|was|were)\b.{0,60}\b(PAR|NPL|DPD|overdue|write.?off|recovery)\b",
]

_DATA_QUALITY = [
    r"\bdata\s+quality\b",
    r"\bDQ\s+(rule|score|check|result|fail|summar)\b",
    r"\bDQ\b.{0,30}\b(fail|pass|score|result)\b",
    r"\bquality\s+(score|rule|check|fail|result|dashboard)\b",
    r"\bfailed\s+rule\b",
    r"\bcompleteness\b",
    r"\bvalidity\b",
    r"\bconsistency\b",
    r"\btimeliness\b",
    r"\bpipeline\s+(run|status|monitor|fail)\b",
    r"\betl\s+(status|fail|run|monitor)\b",
]

_DEFINITION = [
    r"\bwhat\s+is\b",
    r"\bwhat\s+are\b.{0,40}\b(DPD|PAR|NPL|KPI|write.?off|recovery|overdue)\b",
    r"\bdefine\b",
    r"\bmeaning\s+of\b",
    r"\bexplain\b.{0,40}\b(DPD|PAR|NPL|KPI|formula|calculation|rule)\b",
    r"\bhow\s+is\b.{0,40}\b(calculated|defined|computed|measured)\b",
    r"\bwhat\s+does\b.{0,40}\b(mean|stand\s+for|represent)\b",
    r"\bformula\s+for\b",
    r"\bdefinition\s+of\b",
]

_SQL_ANALYTICS = [
    r"\bshow\b",
    r"\blist\b",
    r"\bwhich\b",
    r"\btop\s+\d+\b",
    r"\bhow\s+many\b",
    r"\bcompare\b",
    r"\breport\b",
    r"\bgenerate\s+(a\s+)?(query|sql|select)\b",
    r"\bwrite\s+(a\s+)?(query|sql|select)\b",
    r"\bgive\s+me\s+(a\s+)?(query|sql|report)\b",
    r"\bquery\b",
    r"\bSQL\b",
    r"\bSELECT\b",
    r"\bbranch\s+(with|has|having)\b",
    r"\bproduct\s+(with|has|having)\b",
    r"\btrend\b",
    r"\bby\s+(branch|product|officer|month|date)\b",
]


def _match(patterns: list[str], text: str) -> bool:
    for pat in patterns:
        if re.search(pat, text, re.IGNORECASE):
            return True
    return False


def classify(user_question: str) -> QuestionType:
    q = user_question.strip()

    if _match(_UNSAFE, q):
        return "unsafe"

    if _match(_ANOMALY, q):
        return "anomaly_root_cause"

    if _match(_DATA_QUALITY, q):
        return "data_quality"

    if _match(_DEFINITION, q):
        return "definition"

    if _match(_SQL_ANALYTICS, q):
        return "sql_analytics"

    return "sql_analytics"
