# Release notes — A standard chart of accounts, and an upgrade that runs itself

## Back up before you install this release

**Back up first.** This release converts your books. It does the conversion against a copy and only
puts the copy in place once every check has passed, and it leaves your previous database beside it in
`data/pre-chart-<timestamp>/` rather than deleting it — but a backup of your own is still the only
thing that does not depend on this release behaving.

1. Stop the app.
2. Copy `data/akaun.db` somewhere outside the `data/` folder.
3. Copy the whole `data/storage/` folder with it — that is where your receipts and statements live.

Keep both copies until you have opened the app and checked that your figures are right.

---

## The upgrade runs itself

There is no command to run. Start the app and it converts your books, then starts.

The previous release shipped the conversion as `bun run chart:migrate --database <path>`, which you
had to know about and remember. That was wrong in two ways. A book that had never been converted
could not start the app at all — it refused, correctly, rather than let the release delete the tables
your records were still in — so the app told you it could not start and not what to type. And a book
that an earlier release had already converted to double-entry, but never standardized, started
perfectly well with no account codes, no account types and none of the six saved defaults, and
nothing said so.

Both now happen on the way up, before the database is opened for writing at all:

- Your previous `akaun.db`, `-wal` and `-shm` are moved into `data/pre-chart-<timestamp>/`.
- If any check fails, nothing is installed, your file is left byte-for-byte as it was, and the app
  prints why and does not start. It is deliberate that it does not start: a half-standardized chart
  of accounts is worse than a refusal.

`bun run chart:migrate` is gone.

## Your categories move onto the standard chart

Every account now has a type — Asset, Liability, Equity, Revenue or Expense — and a number in that
type's range: assets 1000–1999, liabilities 2000–2999, equity 3000–3999, revenue 4000–4999,
expenses 5000–5999.

Where one of your categories was the standard chart's account under a different name, your category
**is** that account now: it keeps its records, and it takes the standard name and number.

| Your category            | Becomes                 |
| ------------------------ | ----------------------- |
| Marketing                | 5100 Advertising        |
| Software & Subscriptions | 5400 Software           |
| Logistics                | 5300 Shipping           |
| Materials                | 5000 Cost of Goods Sold |
| Other                    | 5900 Other Expenses     |

Names the standard chart already had — Packaging, Utilities, Product Sales — keep their names and
take their standard numbers. **Every other category keeps its own name and its own number**:
Operation, Office Supplies, Professional Services, Food & Beverage, Transport, Accommodation, Client
Project, Consulting, Investment and Rental are all still there, unchanged, with the same records
against them. Nothing was folded into a catch-all.

The five accounts the double-entry conversion made for itself are renamed too, so that the account
new records default to is the account your money is actually in: Bank Account → **1100 Bank**, Money
owed to us → **1200 Accounts Receivable**, Money we owe → **2000 Accounts Payable**, Opening balances
→ **3000 Owner's Equity**, Uncategorised → **5900 Other Expenses**.

Documents still waiting in the import queue are updated as well, so one that was read as
"Software & Subscriptions" still files under Software instead of falling back to Uncategorised.

## Equipment is now an asset — your Profit & Loss changes

**Read this one carefully.** Equipment was an expense category, so buying something the business
keeps and uses for years counted as one whole expense in the month you bought it. It is now an
**asset**: it appears on the balance sheet, under what the business owns, and it is no longer an
expense.

Your figures move accordingly. Everything you filed under Equipment leaves the Profit & Loss and
appears among your assets. The totals still add up — nothing was lost, and no record changed — but
past Profit & Loss figures are not the same numbers they were before the upgrade, and the difference
is the whole of what you spent on equipment.

Nothing is spread over the equipment's life for you. Writing down a share of its cost each year is
an ordinary record you make when you want to, exactly as before.

On the everyday screens nothing changes about how you use it: Equipment is still offered beside your
categories when you record a purchase, and buying a laptop is still an ordinary purchase, not
something that needs the Adjustments ability.

Two smaller consequences of the same change: equipment purchases no longer count towards the
dashboard's "money out" for the month, since that figure now matches the Profit & Loss; and nothing
can be paid _from_ an equipment account, so it is not offered as a paying account or as a statement
account.

## The conversion tells you what it did

The startup log carries a summary of every conversion: accounts given a type, codes assigned,
standard accounts created, saved defaults installed, merges completed, categories renamed onto a
standard account, accounts retyped, and import-queue rows updated — plus any item needing your
attention. The equipment reclassification is always one of those items, with the number of records
it moved.
