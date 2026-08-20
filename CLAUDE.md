# Akaun Web — Claude Code Notes

## Verification Policy

Do not test the UI in a browser. Do not start the dev server to check your work. Do not
read `.env` to get login details. Check your work by reading code only: read the diff, run
`bun run check` and `bun run lint`, and think about correctness. The user does all visual
and behaviour checks.

**`data/` is real. Never write a script that touches it.** `DATABASE_PATH` and
`STORAGE_PATH` are relative to the working directory, and `.env` sets them to
`./data/akaun.db` and `./data/storage`. Any process that starts in the project root
therefore writes to the maintainer's real books and receipts. If you set these two
variables inside your own script, the script is still not safe. This once deleted a real
`data/` directory and needed a full restore. A running dev server then did the same damage
a second time.

Before you do anything that can run application code:

1. **Look for a dev server**: `ps aux | grep "vite dev"`. SvelteKit's `init()` calls
   `ensureLedgerUpgrade`, so a dev server converts the books and moves attachment files.
   This is by design (FR-037: the installation upgrades itself, with no command and no
   setting). It happens again after each restart that your edits cause. If you do not want
   this now, stop the server before you edit, not after.
2. **The upgrade does not run under a test runner.** It takes its paths as arguments:
   `runLedgerUpgrade(db, guard, { databasePath, storageRoot })`. A test must give its own
   paths. A temporary database alone is not enough, because the file paths are a separate
   setting. This caused the first accident.
3. **Hash `data/akaun.db` before and after** each step you are not sure about. The check is
   cheap and the answer is clear.

## Delegation

**Use subagents often, to keep the main context window clean.** Give a subagent each task
that reads many files but returns a short answer: find code, search for a pattern, check
how a convention is used, or summarize a long file. The file contents then stay in the
subagent, and only the result comes back. Keep decisions and edits in the main thread. Keep
search output out of it.

**Give more resources to a difficult task.** Use a stronger model, more reasoning effort, an
instruction to be thorough, or several agents in parallel on separate parts. A weak agent
on a hard task returns a wrong answer, and the work must then be done again. That costs
more context than doing it correctly one time.

## Architecture Decisions

### Real-Time Updates: SSE-Only

Use **Server-Sent Events (SSE)** for all live UI updates. Do not poll. Polling wastes
requests and is slower, and the client code is simpler with SSE.

**Pattern**
- Add a `GET` endpoint at `src/routes/api/<feature>/stream/+server.ts`. It returns a
  `ReadableStream` with `Content-Type: text/event-stream`.
- Copy the singleton `importEvents` EventEmitter (`src/lib/server/import/events.ts`). Make
  one `<feature>Events` emitter for each domain.
- Each server action that changes state (POST, PATCH, DELETE) must call `events.emit(...)`
  after the DB write. All connected clients then see the change.
- In the client, open the EventSource in `onMount` and close it in `onDestroy`. Never do
  this in `$effect`: `$effect` runs again when a dependency changes, and it would close the
  connection.

**Client merge pattern** — `mergeServerJobs` on the import page is the reference:
- The stream sends a full snapshot when the client connects.
- Each later event is one change (`item-update`, `item-deleted`, and so on).
- Merge like `mergeServerJobs`: update the items you have, and add new items from other tabs
  at the start of the list.
- Do not add an item to local `$state` from the upload or create action. Let the SSE event
  add it. This removes the race between the fetch response and the SSE event.
- Do not put a `File` or a `Blob` in Svelte 5 `$state`. Keep such objects in a plain `Map`
  next to the reactive array.

**Snapshot or no snapshot**
- Import queue: send a full snapshot on connect. The set of active jobs is small, so a
  reconnect catches up by itself.
- Paginated lists (records, accounts): send **no** snapshot. SSR gives the first
  state, and SSE gives only the changes. If the connection stops, `EventSource` reconnects
  and the next event corrects the item. A page reload gets the correct state.

### The Ledger: One Record Store, Two Sides

Each record says where the money came from and where it went. `ledger_records` holds what
happened. `ledger_movements` holds each side of it, against an account in `accounts`.
Expenses and Income are **filtered views of this one store**. They have no tables of their
own.

- **Money is whole cents in a signed integer column** (`amount_minor`). Never do float
  arithmetic on money. A record also keeps the decimal `amount` that the user typed and the
  `exchange_rate` at that time. These two values are for display and audit only — **never
  add the decimal `amount` into a report total**. `ledger/money.ts` is the only converter.
