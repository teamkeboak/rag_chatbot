# KPI Glossary

Use USD measures for cross-currency aggregation. The `VW_LOAN_PORTFOLIO_DAILY` view exposes native currency measures and matching USD measures converted with `DIM_CURRENCY.UsdPerUnit`.

## Loan Portfolio Measures

Total Loan Outstanding:

- `TotalLoanOutstanding` = `PrincipalOutstanding` + `InterestOutstanding`.
- Prefer `TotalLoanOutstandingUSD` for portfolio-wide reporting across USD and KHR.

Principal Outstanding:

- `PrincipalOutstanding` = original loan amount minus cumulative principal paid minus cumulative write-off principal, floored at zero.
- Prefer `PrincipalOutstandingUSD` for cross-currency totals.

Interest Outstanding:

- `InterestOutstanding` = cumulative interest due through `AsOfDate` minus cumulative interest paid, floored at zero.

Disbursed Amount:

- `DisbursedAmount` is the amount disbursed on `AsOfDate`.
- Prefer `DisbursedAmountUSD` for cross-currency daily trends.

Repayment Amount:

- `RepaymentAmount` is principal plus interest plus penalty paid on `AsOfDate`.
- Prefer `RepaymentAmountUSD` for cross-currency daily trends.

Overdue Amount:

- `OverduePrincipal` is principal due on or before `AsOfDate` and not paid.
- `OverdueInterest` is interest due on or before `AsOfDate` and not paid.
- `TotalOverdue` = `OverduePrincipal` + `OverdueInterest`.

DPD:

- DPD means Days Past Due.
- DPD = `AsOfDate` minus earliest unpaid due date.
- DPD = 0 if there is no unpaid schedule.

## Risk KPIs

PAR30:

- `PAR30Amount` = `PrincipalOutstanding` when DPD >= 30.
- `PAR30 Ratio` = sum(`PAR30AmountUSD`) / sum(`TotalLoanOutstandingUSD`).

PAR60:

- `PAR60Amount` = `PrincipalOutstanding` when DPD >= 60.
- `PAR60 Ratio` = sum(`PAR60AmountUSD`) / sum(`TotalLoanOutstandingUSD`).

PAR90:

- `PAR90Amount` = `PrincipalOutstanding` when DPD >= 90.
- `PAR90 Ratio` = sum(`PAR90AmountUSD`) / sum(`TotalLoanOutstandingUSD`).

NPL:

- `NPLFlag` = 1 when DPD >= 90 or `WriteOffBalance` > 0.
- `NPL Ratio` = sum(`TotalLoanOutstandingUSD` where `NPLFlag` = 1) / sum(`TotalLoanOutstandingUSD`).

Write-off:

- `WriteOffAmount` is written off on `AsOfDate`.
- `WriteOffBalance` is cumulative write-off through `AsOfDate`.

Recovery:

- `RecoveryAmount` is recovered on `AsOfDate`.
- `Recovery Rate` = sum(`RecoveryAmountUSD`) / sum(`WriteOffAmountUSD`).
- If the user asks for a different recovery denominator, state the assumption.

Active Loans:

- `ActiveLoanFlag` = 1 when loan status is Active and `PrincipalOutstanding` > 0.

## Quality, Anomaly, and Pipeline KPIs

Data Quality Score:

- Use `VW_DQ_RUN_SUMMARY` for batch-level DQ scorecards.
- `overall_quality_score` summarizes DQ rules across completeness, validity, consistency, uniqueness, and timeliness.

DQ Rule Detail:

- Use `VW_DQ_RESULT_DETAIL` for rule-level failed counts, total records, pass flags, severity, rule dimension, and notes.

Anomaly:

- Use `ANOMALY_RESULT` for flagged anomalies.
- Use `VW_LOAN_ANOMALY_BASE` for daily branch by product metric base.
- Anomaly detection uses trailing rolling mean and standard deviation.
- Flag when absolute z-score >= 2.5.
- Severity is High when absolute z-score >= 3.5 and Medium when absolute z-score >= 2.5.

Pipeline Monitoring:

- Use `VW_PIPELINE_RUN_MONITORING` or `PIPELINE_RUN_LOG` for procedure_name, step_name, target_table, start/end time, status, records_processed, message, and duration.

Batch ID:

- `load_batch_id` identifies ETL and DQ batches.
- Use batch ID to trace DQ and pipeline lineage.
