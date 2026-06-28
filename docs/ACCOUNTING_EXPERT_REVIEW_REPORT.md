# Accounting Expert Review Report — Akaun Web

## Strategic Direction: Mostly Correct

**Cash-basis, single-entry bookkeeping is the right choice for the target audience.** Startup owners are not accountants. Double-entry accounting with debits, credits, chart of accounts, and trial balances is the #1 reason small business owners give up on software like Xero or QuickBooks and go back to a spreadsheet. Staying single-entry is a feature, not a gap.

**The core loop is sound:** record money in → record money out → see where you stand. That is what a startup owner needs day-to-day.

**AI import is genuinely differentiating.** No mainstream SME tool has a fully automated receipt-to-record pipeline with LLM extraction, duplicate detection, and contact resolution. This should be the flagship feature — the thing that appears in every demo and marketing message. Currently it is buried under a generic "Auto Import" label in the nav.

**The claims/reimbursement workflow is underrated.** This is exactly how early-stage founders operate: pay with personal card → submit for reimbursement. Most accounting tools do not model this cleanly. It is a real differentiator for the 1–10 employee startup.

---

## Critical Gaps (Block Real Business Use)

These are not nice-to-haves. Missing these means the software cannot be used as a primary bookkeeping tool.

### 1. Tax Fields (GST / SST / VAT)

**Every country has a consumption tax.** Malaysia uses SST (6% service tax; 5–10% sales tax). Without tax fields, a business cannot:
- Know how much input tax (on expenses) it can claim back
- Know how much output tax (on sales) it owes to the government
- File a correct SST return

**Minimum required additions per transaction:**
- `taxCode` — which tax applies (e.g. SR 6%, ZR, TX, BL)
- `taxRate` — percentage
- `taxAmount` — absolute amount
- `isTaxInclusive` — whether the entered amount includes tax or is before tax
- Contact: `taxRegistrationNo` (SST/GST reg number, separate from company reg)

This does not require double-entry. It is just additional fields on expense and income rows, plus a tax summary on the dashboard.

### 2. P&L Report (Profit & Loss Statement)

The dashboard shows summary numbers but there is no exportable, printable Profit & Loss statement. This is the **single most requested document** from:
- Banks (for business loan applications)
- Investors (for funding rounds)
- Accountants (for annual tax filing)
- The owner themselves (to understand business health)

A simple P&L for a selected period (month / quarter / year) with income by category, expenses by category, and a net profit line — exported as PDF — would unlock a huge amount of value. The data already exists in the DB; this is primarily a reporting/UI task.

### 3. Due Dates on Expenses

Expenses have status (Unpaid / Pending / Paid) but no `dueDate` field. Without due dates, the owner cannot answer:
- "What bills are due this week?"
- "Am I going to have a cash flow crunch next month?"

Add a `dueDate` column to expenses. Surface an "overdue" filter and a "due soon" dashboard widget. This turns the expense list into an AP (accounts payable) management tool.

### 4. Payment Method

No field on expenses for *how* it was paid (cash, credit card, bank transfer, e-wallet). This matters because:
- Founders mix personal and business spending — "did I pay from the company account or my own card?" is a real daily question
- Accountants need payment method for reconciliation
- Credit card expenses need to be treated differently from cash expenses

A simple enum field (Cash / Card / Bank Transfer / E-Wallet / Other) with an optional `paymentReference` is sufficient.

---

## Important Additions (Significantly Increase Value)

These are not blockers but would make the product substantially more useful.

### 5. Invoice Generation (Accounts Receivable)

Currently, income is recorded only as **received cash**. But many startups invoice customers and wait for payment. Without an Invoice entity, they cannot:
- Create and send professional invoices from the app
- Track which invoices are outstanding
- Follow up on overdue receivables

**Minimum viable invoice:**
- Linked to a contact (customer)
- Line items with description + amount (start with single-line, add multi-line later)
- Due date, payment terms
- Status: Draft → Sent → Paid / Overdue
- PDF export with company branding (logo, address)
- When paid, converts to an income record automatically