- **A movement is positive when value goes INTO the account and negative when value leaves
  it. The movements of one record always add up to zero.** Money you owe, income and owner
  capital therefore have negative balances. `displaySign` in `ledger/account-type.ts`
  changes the sign for display, in **one** place. Do not change a sign anywhere else. A CSV
  export must show the same signs as the screen it comes from.
- **Build movements only in `ledger/entry-builder.ts`.** Screens describe the event in
  simple terms (`kind: 'expense'`, `paidFromAccountId`), and the builder makes the two
  sides. The builder is the only place that enforces the zero-sum rule. A route or a service
  that builds its own movements is a defect.
- **Payment state is never stored.** `paid`, `outstandingMinor`, `locked`, a contact balance
  and each account balance are calculated from the movements and the settlements. Two
  screens can then never show different values. There is no status column.
- **A category is an account**, with the role `ExpenseCategory` or `IncomeCategory`. The
  screens keep the word "category". The `categories` table is deprecated and nothing reads
  it.
- **One emitter for all record kinds**: `ledgerEvents` (`record-update`, `record-deleted`,
  `settlement-changed`), plus `accountEvents`. Both are in
  `$lib/server/ledger/events.ts`. One list of every kind means one stream too:
  `/api/records/stream` forwards everything the emitter carries with **no kind filter**, and
  the per-kind stream URLs retired with the screens they fed. With three emitters, a forgotten
  emit was silent; with per-kind filters, a record that was neither an expense nor an income
  appeared on no list until the page was reloaded.
- **`ledger/types.ts` is a frozen interface.** A change there is a change for every caller.
  Do not make such a change quietly.

**Which screen an account appears on.** One rule, and it is the balance-sheet /
income-statement line every accounting system draws: things with a balance a reader looks for
are **accounts** (`/accounts`); what money was earned and spent *on* is a **category**
(`/categories`). `ACCOUNT_ROLES` and `CATEGORY_ROLES` in
`components/accounts/account-roles.ts` are the one place that split is written.

Both are rows in `accounts` and both go through `accountsActions` — a category is an account
underneath, because double-entry needs both sides of a record to name one (002 FR-006a). Only
the screen differs, and it differs because a flat list of all of them failed in practice: a
real installation had 22 categories against 4 accounts that hold or owe money, so the list
read as nothing but categories. Equipment sits with the accounts (bought and kept, so it is on
the balance sheet — 002 FR-006b) even though the record form offers it beside the categories.

**The three ledgers.** `accounts` holds two of the books real bookkeeping keeps apart, and
`contacts` holds the third:

| Book | Where it lives | Shown on |
|---|---|---|
| What money was for | `accounts`, roles `ExpenseCategory` / `IncomeCategory` / `Equipment` | Accounts › Categories |
| Where money sits, and what is owed either way | `accounts`, the money-pot, Receivable/Payable, opening-balance and partner roles | Accounts › Money & owed |
| Who owes whom | `contacts` + the contact on each record | Contacts, and `/records?contact=` |

The third is the purchase and sales ledger. Real bookkeeping gives every supplier and customer
its own account behind a control account; here it is **derived from the movements** instead, so
adding a contact never touches the chart of accounts (002 FR-008a) and the per-contact figures
can never disagree with the ledger. **`contactBalances()` in `queries/settlements.ts` is its one
source** — do not add a second way to total what a contact owes.

A category is an account and a contact is not, and both are deliberate. See 002 FR-006a and
FR-008a before proposing either change; the reasoning, including why per-contact accounts make
the account list worse, is recorded there.

**Every kind has one list and one deep link.** Expense, Income, Payment, Transfer, OpeningBalance,
InvoiceIssue and Journal records all appear on the one Records screen and all open at
`/records/[id]`.

This replaced a named exception, and the reason it existed is worth keeping: Expense, Income and
Journal each had a list screen and a deep link, and the other four deliberately had neither, because
"a user does not look for these records by themselves". Each was reached from the record it belonged
to — a payment from the expense it settled, a transfer from either account's history, an opening
balance from its account's drawer. That was true while there were three screens; it stopped being
true when there was one list of everything that happened.

Result to remember: `canOpen` in `SettlementList.svelte` now returns true for every kind. It is kept
as a function rather than inlined, because it is still the one place to change if a kind ever stops
being openable.

**Named full-page exception.** Reports (`/reports/*`) are full pages, not drawers. They are wide
tables that the user reads column by column and exports, not the fields of one record. Every screen
that shows the detail of one record keeps the Sheet standard — account, opening balance, payment,
payment and record detail — so the drawer looks the same everywhere.

