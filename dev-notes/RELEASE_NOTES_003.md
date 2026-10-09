# Release notes — One ledger, one Records screen, one flat account list

## Back up before you install this release

**This release permanently removes data. Back up first.** It deletes nine tables that earlier
versions used, and it removes three columns from tables it keeps. There is no way back from inside
the app, and no command that undoes it. Before you install:

1. Stop the app.
2. Copy `data/akaun.db` somewhere outside the `data/` folder.
3. Copy the whole `data/storage/` folder with it — that is where your receipts and statements live.

Keep both copies until you have opened the app after the upgrade and checked that your figures are
right. If anything is wrong, put the two copies back and the previous release will read them again.

If the app refuses to start and names an earlier release, install that release first, let it finish
converting, and then install this one. The refusal leaves your file exactly as it was.

---

## What changed

### One Records screen

Expenses, Income and Journal are gone, and one **Records** screen takes their place. It lists
everything that happened with money — purchases, sales, transfers, payments, starting balances and
entries made by hand — newest first, with one search box and one set of filters.

They were never three sets of records. They were three windows onto one, and a transfer between two
of your own accounts belonged to none of them: it appeared on no list at all, and could only be found
through an account. Now everything is on one list.

Each record has an address you can copy and send: `/records/123`. That includes payments, transfers
and starting balances, which never had one before.

### One way to write a record

One "New record" action, one form, and two questions: which account the money came from, and which it
went to. You are never asked what *kind* of record it is — that follows from the two accounts you
name. Recording that somebody else paid is choosing "Money we owe" as the paying side.

### The navigation has eight items

Dashboard, Records, Quotations, Invoices, Contacts, Auto Import, Accounts, Reports.

If you had reordered your menu, any entry naming a screen that no longer exists is skipped and the
rest of your order is kept.

### Two abilities replace three

`Expenses` and `Income` become one **Records** ability, and `Journal` is renamed **Adjustments**.

Nobody's access changes. Anyone who could see or add expenses or income can see or add records —
the two are merged so that whatever you could do to either, you can still do. Per-user overrides are
merged too.

**Adjustments** is worth reading before you grant it. It lets someone write a record between any two
accounts and add more than two sides. That is what corrections and year-end adjustments need, and it
is also what lets a record make the accounts say anything and still add up. No group has it by
default.

### One flat list of accounts

The Accounts screen no longer groups rows under six headings. It is one list with a search box and a
"sort of account" filter. Each row says what sort of account it is, so two accounts with the same
name are still told apart.

The separate account-history page is gone. An account's movements are now the Records list narrowed
to that account, with a running balance — reached from the account's own drawer. The running balance
disappears if you add another filter or change the sort, and the screen says why.

### Categories are managed in one place

The Category tab in Settings is gone. Categories are accounts, and accounts are created, renamed and
retired on the Accounts screen. Retiring a category that already has records against it archives it:
its history stays, and it stops being offered on new records.

### Reconciling starts from the account

There is no Reconciliation menu item. You check an account against its bank statement from that
account: open it, and use "Check against the bank". The account's drawer says whether a statement is
part-way through.

Uploading no longer asks which account the statement belongs to — you started from the account, so it
already knows. Matching a statement now has its own address you can share.

Nothing about matching itself changed. To see what still needs clearing across every account, use the
"Not yet cleared" filter on Records — which covers accounts with no statement uploaded, something the
old screen could not do.

### Fixed in this release

- **Attachments on records could not be downloaded.** Every file attached to a record since the
  double-entry conversion returned a permission error. They open again.
- **Auto Import could not spot duplicates.** Its duplicate check was still reading the old tables,
  which have been empty since the conversion, so it never found a match. It reads the record store
  now.

### Removed for good

Nine tables and three columns that nothing had read since the double-entry conversion are removed,
and the conversion code retires with them. Nothing you see changes.

## If something looks wrong

Open **Settings → Books** and run the whole-books check. If it does not pass, or any figure looks
wrong:

1. Stop the app.
2. Put back the `data/akaun.db` and `data/storage/` copies you made before installing.
3. Reinstall the previous version.

Your books will be exactly as they were. Please report what you saw.
