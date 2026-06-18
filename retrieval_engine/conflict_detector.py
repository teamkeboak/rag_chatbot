"""
Conflict detector — flags when two sources define the same KPI differently.

When a conflict is detected, the source with the lower priority number wins
(i.e. business_rules.md always beats an uploaded note for KPI definitions).
"""
import re

_KPI_PATTERNS: dict[str, str] = {
    "PAR30": r"\bPAR\s*30\b",
    "PAR60": r"\bPAR\s*60\b",
    "PAR90": r"\bPAR\s*90\b",
    "NPL": r"\bNPL\b|non.performing\s+loan",
    "DPD": r"\bDPD\b|days\s+past\s+due",
    "WriteOff": r"\bwrite.?off\b|\bwritten.?off\b",
    "Recovery": r"\brecovery\s+rate\b|\brecovery\s+amount\b",
    "ActiveLoan": r"\bactive\s+loan\b|\bActiveLoanFlag\b",
}


def detect_conflicts(chunks: list[dict]) -> dict:
    """
    Args:
        chunks: reranked list of chunk dicts (must include 'text', 'metadata', 'source_priority')

    Returns:
        {
          conflict_detected: bool,
          conflicts: [ {topic, chosen_source, rejected_sources, reason} ],
          chosen_sources: { kpi_name: winning_source_file }
        }
    """
    # Map each KPI → list of {source, priority, snippet}
    kpi_sources: dict[str, list[dict]] = {}

    for chunk in chunks:
        text = chunk.get("text", "")
        source = chunk.get("metadata", {}).get("source_file", "")
        priority = chunk.get("source_priority", 9)

        for kpi_name, pattern in _KPI_PATTERNS.items():
            if re.search(pattern, text, re.IGNORECASE):
                if kpi_name not in kpi_sources:
                    kpi_sources[kpi_name] = []
                # Only record each source once per KPI
                existing_sources = {e["source"] for e in kpi_sources[kpi_name]}
                if source not in existing_sources:
                    kpi_sources[kpi_name].append({
                        "source": source,
                        "priority": priority,
                        "snippet": text[:150],
                    })

    conflicts: list[dict] = []
    chosen_sources: dict[str, str] = {}

    for kpi_name, sources in kpi_sources.items():
        sorted_sources = sorted(sources, key=lambda x: x["priority"])
        winner = sorted_sources[0]
        chosen_sources[kpi_name] = winner["source"]

        if len(sorted_sources) > 1:
            losers = sorted_sources[1:]
            conflicts.append({
                "topic": kpi_name,
                "chosen_source": winner["source"],
                "rejected_sources": [l["source"] for l in losers],
                "reason": (
                    f"'{winner['source']}' has higher source trust "
                    f"(priority {winner['priority']} vs "
                    f"{', '.join(str(l['priority']) for l in losers)})"
                ),
            })

    return {
        "conflict_detected": len(conflicts) > 0,
        "conflicts": conflicts,
        "chosen_sources": chosen_sources,
    }
