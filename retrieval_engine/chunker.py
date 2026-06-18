"""
Chunker — semantic + hierarchical + SQL-aware + table-aware.

Inspired by RAPTOR: stores small detail chunks AND a parent section summary.
"""
import re
from pathlib import Path


def _extract_sql_blocks(text: str) -> tuple[list[str], str]:
    """Remove SQL blocks from text and return them separately."""
    sql_blocks = re.findall(r"```sql\n(.*?)```", text, re.DOTALL)
    cleaned = re.sub(r"```sql\n.*?```", "__SQL_BLOCK__", text, flags=re.DOTALL)
    return [s.strip() for s in sql_blocks], cleaned


def _extract_tables(text: str) -> tuple[list[str], str]:
    """Remove markdown tables and return them separately."""
    table_pattern = r"(\|[^\n]+\|\n(?:\|[-: |]+\|\n)(?:\|[^\n]+\|\n?)+)"
    tables = re.findall(table_pattern, text)
    cleaned = re.sub(table_pattern, "__TABLE_BLOCK__", text)
    return tables, cleaned


def chunk_markdown(text: str, source_file: str, document_type: str) -> list[dict]:
    chunks: list[dict] = []

    # Split into H2 sections
    sections = re.split(r"\n(?=## )", text.strip())

    for section in sections:
        lines = section.strip().split("\n")
        section_title = lines[0].lstrip("#").strip() if lines else ""

        # Extract SQL blocks (atomic — keep whole query together)
        sql_blocks, section_no_sql = _extract_sql_blocks(section)
        for sql in sql_blocks:
            if sql:
                chunks.append({
                    "chunk_text": sql,
                    "parent_section": section_title,
                    "source_file": source_file,
                    "document_type": document_type,
                    "chunk_type": "sql_example",
                })

        # Extract markdown tables (atomic — keep rows together)
        tables, section_no_tables = _extract_tables(section_no_sql)
        for table in tables:
            if len(table.strip()) > 20:
                chunks.append({
                    "chunk_text": table.strip(),
                    "parent_section": section_title,
                    "source_file": source_file,
                    "document_type": document_type,
                    "chunk_type": "table",
                })

        # Split remaining text into paragraph chunks
        # Also split by H3 boundaries for finer granularity
        sub_sections = re.split(r"\n(?=### )", section_no_tables)
        for sub in sub_sections:
            sub_title = ""
            sub_lines = sub.strip().split("\n")
            if sub_lines and sub_lines[0].startswith("###"):
                sub_title = sub_lines[0].lstrip("#").strip()
                sub = "\n".join(sub_lines[1:])

            paragraphs = [
                p.strip()
                for p in re.split(r"\n{2,}", sub)
                if p.strip() and len(p.strip()) >= 30
                and "__SQL_BLOCK__" not in p
                and "__TABLE_BLOCK__" not in p
            ]

            for para in paragraphs:
                chunks.append({
                    "chunk_text": para,
                    "parent_section": sub_title or section_title,
                    "source_file": source_file,
                    "document_type": document_type,
                    "chunk_type": "text",
                })

        # RAPTOR-style parent summary: one summary chunk per H2 section
        if section_title and len(section_title) > 2:
            # Collect first 2 meaningful paragraphs for summary
            all_text = re.sub(r"__\w+_BLOCK__", "", section_no_tables)
            summary_paras = [
                p.strip()
                for p in re.split(r"\n{2,}", all_text)
                if p.strip() and len(p.strip()) >= 20
            ][:2]
            summary_body = " ".join(summary_paras)[:400]
            if summary_body:
                chunks.append({
                    "chunk_text": f"{section_title}: {summary_body}",
                    "parent_section": section_title,
                    "source_file": source_file,
                    "document_type": document_type,
                    "chunk_type": "section_summary",
                    "is_summary": True,
                })

    return [c for c in chunks if c.get("chunk_text", "").strip()]


def chunk_file(file_path: Path, document_type: str) -> list[dict]:
    text = file_path.read_text(encoding="utf-8")
    return chunk_markdown(text, file_path.name, document_type)
