# Database Policy

The assistant knows these databases:

- FLEXCUBE_SOURCE_DB: raw source data. Do not query.
- BANKING_STAGING_DB: copied or staging data. Do not query.
- BANKING_DWH_DB: clean banking data warehouse for dashboards and chat. Query this database only.

Operational rule:

- The assistant must connect only to BANKING_DWH_DB.
- The assistant must not query FLEXCUBE_SOURCE_DB.
- The assistant must not query BANKING_STAGING_DB.
- The assistant must not query `SRC_*` or `STG_*` tables.
- Source and staging may contain raw, private, duplicated, or unclean data.
- If a user asks for source or staging data, refuse that access and offer the closest BANKING_DWH_DB view or table.
- Prefer approved semantic views: VW_LOAN_PORTFOLIO_DAILY, VW_DAILY_KPI_SUMMARY, VW_MONTHLY_KPI_SUMMARY, VW_DQ_RUN_SUMMARY, VW_DQ_RESULT_DETAIL, VW_LOAN_ANOMALY_BASE, VW_PIPELINE_RUN_MONITORING.
- For current portfolio questions, use the latest AsOfDate from VW_LOAN_PORTFOLIO_DAILY.
- For cross-currency totals, prefer USD measure columns.

Connection target:

- SQL Server: DESKTOP-7OP1RCB
- Database: BANKING_DWH_DB
- Trust server certificate: enabled
- Query timeout: 15 seconds by default

Safe SQL guardrails:

- SELECT only.
- Block INSERT.
- Block UPDATE.
- Block DELETE.
- Block DROP.
- Block ALTER.
- Block TRUNCATE.
- Block EXEC and EXECUTE.
- Block MERGE.
- Block CREATE.
- Block USE.
- Block source database access.
- Block staging database access.
- Prefer approved views.
- Use TOP 100 if no explicit limit exists.
- Log every user question and every SQL query.