`/accounts/[id]/history` is **gone**. An account's movements are the Records list narrowed to that
account: `/records?account=<id>`, with a running balance, an opening figure before the first row and
a closing figure after the last. It is the same rows read the same way, so it is one screen with a
filter on it rather than a page of its own. The account drawer at `/accounts/[id]` links to it with a
relation card. The running balance disappears the moment another filter is applied or the sort
changes, and the screen says why — a balance over a filtered subset would look like a bank balance
and not be one.

### Permissions (RBAC)

Gate every action on a resource with `hasPermission(locals, resource, action)`
(`src/lib/server/permissions.ts`). Never use a role check, and never rely on a hidden button
in the client.

- `ResourceName` is a closed union (`dashboard`, `records`, `import`, `contacts`,
  `quotations`, `invoices`, `reconciliation`, `accounts`, `reports`, `adjustments`).
  `ActionName` is `view | add | change | delete`. To add a resource, add it to
  `ResourceName` and `ALL_RESOURCES` in `permissions.ts` — `ALL_RESOURCES` duplicates the
  union rather than deriving from it, so both must change together.
- `records` is one ability over every kind of record. It replaced `expenses` + `income`, which
  were two names for one store: a transfer, a payment or an opening balance was checked
  against whichever screen it happened to be recorded from, and a record entered by hand was
  covered by neither.
- Two resources have extra rules. `reports` is **view-only**: never grant `add`, `change` or
  `delete` on it anywhere, because to see a figure is not the same as to change it. **No
  seeded group grants `adjustments`** (formerly `journal`): it allows a record between any two
  accounts and a third side, so a user who has it can make the books say anything and still
  have them add up. Grant it on purpose or not at all.
- `adjustments` is checked **after** the derivation, never before: whether a record needs it is
  a fact about the accounts it names, not about what the client sent. Enforced on the server
  (`sides-from-accounts.ts`), never by hiding a control.
- `hooks.server.ts` calls `getEffectivePermissions(db, userId)` one time for each request and
  puts the result in `locals.permissions` and `locals.isSuperuser`. Route code never queries
  permissions. It only calls `hasPermission`.
- The effective permissions are the group permissions (`groupPermissions`) plus the per-user
  overrides (`userPermissions`). An override can only add a permission, never remove one. A
  group with `isSuperuser: true` passes all checks, because `hasPermission` returns early on
  `locals.isSuperuser`.
- Each API route that reads or changes a resource must call `hasPermission(locals, resource,
  action)` and return `403` if it fails. `src/routes/api/records/+server.ts` is the reference:
  `view` for GET, and `add`, `change` or `delete` for the other verbs.

### Settings Page Patterns

The Settings page (`src/routes/(app)/settings/+page.svelte`) has two patterns. Use them
again on other pages with many fields or with editable lists.

- **Unsaved-changes guard**: an `isDirty` `$derived` compares the live `$state` with the
  snapshot from the server. While the page is dirty, `beforeNavigate` stops in-app
  navigation and opens `ConfirmDialog` (`unsavedConfirmOpen`).
- **Stage locally, save one time**: an edit to a list (providers, categories, company logo)
  changes local `$state` only. Nothing goes to the DB until the single Save action runs.
  Mark a new row, so you can tell it from a saved row without a request to the server. The
  Category tab stages *account* rows and gives a new one `id: null`. The server then
  compares the staged list with the saved list and creates, renames or drops each row. A
  dropped category that has records is **archived, not deleted**, so its history stays.

### Drawer / Detail Sheet Standard

Build every record-detail drawer and every create/edit drawer on the shared `Sheet`
primitive (`$lib/components/ui/sheet`, a wrapper for the bits-ui `Dialog`) — contacts,
records, accounts, payments and so on. Follow the shape below. A
user must not be able to tell the feature from the drawer frame alone.

**Named exception — task workspaces:** a route that is a work surface with many steps can be
a full page instead of a drawer. The statement-matching route
`/accounts/[id]/reconcile/[statementId]` is the reference: matching needs the bank's lines, the
candidate records, the selection state and the actions visible at the same time, so it needs the
width and the kept context of a full page. Its sibling `/accounts/[id]/reconcile` — the statements
on one account — is a full page for the same reason. The exception changes the visual treatment
only. Each workspace must still have its own real URL that a user can deep-link and share, and
navigation to it must keep the deep-link rules below.

