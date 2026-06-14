# Stage 1 Banking Loan Warehouse Schema

This is the current Stage 1 database reference for the LLM querying layer.

Data flow:

```text
FLEXCUBE_SOURCE_DB SRC_* tables
  -> SP_LOAD_SOURCE_TO_STAGING
BANKING_STAGING_DB STG_* current-state CDC mirror
  -> SP_RUN_DATA_QUALITY
  -> SP_TRANSFORM_STAGING_TO_DWH
  -> SP_RUN_ANOMALY_DETECTION
BANKING_DWH_DB DIM_*, FACT_*, DQ_*, ANOMALY_RESULT, semantic VW_* views
```

The assistant must query `BANKING_DWH_DB` only. Prefer semantic `VW_*` views. Never query `SRC_*` or `STG_*` tables.

## Source Database: FLEXCUBE_SOURCE_DB

Raw simulated core-banking source. Do not query from the assistant.

Source tables:

- `SRC_CUSTOMER`: one borrower. PK `customer_id`. Columns include customer_name, customer_type, gender, date_of_birth, industry, customer_segment, province, nationality, created_date.
- `SRC_BRANCH`: one branch. PK `branch_id`. Columns include branch_name, province, region.
- `SRC_PRODUCT`: one loan product. PK `product_id`. Columns include product_name, product_group.
- `SRC_COLLECTION_OFFICER`: one collections officer. PK `officer_id`. Columns include officer_name, team, region.
- `SRC_LOAN_MASTER`: one loan account. PK `loan_account_no`. Columns include customer_id, branch_id, product_id, officer_id, currency, loan_amount, interest_rate, booking_date, maturity_date, loan_status.
- `SRC_LOAN_DISBURSEMENT`: one disbursement. PK `disbursement_id`. Columns include loan_account_no, disbursement_date, amount.
- `SRC_LOAN_SCHEDULE`: one installment. PK `schedule_id`. Columns include loan_account_no, installment_no, due_date, principal_due, interest_due, total_due, paid_flag.
- `SRC_REPAYMENT_TRANSACTION`: one repayment. PK `repayment_id`. Columns include loan_account_no, repayment_date, principal_paid, interest_paid, penalty_paid, payment_channel.
- `SRC_WRITE_OFF`: one write-off. PK `writeoff_id`. Columns include loan_account_no, writeoff_date, writeoff_principal, writeoff_interest, writeoff_reason.
- `SRC_RECOVERY`: one recovery. PK `recovery_id`. Columns include loan_account_no, recovery_date, recovery_amount, recovery_channel, collection_officer_id.

## Staging Database: BANKING_STAGING_DB

CDC current-state mirror of the source. Do not query from the assistant.

Staging tables:

- `STG_CUSTOMER`
- `STG_BRANCH`
- `STG_PRODUCT`
- `STG_COLLECTION_OFFICER`
- `STG_LOAN_MASTER`
- `STG_LOAN_DISBURSEMENT`
- `STG_LOAN_SCHEDULE`
- `STG_REPAYMENT_TRANSACTION`
- `STG_WRITE_OFF`
- `STG_RECOVERY`
- `CDC_WATERMARK`

Standard audit/CDC columns on `STG_*` tables:

- `source_last_update_date`
- `load_batch_id`
- `pipeline_run_date`
- `source_system`
- `source_table`
- `load_datetime`
- `record_hash`
- `created_date`
- `last_update_date`

## Warehouse Database: BANKING_DWH_DB

### Dimensions

- `DIM_DATE`: PK `DateKey`, natural key `FullDate`. Static calendar columns: Day, Month, MonthName, Quarter, Year, Week.
- `DIM_CUSTOMER`: PK `CustomerKey`, natural key `CustomerID`. SCD Type 2. Attributes: CustomerName, CustomerType, Gender, DateOfBirth, Industry, CustomerSegment, Province, Nationality, CustomerCreatedDate.
- `DIM_PRODUCT`: PK `ProductKey`, natural key `ProductID`. SCD Type 2. Attributes: ProductName, ProductGroup.
- `DIM_COLLECTION_OFFICER`: PK `CollectionOfficerKey`, natural key `OfficerID`. SCD Type 2. Attributes: OfficerName, Team, Region.
- `DIM_LOAN_ACCOUNT`: PK `LoanAccountKey`, natural key `LoanAccountNo`. SCD Type 2. Attributes: CustomerID, BookingDate, MaturityDate, OriginalAmount, InterestRate, TenorMonths.
- `DIM_BRANCH`: PK `BranchKey`, natural key `BranchID`. Type 1. Attributes: BranchName, Province, Region.
- `DIM_CURRENCY`: PK `CurrencyKey`, natural key `CurrencyCode`. Type 1. Attributes: CurrencyName, UsdPerUnit.
- `DIM_LOAN_STATUS`: PK `LoanStatusKey`, natural key `StatusName`. Static seed. Attributes: StatusGroup, PARBucket, NPLCategory.

SCD Type 2 columns on Type 2 dimensions:

- `RowHash`
- `EffectiveStartDate`
- `EffectiveEndDate` (`9999-12-31` means open/current)
- `IsCurrent`
- `VersionNumber`

