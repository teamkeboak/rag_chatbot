# Data Dictionary

Column-level reference for all approved views and key tables in BANKING_DWH_DB.

## VW_LOAN_PORTFOLIO_DAILY

Main query view. Joins FACT_LOAN_PORTFOLIO_DAILY to all dimensions with pre-computed USD measures.

| Column | Type | Description |
|--------|------|-------------|
| AsOfDate | date | Daily snapshot date. Filter to MAX(AsOfDate) for current portfolio. |
| LoanAccountNo | varchar | Natural loan account identifier from source. |
| CustomerName | varchar | Borrower full name. |
| CustomerType | varchar | Individual, SME, or Corporate. |
| CustomerSegment | varchar | Mass, Mass Affluent, Retail, Micro, Small, Medium SME, Corporate Banking. |
| BranchName | varchar | Branch name. Use for branch-level grouping. |
| Province | varchar | Branch province. |
| Region | varchar | Branch region. |
| ProductName | varchar | Loan product name (e.g. Term Loan, Working Capital). |
| ProductGroup | varchar | Commercial Loan or Retail Loan. |
| CollectionOfficerName | varchar | Assigned collection officer. |
| CurrencyCode | varchar | USD or KHR. |
| LoanStatus | varchar | Active, Overdue, PAR30, PAR60, PAR90, Written Off, Closed. |
| DPD | int | Days Past Due. 0 means current (no unpaid schedule). |
| NPLFlag | bit | 1 when DPD >= 90 OR WriteOffBalance > 0. |
| ActiveLoanFlag | bit | 1 when LoanStatus = Active AND PrincipalOutstanding > 0. |
| PrincipalOutstanding | decimal | Native currency outstanding principal (floored at 0). |
| InterestOutstanding | decimal | Native currency outstanding interest (floored at 0). |
| TotalLoanOutstanding | decimal | PrincipalOutstanding + InterestOutstanding in native currency. |
| DisbursedAmount | decimal | Amount disbursed on AsOfDate in native currency. |
| RepaymentAmount | decimal | Principal + Interest + Penalty paid on AsOfDate in native currency. |
| OverduePrincipal | decimal | Unpaid principal past due date in native currency. |
| OverdueInterest | decimal | Unpaid interest past due date in native currency. |
| TotalOverdue | decimal | OverduePrincipal + OverdueInterest in native currency. |
| PAR30Amount | decimal | PrincipalOutstanding when DPD >= 30 in native currency. |
| PAR60Amount | decimal | PrincipalOutstanding when DPD >= 60 in native currency. |
| PAR90Amount | decimal | PrincipalOutstanding when DPD >= 90 in native currency. |
| WriteOffAmount | decimal | Written off on AsOfDate in native currency. |
| WriteOffBalance | decimal | Cumulative write-off through AsOfDate in native currency. |
| RecoveryAmount | decimal | Recovered on AsOfDate in native currency. |
| PrincipalOutstandingUSD | decimal | PrincipalOutstanding converted to USD. Use for cross-currency totals. |
| TotalLoanOutstandingUSD | decimal | TotalLoanOutstanding converted to USD. |
| PAR30AmountUSD | decimal | PAR30Amount converted to USD. |
| PAR60AmountUSD | decimal | PAR60Amount converted to USD. |
| PAR90AmountUSD | decimal | PAR90Amount converted to USD. |
| TotalOverdueUSD | decimal | TotalOverdue converted to USD. |
| DisbursedAmountUSD | decimal | DisbursedAmount converted to USD. |
| RepaymentAmountUSD | decimal | RepaymentAmount converted to USD. |
| RecoveryAmountUSD | decimal | RecoveryAmount converted to USD. |
| WriteOffAmountUSD | decimal | WriteOffAmount converted to USD. |

## VW_DAILY_KPI_SUMMARY

Daily portfolio KPIs aggregated in USD by AsOfDate only.

| Column | Type | Description |
|--------|------|-------------|
| AsOfDate | date | Snapshot date. |
| TotalLoanOutstandingUSD | decimal | Total portfolio outstanding in USD. |
| NPLRatio | decimal | NPL Amount USD / Total Outstanding USD. |
| PAR30Ratio | decimal | PAR30 Amount USD / Total Outstanding USD. |
| RecoveryRate | decimal | Recovery Amount USD / Write-Off Amount USD. |
| ActiveLoans | int | Count of loan accounts where ActiveLoanFlag = 1. |
| AverageDPD | decimal | Average DPD across all loans on AsOfDate. |

## VW_MONTHLY_KPI_SUMMARY

Monthly KPI rollups in USD.

| Column | Type | Description |
|--------|------|-------------|
| Year | int | Calendar year. |
| Month | int | Calendar month (1–12). |
| TotalLoanOutstandingUSD | decimal | Month-end portfolio outstanding in USD. |
| NPLRatio | decimal | NPL ratio for the month. |
| PAR30Ratio | decimal | PAR30 ratio for the month. |
| RecoveryRate | decimal | Recovery rate for the month. |
| ActiveLoans | int | Active loan count for the month. |
| AverageDPD | decimal | Average DPD for the month. |

