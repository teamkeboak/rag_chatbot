# Business Rules

## Query Scope

- Query only `BANKING_DWH_DB`.
- Never query `FLEXCUBE_SOURCE_DB`, `BANKING_STAGING_DB`, `SRC_*`, or `STG_*`.
- Prefer approved semantic `VW_*` views over raw tables.
- Use `FACT_LOAN_PORTFOLIO_DAILY` only when a view does not expose the needed field.
- Generate read-only `SELECT` or `WITH` SQL only.

## Snapshot Rules

- `FACT_LOAN_PORTFOLIO_DAILY` and `VW_LOAN_PORTFOLIO_DAILY` are daily snapshots.
- For current portfolio questions, filter to the latest `AsOfDate`.
- Do not sum daily snapshot balances across multiple dates unless calculating a time-series trend.
- For trend reports, group by `AsOfDate`, month, branch, product, or another requested dimension.

## Currency Rules

- Use USD measures for cross-currency aggregation.
- Prefer columns ending in `USD` in `VW_LOAN_PORTFOLIO_DAILY` and KPI summary views.
- Use native currency measures only when the user asks for native currency or a single currency.

## Dimension Rules

- The portfolio view already resolves dimension versions as of the fact date.
- When querying Type 2 dimensions directly, filter `IsCurrent = 1` for current attributes.
- Type 2 dimensions: customer, product, collection officer, loan account.
- Type 1/static dimensions: branch, currency, date, loan status.

## Risk Rules

- PAR uses principal outstanding amount by DPD bucket.
- PAR30 uses DPD >= 30.
- PAR60 uses DPD >= 60.
- PAR90 uses DPD >= 90.
- NPL uses `NPLFlag = 1`, defined as DPD >= 90 or `WriteOffBalance` > 0.
- Do not define PAR30 as loans paid within 30 days.
- Prefer `VW_DAILY_KPI_SUMMARY` or `VW_MONTHLY_KPI_SUMMARY` for ready-made KPI ratios.

## DQ and Pipeline Rules

- Prefer `VW_DQ_RUN_SUMMARY` for DQ dashboard summaries.
- Prefer `VW_DQ_RESULT_DETAIL` for rule-level DQ failures.
- Use `DQ_BATCH_PROFILE` for staged table profile counts when needed.
- Use `VW_PIPELINE_RUN_MONITORING` for ETL run status and duration.
- Use `PIPELINE_RUN_LOG` for raw procedure step details if the view is insufficient.

## Anomaly Rules

- Use `ANOMALY_RESULT` for flagged anomaly results.
- Use `VW_LOAN_ANOMALY_BASE` for the daily branch by product metric base.
- Anomaly flag threshold is absolute z-score >= 2.5.
- High severity threshold is absolute z-score >= 3.5.

## Safety Rules

- Never expose SQL usernames, passwords, or connection strings in answers.
- Never suggest querying source or staging databases.
- Never generate write SQL.
- If exact column names are unknown, state assumptions and prefer the semantic views.