This is one of the biggest jumps in perceived professionalism from "expense tracker" to "accounting software."

### 6. CSV / Excel Export

Currently there is no way to export data. Startup owners need to:
- Send records to their external accountant for annual filing
- Import into another tool
- Do ad-hoc analysis in Excel

A simple CSV export of expenses and income for a date range (with all fields, including tax) would unblock an enormous number of real-world workflows. PDF report is for reading; CSV is for data portability.

### 7. Recurring Transactions

Many business expenses repeat monthly (rent, utilities, SaaS subscriptions, salaries). Currently every month requires manual re-entry or re-importing the same receipt. A simple "recurring" flag with a frequency (daily / weekly / monthly / yearly) and a next-due date would auto-create or remind the user to record these.

### 8. Fix: Income Missing `updatedAt`

The `incomes` table has no `updatedAt` column but `expenses` does. This is a data consistency bug — when an income record is edited, there is no timestamp of when it was last changed. Add `updatedAt` to the incomes table and populate it on edit.

---

## Nice to Have (Later, Not Now)

These are good ideas but should not be prioritized until the critical and important gaps are addressed:

- **Budget vs. Actual by category** — set a monthly budget per expense category and see if you are over/under
- **Projects / Cost Centers** — assign expenses and income to a project to see per-project profitability (important for agencies, consultants, construction businesses)
- **Basic audit trail** — an append-only change-log table recording what changed, who changed it, and when
- **E-Invoice (myInvois) integration** — if the primary market is Malaysia, the government's mandatory e-invoicing system (myInvois / Peppol) being phased in from 2024 onward could be a major differentiator. Businesses above the revenue threshold must submit invoices electronically to LHDN. No indie tool targets this yet.
- **WhatsApp / email receipt forwarding** — send a photo of a receipt via WhatsApp or email to a unique address and it enters the AI import queue automatically. This would make AI import even more frictionless for mobile-first users.

---

## What NOT to Add (Preserve the Simplicity Moat)

The biggest risk is scope creep that makes the product as complex as the tools it is trying to replace.

| Do NOT add | Why |
|---|---|
| Double-entry / journal entries | The target user doesn't understand debits and credits. The moment you expose this, you lose the simplicity advantage. |
| Chart of accounts | Same reason. Use free-text categories instead (already done — keep it). |
| Payroll / payslips | Separate complex compliance domain; every country has different rules. Out of scope. |
| Inventory / stock management | Different product category (ERP). Would confuse the target user. |
| Multi-company / multi-tenancy | Add only when you have users who need it, not speculatively. |
| Fixed asset depreciation | Requires accrual accounting, which conflicts with the cash-basis approach. |

---

## Recommended Priority Order

| Priority | Item | Effort | Impact |
|---|---|---|---|
| P0 | Tax fields (SST/GST) on expense + income | Medium | Critical — unblocks actual business use |
| P0 | P&L report (PDF + date-range filter) | Medium | Critical — most-requested document |
| P1 | Due date on expenses + overdue view | Small | High — turns it into real AP tool |
| P1 | Payment method field on expenses | Small | High — needed for reconciliation |
| P1 | CSV / Excel export | Small | High — data portability for accountants |
| P2 | Invoice generation (Accounts Receivable) | Large | High — biggest jump in perceived value |
| P2 | Recurring transactions | Medium | Medium — saves daily friction |
| P3 | Fix: `incomes.updatedAt` | Tiny | Low but correct |
| P3 | Budget by category | Medium | Medium — financial discipline for owners |
| P4 | myInvois / e-Invoice (Malaysia) | Large | Very high IF Malaysia-focused |

---

## One-Sentence Summary

**The direction is correct** — stay cash-basis, stay simple, keep AI import as the flagship — but the app needs tax fields and a P&L report before it can replace a founder's spreadsheet as a primary bookkeeping tool.
