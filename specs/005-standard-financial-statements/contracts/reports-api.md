# Contract: Reports module changes

## `GET /reports` and `GET /reports/[view]`

`view` param recognizes exactly: `profit-loss`, `balance-sheet`, `cash-flow`, `partners`.

**Retired values, redirected, not errored** (FR-009):

| Old `view` | Response |
|---|---|
| `owed-to-us` | `302` → `/contacts` |
| `we-owe` | `302` → `/contacts` |

Both existing report page routes already gate on `hasPermission(locals, 'reports', 'view')`,
redirecting to `/dashboard` on failure — unchanged, checked before the view-param branch.

**Page data** (`loadReportsPage`) gains one field:

```
{
  view: "profit-loss" | "balance-sheet" | "cash-flow" | "partners"
  hasPartners: boolean     // new — governs whether the Partners' Equity tab renders at all
  period: { dateFrom, dateTo } | { asAt }   // unchanged shape, cash-flow uses the dateFrom/dateTo form
  report: ProfitLossReport | BalanceSheetReport | CashFlowReport | PartnerStatementReport
}
```

Tab list rendered by `ReportsPage.svelte`: Profit & Loss, Balance Sheet, Cash Flow Statement
always; Partners' Equity only when `hasPartners` is true. Nothing else (FR-007).

## `GET /api/reports/cash-flow`

New endpoint, mirroring `api/reports/balance-sheet/+server.ts` exactly:

```
Query:  ?from=<date>&to=<date>            (period, like profit-loss)
        &format=csv                        (optional, like every other report)

200 (json):  CashFlowReport   (see data-model.md)
200 (csv):   same BOM + content-disposition pattern as the other statements,
             built by a new cashFlowCsv(report): CsvTable in ledger/reports/csv.ts

403: hasPermission(locals, 'reports', 'view') === false — reports stays view-only,
     no add/change/delete is ever granted on this resource (Constitution VII, Principle-level rule)
```

## Removed

- `GET /api/reports/owed-to-us`, `GET /api/reports/we-owe` — never existed as CSV endpoints
  (confirmed: `ReportsPage.svelte` already sets `csv = null` for both), so there is nothing to
  redirect or retire at the API layer, only at the page-view layer above.
- `OwedToUs.svelte`, `WeOwe.svelte` components — deleted, not kept dead in the tree (Principle IV:
  no dead code).