(This paragraph used to cite `/reconciliation/[id]/match`, a route commit `e5568b1f` had already
deleted. Reconciling became one continuous page with no address of its own, and the documented
exception went on naming a route that did not exist. The address above is real.)

**Shell**
- Desktop: the sheet comes in from the right. `width: 500px; max-width: 95vw`.
- Always put `gap:0;` in the inline `style=` of `Sheet.Content`. The base
  `sheet-content.svelte` has a Tailwind `gap-4` (16px) flex gap between its children. The
  header, body and footer set their own padding, so this gap only adds empty space above the
  first field or the amount.
- Mobile: the sheet comes up from the bottom (`panelSide = isMobile ? 'bottom' : 'right'`).
  - A full-view sheet (record detail or edit, `height: 100dvh`) gets **square** corners. It
    covers the whole screen, so a radius looks like a fault.
  - A part-height sheet, such as a filter panel, keeps **rounded** top corners
    (`16px 16px 0 0`).

**Header** (`padding: 22px 22px 16px`, border at the bottom)
- Left: `.sheet-eyebrow` (a small grey label or icon) and `.sheet-title-text`.
- Right: the close button **only** (`Sheet.Close` with class `sheet-close` and the `X` icon,
  size 16). Never put a menu, a status badge or another action here. These go in the body or
  in the footer.

**Body** (`padding: 20px 22px`, scrollable, `flex: 1`)
- Show the amount in large text (`.detail-amount`) for a record with a money value.
- Show a true lifecycle status with `StatusBadge.svelte` in `.detail-statusrow`, directly
  below the amount. Never in the header.
- Forms use the `.field` and `.field-label` classes.
- Put the attachments and the audit trail at the end of the body, in this order:
  `AttachmentManager.svelte` first, then `<AuditTrail recordType="..." recordId={...} />`
  last. Each create, update and delete action must call `recordAudit` or `diffRecords`
  (`src/lib/server/audit.ts`) after the DB write. The client keeps a `bind:this` reference to
  `AuditTrail` and calls `.refresh()` after a successful save, so the trail updates without a
  page reload.

**Footer** (`.sheet-foot`, defined one time in `layout.css` — do not define it again on a
page)
- The footer is sticky. It is *outside* the scrollable body. In a form, the `<form>` element
  is the flex column (`flex:1; display:flex; flex-direction:column; overflow:hidden;`), and
  the scrollable fields div and the `.sheet-foot` are its children.
  `contacts/+page.svelte` is the reference.
- `.sheet-foot-note` is optional: grey 12px text above the buttons, for extra information.
- `.sheet-foot-actions` is a flex row, `gap: 8px`, aligned right. Use the shared button
  classes from `layout.css`:
  - `.sheet-btn` — the plain outline button.
  - `.sheet-btn-delete` — `.sheet-btn` with a gap for the icon. Always the `Trash2` icon
    (size 14) and the label "Delete". It is the first action on the left; use
    `margin-right:auto` to hold it at the far left when Cancel and Save are also there. If a
    relation blocks the delete, set `disabled` and add a `title` tooltip — for example a
    settled or reconciled record, a contact in use, or an account with movements. Do not
    hide the button.
  - `.sheet-btn-primary` — the filled primary button (Save, Record payment, and so on), last
    on the right.
- Delete always uses the shared `ConfirmDialog.svelte` (`danger` prop) and a hidden
  `<form method="POST" action="?/delete">` that you submit with `requestSubmit()`. Never a
  menu in the header.

**Status chips**
- Show each true lifecycle status with `StatusBadge.svelte` — paid, part-paid or owed for a
  record; draft, sent or paid for an invoice. Do not write an inline
  `<span class="statusbadge ...">`. Add a new tone or label to the `byLabel` and `byCode`
  maps in the component.
- A contact role badge is not a lifecycle status. It keeps its own pill style with
  `var(--secondary)`. This difference is deliberate. Do not "fix" it.

### Cross-Feature Relation Cards

A record-detail sheet often shows a reference to a *different* record — the history of an
account, or the payments that settled an expense. Use one of the two shapes below. **Both
shapes follow the same interaction rules.** A user must not see two references that look the
same but behave differently.

**Two shapes, same rules**
- **Single-record reference** (this record points to one other record) — icon box (`34×34`,
  radius 7, `background: var(--accent)`), title with status, grey second line, chevron at the
  end. Reference: `.ob-card` in `components/accounts/AccountSheet.svelte`.