When querying dimensions directly for current attributes, filter `IsCurrent = 1`. The fact already points to the dimension version current on the fact `AsOfDate`.

### Fact: FACT_LOAN_PORTFOLIO_DAILY

Grain: one row per loan account per `AsOfDate` daily snapshot.

Primary key: `FactLoanPortfolioDailyKey`.

Foreign keys:

- `DateKey`
- `LoanAccountKey`
- `CustomerKey`
- `BranchKey`
- `ProductKey`
- `CurrencyKey`
- `LoanStatusKey`
- `CollectionOfficerKey`

Measures and flags:

- `PrincipalOutstanding`: loan amount minus cumulative principal paid minus cumulative write-off principal, not below zero.
- `InterestOutstanding`: cumulative due interest through `AsOfDate` minus cumulative paid interest, not below zero.
- `TotalLoanOutstanding`: PrincipalOutstanding plus InterestOutstanding.
- `DisbursedAmount`: disbursed on `AsOfDate`.
- `RepaymentAmount`: principal plus interest plus penalty repaid on `AsOfDate`.
- `OverduePrincipal`
- `OverdueInterest`
- `TotalOverdue`
- `DPD`: days past due, zero if no unpaid due schedule.
- `PAR30Amount`: PrincipalOutstanding when DPD >= 30.
- `PAR60Amount`: PrincipalOutstanding when DPD >= 60.
- `PAR90Amount`: PrincipalOutstanding when DPD >= 90.
- `WriteOffAmount`: written off on `AsOfDate`.
- `WriteOffBalance`: cumulative write-off through `AsOfDate`.
- `RecoveryAmount`: recovered on `AsOfDate`.
- `ActiveLoanFlag`: loan_status = Active and PrincipalOutstanding > 0.
- `NPLFlag`: DPD >= 90 or WriteOffBalance > 0.

Fact audit columns:

- `LoadBatchID`
- `PipelineRunDate`
- `CreatedDate`
- `LastUpdateDate`

### Data Quality Tables

- `DQ_RULE`: rule catalog with rule_id, rule_name, rule_dimension, database_name, table_name, column_name, rule_description, failed_condition, severity, is_active.
- `DQ_RESULT`: one row per rule per batch with failed_record_count, total_record_count, pass_flag, quality_score, severity, rule_dimension, notes.
- `DQ_RUN_SUMMARY`: one row per batch with load_batch_id, completeness_score, validity_score, consistency_score, uniqueness_score, timeliness_score, overall_quality_score, total_rules, passed_rules, failed_rules, critical_failures, run_status.
- `DQ_BATCH_PROFILE`: per staged table per batch with row_count, distinct_record_hashes, min_load_datetime, max_load_datetime.

### Anomaly and Pipeline Tables

- `ANOMALY_RESULT`: anomaly flags by as_of_date, metric_name, branch_name, product_name, actual_value, expected_value, rolling_stddev, window_days, z_score, anomaly_flag, severity, explanation.
- `PIPELINE_RUN_LOG`: one row per procedure step per run with procedure_name, step_name, target_table, start_datetime, end_datetime, status, records_processed, message.

### Approved Semantic Views

Query these from the LLM and Power BI:

- `VW_LOAN_PORTFOLIO_DAILY`: main fact view joined to all dimensions. Includes business-friendly columns, native measures, and USD converted measures using `DIM_CURRENCY.UsdPerUnit`.
- `VW_DAILY_KPI_SUMMARY`: daily USD portfolio KPIs by `AsOfDate`, including TotalLoanOutstanding, NPLRatio, PAR30Ratio, RecoveryRate, ActiveLoans, AverageDPD.
- `VW_MONTHLY_KPI_SUMMARY`: monthly USD KPI rollups by year and month.
- `VW_DQ_RUN_SUMMARY`: data quality scorecard per batch.
- `VW_DQ_RESULT_DETAIL`: rule-level DQ results joined to rule metadata.
- `VW_LOAN_ANOMALY_BASE`: daily branch by product metric base for anomaly detection.
- `VW_PIPELINE_RUN_MONITORING`: pipeline run and step status with duration.

## Controlled Values

- `customer_type`: Individual, SME, Corporate.
- `customer_segment`: Mass, Mass Affluent, Retail, Micro, Small, Medium SME, Corporate Banking.
- `currency`: USD, KHR.
- `loan_status`: Active, Overdue, PAR30, PAR60, PAR90, Written Off, Closed.
- `product`: PRD001 Term Loan, PRD002 Working Capital, PRD003 Overdraft, PRD004 Equipment Loan, PRD005 Housing Loan, PRD006 Vehicle Loan, PRD007 Personal Loan.
- `product_group`: Commercial Loan, Retail Loan.
- `payment_channel`: Branch, Mobile App, Internet Banking, ATM, Agent.
- `recovery_channel`: Field Visit, Phone Call, Legal Action, Collateral Sale, Restructure.

## Snapshot Notes

Stage 1 handoff test snapshot:

- 2,000 loans
- About 3,000 customers
- As-of dates: 2026-06-30 and 2026-07-01
- About 4,000 fact rows
- DQ overall score: 100 percent, PASSED

For current portfolio questions, use the latest `AsOfDate` unless the user specifies a date.
