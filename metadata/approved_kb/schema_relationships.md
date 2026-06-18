# Schema Relationships

Join patterns, key linkages, and KPI computation chains for BANKING_DWH_DB.

## Primary Join Pattern

All loan portfolio analysis should start from VW_LOAN_PORTFOLIO_DAILY. It pre-joins:

```
FACT_LOAN_PORTFOLIO_DAILY
  JOIN DIM_DATE              ON DateKey
  JOIN DIM_LOAN_ACCOUNT      ON LoanAccountKey   (SCD Type 2, version locked to AsOfDate)
  JOIN DIM_CUSTOMER          ON CustomerKey       (SCD Type 2, version locked to AsOfDate)
  JOIN DIM_BRANCH            ON BranchKey         (Type 1 - always current)
  JOIN DIM_PRODUCT           ON ProductKey        (SCD Type 2, version locked to AsOfDate)
  JOIN DIM_CURRENCY          ON CurrencyKey       (Type 1 - always current)
  JOIN DIM_LOAN_STATUS       ON LoanStatusKey     (static seed)
  JOIN DIM_COLLECTION_OFFICER ON CollectionOfficerKey (SCD Type 2, version locked to AsOfDate)
```

Do not join these tables manually. Use VW_LOAN_PORTFOLIO_DAILY.

## Date Filtering Rules

Current portfolio snapshot:
```sql
WHERE AsOfDate = (SELECT MAX(AsOfDate) FROM BANKING_DWH_DB.dbo.VW_LOAN_PORTFOLIO_DAILY)
```

Date range trend:
```sql
WHERE AsOfDate BETWEEN '2026-01-01' AND '2026-06-30'
GROUP BY AsOfDate
```

Never sum daily snapshot balances across multiple dates unless building a time-series trend. Each row is a point-in-time snapshot, not a transaction.

## SCD Type 2 Direct Query Rule

If querying Type 2 dimensions directly (not through the view), always filter current version:
```sql
WHERE IsCurrent = 1
```

Type 2 dimensions: DIM_CUSTOMER, DIM_PRODUCT, DIM_COLLECTION_OFFICER, DIM_LOAN_ACCOUNT.
Type 1 dimensions (no IsCurrent needed): DIM_BRANCH, DIM_CURRENCY, DIM_DATE, DIM_LOAN_STATUS.

## Currency Conversion

USD columns in VW_LOAN_PORTFOLIO_DAILY are pre-calculated using DIM_CURRENCY.UsdPerUnit.
Do not manually join DIM_CURRENCY for conversion. Use the pre-built USD columns directly:
- PrincipalOutstandingUSD, TotalLoanOutstandingUSD, PAR30AmountUSD, PAR60AmountUSD, PAR90AmountUSD
- TotalOverdueUSD, DisbursedAmountUSD, RepaymentAmountUSD, RecoveryAmountUSD, WriteOffAmountUSD

## DQ Relationship Chain

```
DQ_RUN_SUMMARY (batch level, one row per batch)
  ← DQ_RESULT (rule-batch level) via load_batch_id
      ← DQ_RULE (rule catalog) via rule_id
DQ_BATCH_PROFILE (table profile per batch) via load_batch_id
```

Preferred views:
- VW_DQ_RUN_SUMMARY → batch summary (completeness, validity, consistency, uniqueness, timeliness, overall score)
- VW_DQ_RESULT_DETAIL → rule-level failures joined to rule metadata

## Anomaly Relationship

```
ANOMALY_RESULT.as_of_date   → links to FACT_LOAN_PORTFOLIO_DAILY.AsOfDate
ANOMALY_RESULT.branch_name  → matches DIM_BRANCH.BranchName
ANOMALY_RESULT.product_name → matches DIM_PRODUCT.ProductName
ANOMALY_RESULT.metric_name  → computed KPI name (not a foreign key)
```

Use VW_LOAN_ANOMALY_BASE for pre-computed anomaly analysis with z-scores.

## Pipeline Relationship

```
PIPELINE_RUN_LOG.load_batch_id → links to DQ_RUN_SUMMARY.load_batch_id
PIPELINE_RUN_LOG: one row per stored procedure step per run
```

Preferred view: VW_PIPELINE_RUN_MONITORING (adds duration_seconds calculation).

## KPI Computation Chain

```
DPD (Days Past Due)
  → DPD >= 30 → PAR30Amount = PrincipalOutstanding
  → DPD >= 60 → PAR60Amount = PrincipalOutstanding
  → DPD >= 90 → PAR90Amount = PrincipalOutstanding
              → NPLFlag = 1

WriteOffBalance > 0 → NPLFlag = 1 (even if DPD < 90)

NPLRatio = SUM(TotalLoanOutstandingUSD WHERE NPLFlag=1) / SUM(TotalLoanOutstandingUSD)
PAR30Ratio = SUM(PAR30AmountUSD) / SUM(TotalLoanOutstandingUSD)
RecoveryRate = SUM(RecoveryAmountUSD) / SUM(WriteOffAmountUSD)
```

Write-off reduces PrincipalOutstanding (floored at 0).
Recovery is tracked as RecoveryAmount but does not reduce WriteOffBalance in Stage 1.

## Approved View Selection Guide

| User Question Type | Preferred View |
|-------------------|----------------|
| Current portfolio by branch/product | VW_LOAN_PORTFOLIO_DAILY |
| Daily KPI trend (NPL, PAR, recovery) | VW_DAILY_KPI_SUMMARY |
| Monthly KPI trend | VW_MONTHLY_KPI_SUMMARY |
| DQ batch scorecard | VW_DQ_RUN_SUMMARY |
| Which DQ rules failed | VW_DQ_RESULT_DETAIL |
| Anomaly detection results | VW_LOAN_ANOMALY_BASE |
| ETL pipeline status | VW_PIPELINE_RUN_MONITORING |
| Individual overdue loans | VW_LOAN_PORTFOLIO_DAILY |