- **List of many** (this record has many records of another type) — compact row, no icon box,
  main text and grey second line on the left, optional `StatusBadge` or amount, chevron at
  the end. Reference: `components/ledger/SettlementList.svelte`.

**Interaction rules (both shapes)**
- If the card or row has **one** action only (go to the related record), make the whole
  element a `<button type="button">`. Do not use a `<div>` with a link inside it.
- Add the shared `related-link` class next to the layout class. It is defined one time in
  `layout.css` and gives `cursor: pointer` and the hover style
  (`border-color: var(--primary); background: var(--accent);`). Do not write this hover rule
  again per feature.
- End with a `ChevronRight` (size 13–14, `color: var(--muted-foreground)`). It shows the user
  that the element is clickable, also without hover.
- Navigate with the deep-link pattern below. Never render the detail sheet of the other
  feature inside this one.

**Rows with more than one action keep the same hover**
- A row with two or more independent actions also gets the `related-link` class — for example
  `.attach-item` in `AttachmentManager`, which opens a file and deletes it. The row then has
  the same `border-color` and `background` hover as a single-action card.
- Do not add the hover to the elements inside the row. The row hover is enough. Only an
  action with a different result keeps its own hover, such as the destructive hover of the
  delete button.
- **Exception to the `<button onclick={goto(...)}>` rule**: use a real `<a href>` when the
  main action opens a URL outside the app, such as an uploaded file. The browser then gives
  its normal behaviour — the context menu, Ctrl/Cmd-click for a new tab, and middle-click.
  Put everything except the other actions inside the anchor (see `.attach-link-area` in
  `AttachmentManager.svelte`). A `<button>` cannot be inside an `<a>`, so the delete button
  stays outside the anchor as its own click target. Use the `goto()` button only for
  navigation inside the app, where there is no real href.

**Deep-link pattern (each record has a URL the user can share)**

Each record detail (records, contacts, accounts) has a real path, `/<feature>/[id]`, so a
user can copy the URL while the sheet is open and send it to another person. The Sheet stays the only visual treatment; there is no separate full-page detail
view. SvelteKit shallow routing does this (`pushState` and `history.back()`). Do not add a
second kind of route.

- Each feature has one shared page component
  (`$lib/components/<feature>/<Feature>Page.svelte`), rendered by **two** small routes:
  `/<feature>/+page.svelte` passes `openId={null}`, and `/<feature>/[id]/+page.svelte`
  passes `openId={data.open<Feature>Id}`. The `+page.server.ts` of both routes calls the same
  loader (`$lib/server/loaders/<feature>.ts`), so the load logic and the actions stay in one
  place. **Records is the worked example**: `RecordsPage.svelte` + `/records` + `/records/[id]`
  + `loaders/records.ts`. It is one screen where there were three — Expenses, Income and
  Journal were three copies of this same pattern over one store, and the loader they now share
  is the one that used to differ between them in three lines.
- The shared loader redirects to the list (`/<feature>`) if `openId` is not one of the loaded
  records — the record is deleted, the id is wrong, or the user has no access to it.
- A click on a row calls the open-detail function of the page. The function sets the local
  `$state` record **and** calls
  `pushState(resolve('/(app)/<feature>/[id]', { id: String(id) }), { viaPush: true })`. This
  changes the URL without a navigation, so the SSE connection and the scroll position stay.
- The X button, the overlay and Escape all go through `onOpenChange` of `Sheet.Root` and call
  `closeDetail()`. `closeDetail()` reads `page.state.viaPush` from `$app/state`. If it is
  true, call `history.back()`: this returns to the list URL, and the browser and mobile back
  buttons then work for free. If it is false, the user came from a pasted link or a reload
  and there is no useful history entry, so call
  `goto(resolve('/<feature>'), { replaceState: true })`.
- On mount, if the page got an `openId`, call the open-detail function with `{ push: false }`.
  This was a real navigation to `/<feature>/[id]`, so the URL is already correct.
- A button that goes to another feature calls
  `goto(resolve('/(app)/<feature>/[id]', { id: String(targetId) }))` directly, with no query
  string. Example: the "See every movement" card in the account drawer.
- References: `openRecord` and `closeDetail` in `RecordsPage.svelte`; `openDetail` and
  `closeDetail` in `AccountsPage.svelte`. Contacts is a variant: `/contacts/[id]` opens the
  shared edit form directly (`openEdit(c, { push: false })`), and only an edit of an
  *existing* contact gets a URL — "Add contact" does not. Copy this pattern exactly for each
  new feature that needs a detail sheet.