## VW_DQ_RUN_SUMMARY

Data quality scorecard per ETL batch.

| Column | Type | Description |
|--------|------|-------------|
| load_batch_id | varchar | ETL batch identifier. Links to DQ_RESULT and PIPELINE_RUN_LOG. |
| completeness_score | decimal | Percentage of complete records (0–1). |
| validity_score | decimal | Percentage passing validity rules (0–1). |
| consistency_score | decimal | Percentage passing consistency rules (0–1). |
| uniqueness_score | decimal | Percentage with no duplicates (0–1). |
| timeliness_score | decimal | Percentage loaded within SLA (0–1). |
| overall_quality_score | decimal | Composite DQ score across all dimensions. |
| total_rules | int | Total DQ rules evaluated in this batch. |
| passed_rules | int | Count of passed rules. |
| failed_rules | int | Count of failed rules. |
| critical_failures | int | Count of severity=critical failures. |
| run_status | varchar | PASSED or FAILED. |

## VW_DQ_RESULT_DETAIL

Rule-level DQ results joined to DQ_RULE metadata.

| Column | Type | Description |
|--------|------|-------------|
| load_batch_id | varchar | ETL batch identifier. |
| rule_id | int | DQ rule identifier. |
| rule_name | varchar | Descriptive rule name. |
| rule_dimension | varchar | completeness / validity / consistency / uniqueness / timeliness. |
| database_name | varchar | Target database name. |
| table_name | varchar | Target table name. |
| column_name | varchar | Target column name. |
| rule_description | varchar | Human-readable rule description. |
| failed_condition | varchar | SQL condition that caused failure. |
| severity | varchar | critical / warning / info. |
| failed_record_count | int | Records failing this rule. |
| total_record_count | int | Total records evaluated. |
| pass_flag | bit | 1 = passed, 0 = failed. |
| quality_score | decimal | Pass rate (failed / total). |
| notes | varchar | Additional context or fix guidance. |

## VW_LOAN_ANOMALY_BASE

Daily branch-by-product metric base for anomaly detection.

| Column | Type | Description |
|--------|------|-------------|
| as_of_date | date | Snapshot date. |
| branch_name | varchar | Branch name. |
| product_name | varchar | Product name. |
| metric_name | varchar | KPI being monitored (e.g. PAR30Ratio, NPLRatio). |
| actual_value | decimal | Observed KPI value for this branch/product/date. |
| expected_value | decimal | Rolling mean over the window period. |
| rolling_stddev | decimal | Rolling standard deviation over the window period. |
| window_days | int | Rolling window size in days. |
| z_score | decimal | (actual_value - expected_value) / rolling_stddev. |
| anomaly_flag | bit | 1 when abs(z_score) >= 2.5. |
| severity | varchar | High when abs(z_score) >= 3.5, Medium when >= 2.5. |
| explanation | varchar | Auto-generated text explaining the anomaly. |

## VW_PIPELINE_RUN_MONITORING

ETL pipeline step status and duration.

| Column | Type | Description |
|--------|------|-------------|
| procedure_name | varchar | Stored procedure name (e.g. SP_LOAD_SOURCE_TO_STAGING). |
| step_name | varchar | Step label within the procedure. |
| target_table | varchar | Table or view being populated. |
| start_datetime | datetime | Step start timestamp. |
| end_datetime | datetime | Step end timestamp. |
| status | varchar | SUCCESS or FAILED. |
| records_processed | int | Row count processed by this step. |
| message | varchar | Success message or error detail. |
| duration_seconds | int | end_datetime minus start_datetime in seconds. |

## FACT_LOAN_PORTFOLIO_DAILY (raw — use view instead)

Grain: one row per loan account per AsOfDate.

Foreign keys: DateKey, LoanAccountKey, CustomerKey, BranchKey, ProductKey, CurrencyKey, LoanStatusKey, CollectionOfficerKey.

Use VW_LOAN_PORTFOLIO_DAILY in preference to this table directly.

## ANOMALY_RESULT (raw — use VW_LOAN_ANOMALY_BASE instead)

| Column | Type | Description |
|--------|------|-------------|
| as_of_date | date | Date of anomaly detection. |
| metric_name | varchar | KPI name. |
| branch_name | varchar | Branch dimension. |
| product_name | varchar | Product dimension. |
| actual_value | decimal | Observed metric. |
| expected_value | decimal | Rolling mean. |
| rolling_stddev | decimal | Rolling std dev. |
| window_days | int | Window size. |
| z_score | decimal | Standardised deviation. |
| anomaly_flag | bit | 1 = anomaly detected. |
| severity | varchar | High / Medium. |
| explanation | varchar | Explanation text. |
