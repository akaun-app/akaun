# Contract: Dashboard page data changes

`src/routes/(app)/dashboard/+page.server.ts` load result.

## Removed

- `cashFlow`, `categoryData`, `trendData` (chart datasets) and the server calls that built them
  (`monthlyExpenseTotals`, `monthlyIncomeTotals`, `expenseCategoryBreakdown`, and the
  `expByMonth`/`incByMonth`/`monthLabels` plumbing).
- `fundsFlowStatement(...)` result and the `FundsFlow` panel it fed (Research §10).
- The standalone `currentAssetsAsAt` and `outstandingTotal` KPI figures as independent tiles —
  folded into `position` below (Research §11).

## Added / changed

```
{
  netProfit: {
    amountMinor: number      // profitLossReport(db, dateFrom, dateTo).resultMinor — same call Reports makes
    dateFrom: string
    dateTo: string
    href: string              // /reports/profit-loss?from=...&to=...
  }
  position: {
    assetsTotalMinor: number
    liabilitiesTotalMinor: number
    equityTotalMinor: number
    balances: boolean          // from balanceSheetReport — false renders the same warning Reports shows (FR-016)
    asAt: string
    href: string                // /reports/balance-sheet?asAt=...
  }
  cashFlow: {
    netChangeMinor: number      // cashFlowReport(db, dateFrom, dateTo).netChangeMinor
    needsReviewMinor: number    // surfaced when > 0, per FR-005/edge case ("no accounts classified yet")
    dateFrom: string
    dateTo: string
    href: string                  // /reports/cash-flow?from=...&to=...
  }
  recentActivity: ...            // unchanged (FR-017)
  period: DashboardPeriod         // unchanged, still governs netProfit/cashFlow; position is always "as at today"
}
```

SSE: no new emitter. `/api/dashboard/stream` already fans in `ledgerEvents` (`record-update`,
`record-deleted`, `settlement-changed`), which covers every record kind that could move any of
these three figures — unchanged (Principle VI: one emitter per domain, no per-kind filters).

Each indicator's `href` carries the exact `dateFrom`/`dateTo`/`asAt` the tile displayed, so
following it lands on the matching Reports statement already showing the same figure (FR-015).
