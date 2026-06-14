# Approved SQL Examples

Use these examples as style references. Prefer approved semantic views. Use `TOP 100` for result limits. For current snapshot questions, filter to the latest `AsOfDate`.

## Daily Loan Portfolio by Branch on Latest Date

```sql
SELECT TOP 100
    AsOfDate,
    BranchName,
    SUM(TotalLoanOutstandingUSD) AS TotalLoanOutstandingUSD,
    SUM(DisbursedAmountUSD) AS DisbursedAmountUSD,
    SUM(RepaymentAmountUSD) AS RepaymentAmountUSD
FROM BANKING_DWH_DB.dbo.VW_LOAN_PORTFOLIO_DAILY
WHERE AsOfDate = (
    SELECT MAX(AsOfDate)
    FROM BANKING_DWH_DB.dbo.VW_LOAN_PORTFOLIO_DAILY
)
GROUP BY
    AsOfDate,
    BranchName
ORDER BY
    TotalLoanOutstandingUSD DESC;
```

## PAR30 by Branch on Latest Date

```sql
SELECT TOP 100
    AsOfDate,
    BranchName,
    SUM(TotalLoanOutstandingUSD) AS TotalLoanOutstandingUSD,
    SUM(PAR30AmountUSD) AS PAR30AmountUSD,
    CAST(SUM(PAR30AmountUSD) AS decimal(18, 4))
        / NULLIF(SUM(TotalLoanOutstandingUSD), 0) AS PAR30Ratio
FROM BANKING_DWH_DB.dbo.VW_LOAN_PORTFOLIO_DAILY
WHERE AsOfDate = (
    SELECT MAX(AsOfDate)
    FROM BANKING_DWH_DB.dbo.VW_LOAN_PORTFOLIO_DAILY
)
GROUP BY
    AsOfDate,
    BranchName
ORDER BY
    PAR30Ratio DESC;
```

## NPL Ratio by Product on Latest Date

```sql
SELECT TOP 100
    AsOfDate,
    ProductName,
    ProductGroup,
    SUM(TotalLoanOutstandingUSD) AS TotalLoanOutstandingUSD,
    SUM(CASE WHEN NPLFlag = 1 THEN TotalLoanOutstandingUSD ELSE 0 END) AS NPLAmountUSD,
    CAST(SUM(CASE WHEN NPLFlag = 1 THEN TotalLoanOutstandingUSD ELSE 0 END) AS decimal(18, 4))
        / NULLIF(SUM(TotalLoanOutstandingUSD), 0) AS NPLRatio
FROM BANKING_DWH_DB.dbo.VW_LOAN_PORTFOLIO_DAILY
WHERE AsOfDate = (
    SELECT MAX(AsOfDate)
    FROM BANKING_DWH_DB.dbo.VW_LOAN_PORTFOLIO_DAILY
)
GROUP BY
    AsOfDate,
    ProductName,
    ProductGroup
ORDER BY
    NPLRatio DESC;
```

## Daily KPI Summary

```sql
SELECT TOP 100
    AsOfDate,
    TotalLoanOutstandingUSD,
    NPLRatio,
    PAR30Ratio,
    RecoveryRate,
    ActiveLoans,
    AverageDPD
FROM BANKING_DWH_DB.dbo.VW_DAILY_KPI_SUMMARY
ORDER BY
    AsOfDate DESC;
```

## Monthly KPI Summary

```sql
SELECT TOP 100
    Year,
    Month,
    TotalLoanOutstandingUSD,
    NPLRatio,
    PAR30Ratio,
    RecoveryRate,
    ActiveLoans,
    AverageDPD
FROM BANKING_DWH_DB.dbo.VW_MONTHLY_KPI_SUMMARY
ORDER BY
    Year DESC,
    Month DESC;
```

## Data Quality Run Summary

```sql
SELECT TOP 100
    load_batch_id,
    overall_quality_score,
    completeness_score,
    validity_score,
    consistency_score,
    uniqueness_score,
    timeliness_score,
    total_rules,
    passed_rules,
    failed_rules,
    critical_failures,
    run_status
FROM BANKING_DWH_DB.dbo.VW_DQ_RUN_SUMMARY
ORDER BY
    load_batch_id DESC;
```

## Rule-Level DQ Failures

```sql
SELECT TOP 100
    load_batch_id,
    rule_name,
    rule_dimension,
    severity,
    failed_record_count,
    total_record_count,
    quality_score,
    notes
FROM BANKING_DWH_DB.dbo.VW_DQ_RESULT_DETAIL
WHERE pass_flag = 0
ORDER BY
    load_batch_id DESC,
    severity,
    failed_record_count DESC;
```

## Pipeline Monitoring

```sql
SELECT TOP 100
    procedure_name,
    step_name,
    target_table,
    start_datetime,
    end_datetime,
    status,
    records_processed,
    message
FROM BANKING_DWH_DB.dbo.VW_PIPELINE_RUN_MONITORING
ORDER BY
    start_datetime DESC;
```

## Highest Overdue Loans by Officer

```sql
SELECT TOP 100
    AsOfDate,
    CollectionOfficerName,
    LoanAccountNo,
    CustomerName,
    BranchName,
    ProductName,
    DPD,
    TotalOverdueUSD,
    TotalLoanOutstandingUSD
FROM BANKING_DWH_DB.dbo.VW_LOAN_PORTFOLIO_DAILY
WHERE AsOfDate = (
    SELECT MAX(AsOfDate)
    FROM BANKING_DWH_DB.dbo.VW_LOAN_PORTFOLIO_DAILY
)
  AND TotalOverdueUSD > 0
ORDER BY
    TotalOverdueUSD DESC;
```