## Tooling

**The two Vitest projects need two different runtimes, so `bun run test` runs them one after
the other.**

- The `server` project runs under **Bun** (`bun --bun vitest --project server`). The
  upgrade-conversion spec tests against a real temporary SQLite database, as the constitution
  requires, and that needs `bun:sqlite`.
- The `client` project runs under **Node** (`vitest --project client`). Playwright cannot
  start a browser under Bun. It fails after about one minute with `Failed to connect to the
  browser session … within the timeout`.

`bun run test` runs both. `bun run test:unit` is the Bun one, so add `--project server` when
you use it directly. A server spec under Node fails on `bun:sqlite`, and a client spec under
Bun stops at the browser.

Two more results of the Bun half:

- `vite.config.ts` sets `ssr.noExternal: ['zod']`. If zod stays external, Bun's CJS interop
  gives a namespace with no `z` on it, and **every** spec that imports a schema fails with
  `undefined is not an object (evaluating 'z.object')`. Production is not affected.
- Keep the normal `import { z } from 'zod'`. The fix belongs in the config, not in a hundred
  import statements.

**Prettier needs `.prettierignore` to be usable.** Without it, Prettier reads the whole tree
and reports about 3,900 files. About 3,600 of them are build output under `src-tauri/`, so
`bun run lint` can never pass. Prettier does not read `.gitignore`, so repeat there each path
that git ignores but that is still on the disk. There is still no Prettier config, so
`prettier-plugin-svelte` never loads and Prettier skips all `.svelte` files. The other ~200
failures in `src` are an old mix of tabs and spaces. Fix them as their own chore, not inside
a feature branch.

## Gotchas

**`bun run check` breaks a dev-server tab that is already open.** `check` runs
`svelte-kit sync`, which writes `.svelte-kit/generated/client/nodes/*.js`, `root.js` and
`matchers.js` again. Vite reloads these modules, but a tab that loaded before the change keeps
the old map from route to node. A route index can then load a different page component than
the server rendered. The symptoms do not look like a tooling problem:

- The page is **blank**. The URL is correct, but the `<title>` is wrong, or it is the
  root-layout title.
- The console shows an error from a component that you did not open — for example
  `ReportsPage.svelte:203 Cannot read properties of undefined (reading 'length')`, because
  `ReportsPage` got the data of another route.
- Before that error, the console shows `Failed to hydrate: HierarchyRequestError: Failed to
  execute 'appendChild' on 'Node'`, because the SSR HTML is for the route you asked for.

You can repeat this at any time: open a page, run `bunx svelte-kit sync`, and watch it break.
**A reload does not repair it** — the browser keeps the modules of the old optimizer hash. To
repair: stop the dev server, `rm -rf node_modules/.vite`, start the server, reload the page.
The app code is correct, so do not look for a bug in the component that the stack trace
names.

Rule: run `bun run check` when no dev client is open. If you cannot, expect to restart the
dev server after it.

**`$lib/server` cannot be imported in the client.** SvelteKit blocks each `$lib/server/*`
import in a `.svelte` file at build time. Some rules are needed on both sides: the record
lock (`ledger/locking.ts`), the display sign (`ledger/account-type.ts`), the derived paid
state (`ledger/settlement-rules.ts`), and the balance rule the record form shows live as extra
sides are added (`ledger/entry-builder.ts`). These rules are copied by hand into client files.
Each copy has a comment that explains the rule:
`// Mirrors src/lib/server/<file>.ts's <fnName> — ...`. See:

- `components/accounts/display-sign.ts` — the display sign, and the role groupings the accounts
  screen reads. Its `ROLE_GROUPS` consumer is gone: the account list is flat now, and the six
  headings became filter values in `account-roles.ts`.
- `components/ledger/record-status.ts` — the derived paid state, and the cleared label.
- `components/ledger/journal-rules.ts` — the balance rule. It moved here from
  `components/journal/` when the Journal screen was folded into Records; the form that shows a
  running difference live is now `RecordSheet.svelte`.

Keep the two copies the same by hand. No import enforces this, and any new client mirror needs
its own `// Mirrors …` comment.

Better: do not make a copy. `GET /api/records` already returns `paid`, `outstandingMinor`,
`locked` and `lockedReason` from the server, so a screen that only displays these values
needs no copy of the rule. Copy a rule only when it must run before a request to the server.
