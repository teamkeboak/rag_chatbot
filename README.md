# Local Ollama Chatbot

A small local chatbot web app that connects to your Ollama models through `http://localhost:11434`.

It has two locked modes for your loan data warehouse project:

- Khmer loan answer: always uses `gemma4:e4b-it-q4_K_M` and answers mainly in Khmer.
- SQL for loan warehouse: always uses `qwen2.5-coder:3b` and generates SQL for loan analytics.

The browser cannot choose other models. The backend owns the model and prompt policy.

SQL mode uses the current Stage 1 banking-loan warehouse schema:

- Source: `FLEXCUBE_SOURCE_DB` raw `SRC_*` tables, never queried by the assistant.
- Staging: `BANKING_STAGING_DB` current-state CDC `STG_*` mirror, never queried by the assistant.
- Warehouse: `BANKING_DWH_DB` only, with `DIM_*`, `FACT_LOAN_PORTFOLIO_DAILY`, DQ tables, anomaly results, pipeline logs, and semantic `VW_*` views.
- Main fact grain: one row per loan account per `AsOfDate`.
- Cross-currency reporting: prefer USD measure columns such as `TotalLoanOutstandingUSD`, `PAR30AmountUSD`, and `RecoveryAmountUSD`.
- NPL: `NPLFlag = 1`, meaning DPD >= 90 or `WriteOffBalance > 0`.
- Approved views: `VW_LOAN_PORTFOLIO_DAILY`, `VW_DAILY_KPI_SUMMARY`, `VW_MONTHLY_KPI_SUMMARY`, `VW_DQ_RUN_SUMMARY`, `VW_DQ_RESULT_DETAIL`, `VW_LOAN_ANOMALY_BASE`, `VW_PIPELINE_RUN_MONITORING`.

Metadata is stored under `metadata/`:

- `metadata/database_policy.md`
- `metadata/warehouse_schema.md`
- `metadata/kpi_glossary.md`
- `metadata/business_rules.md`
- `metadata/approved_sql_examples.md`

The UI includes a thinking summary toggle, but it is off by default for faster answers. When enabled, the app asks the fixed mode model for a short visible `Thinking summary` before streaming the final answer.

Khmer answers use a larger response budget than SQL answers because Khmer text can consume more model tokens. Turn off the thinking summary for faster responses.

Thai language is blocked in both assistant prompts and streamed output. If Thai script appears in model output, the app removes it silently.

SQL mode asks the locked SQL model to generate starter ideas from the DWH metadata, then shows those ideas as clickable prompts.
When a user asks broad questions such as what the SQL assistant can help with, the backend prompt instructs the model to return concrete DWH query/report ideas instead of a very short clarification-only answer.

## SQL Safety

The backend only allows read-only DWH queries:

- Only `SELECT` or `WITH` queries are allowed.
- Write commands are blocked.
- Source and staging databases are blocked.
- `BANKING_DWH_DB` is the only approved database.
- Simple `SELECT` queries without a limit get `TOP 100` added automatically.
- CTE queries must include an explicit limit.
- Every chat request and SQL query is logged to `logs/chat_queries.jsonl`.

## Evaluation, Feedback, and Audit Logs

The app now records query audit and evaluation data for each completed assistant answer and SQL execution:

- `logs/query_audit.jsonl` stores user question, generated SQL, execution status, response time, blocked query reason, and evaluation scores.
- `logs/human_feedback.jsonl` stores human ratings: `correct_answer`, `wrong_answer`, or `unclear_answer`.
- `logs/chat_queries.jsonl` remains the raw chat/query event log.

The evaluation module tracks:

- SQL correctness from read-only DWH validation and execution result.
- Answer accuracy as a heuristic score that is improved by human feedback.
- Hallucination rate by comparing mentioned DWH objects with approved views and known warehouse tables.
- Response usefulness from request fit, answer completeness, and human feedback.
- Guardrail success rate from blocked unsafe SQL and Thai-script/output safety checks.

Available endpoints:

- `GET /api/evaluation/summary`
- `GET /api/suggestions?mode=sql`
- `POST /api/feedback`

To run SQL from the app, copy `.env.example` to `.env` and set your SQL password:

```powershell
Copy-Item .env.example .env
notepad .env
```

## Requirements

- Node.js 18 or newer
- Ollama running locally
- At least one Ollama chat model installed

## Run

```powershell
npm start
```

Open:

```text
http://localhost:3000
```

## Required Models

The app checks that the two required Ollama models are installed:

```powershell
ollama list
```

If one is missing:

```powershell
ollama pull gemma4:e4b-it-q4_K_M
ollama pull qwen2.5-coder:3b
```

## Useful Ollama commands

```powershell
ollama list
ollama pull gemma3:4b
ollama serve
```

If Ollama is already running as a desktop app or service, you usually do not need `ollama serve`.
