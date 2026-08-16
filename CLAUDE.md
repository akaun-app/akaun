# Akaun Web — Claude Code Notes

## Verification Policy

Do not attempt automated browser/UI testing or live verification (no Playwright, no logging into the dev server, no scraping `.env` for credentials to drive a session). Verify changes via static code analysis only: read the diff, check types/lint (`bun run check`, `bun run lint`), and reason about correctness from the code. Leave visual/behavioral confirmation to the user.

**`data/` is real. Never write a script that touches it.** `DATABASE_PATH` and
`STORAGE_PATH` default to paths *relative to the working directory*, and `.env` sets them
to `./data/akaun.db` and `./data/storage` — so any process started in the project root
points at the maintainer's real books and receipts. Overriding those variables inside an
ad-hoc script does **not** isolate it. This has destroyed a real `data/` directory and
required a full restore; the same accident happened again from a running dev server.

Concretely, before doing anything that could run application code:

1. **Check for a running dev server** (`ps aux | grep "vite dev"`). SvelteKit's `init()`
   runs `ensureLedgerUpgrade`, so a dev server converts the books and moves attachment
   files — by design (FR-037: the installation updates itself, with no command and no
   setting) — and it does so again on every restart your file edits trigger. If that is
   not what you want right now, stop the server before editing, not after.
2. **The upgrade refuses to run under a test runner**, and takes its paths as arguments
   (`runLedgerUpgrade(db, guard, { databasePath, storageRoot })`), so a test must supply
   its own. Handing it a temporary *database* is not enough on its own — the files are
   configured separately, which is exactly how the first accident happened.
3. **Hash `data/akaun.db` before and after** anything you're unsure of. That is a cheap,
   decisive check, and it is what finally distinguished cause from coincidence here.

## Architecture Decisions

### Real-Time Updates: SSE-Only

All features that need live UI updates must use **Server-Sent Events (SSE)**, not polling.

**Pattern:**
- Create a `GET` endpoint at `src/routes/api/<feature>/stream/+server.ts` that returns a `ReadableStream` with `Content-Type: text/event-stream`
- Use the singleton `importEvents` EventEmitter pattern (`src/lib/server/import/events.ts`) — create a parallel `<feature>Events` emitter for each domain
- Every server action (POST, PATCH, DELETE) that mutates state must call `events.emit(...)` after the DB write so all connected clients see the change
- On the client, open the EventSource in `onMount` and close it in `onDestroy` — never in `$effect` (which re-runs on reactive dependency changes and would tear down the connection)

**Client merge pattern** (`mergeServerJobs` in the import page is the reference implementation):
- On connect, the stream sends a full snapshot of current state
- Subsequent events are incremental updates (`item-update`, `item-deleted`, etc.)
- `mergeServerJobs`-style merge: update existing items, prepend brand-new items from other tabs
- Do **not** add items to local `$state` optimistically from the upload/create action — let the SSE event be the sole driver. This eliminates race conditions between the fetch response and the SSE event arriving on the same connection.
- Do **not** store non-plain objects (e.g. `File`, `Blob`) in Svelte 5 `$state` — keep them in a plain `Map` alongside the reactive array

**Snapshot vs. no-snapshot:**
- Import queue (small, finite set of active jobs): send a full snapshot on connect so reconnects catch up automatically.
- Paginated lists (income, expenses, accounts): **no snapshot**. SSR provides the initial state; SSE provides incremental updates only. If the connection drops briefly, `EventSource` auto-reconnects and the next event re-syncs the affected item. A full page reload re-fetches the correct state.

**Why not polling?**
Polling was considered and rejected. SSE gives instant updates, no wasted requests, and simpler client code once the pattern is established.

### The Ledger: One Record Store, Two Sides

Every record says where money came from and where it went. `ledger_records` is what
happened; `ledger_movements` is each side of it, against an account in `accounts`.
Expenses and Income are **filtered views of the one store**, not tables of their own.

- **Money is whole cents in an integer column** (`amount_minor`, signed). Never float
  arithmetic on money. A record also keeps the decimal `amount` the user typed plus its
  locked `exchange_rate`, for display and audit — that figure is **never summed for a
  report**. `ledger/money.ts` is the only converter.
- **A movement is positive when value goes INTO that account, negative when it leaves,
  and a record's movements always sum to zero.** So money we owe, income earned and
  owner capital all sit at negative balances; `ledger/account-type.ts`'s `displaySign`
  flips them for display in **one** place. Don't flip a sign anywhere else — including
  in a CSV export, which must read the same way round as the screen it came from.
- **`ledger/entry-builder.ts` is the single place movements are constructed.** Screens
  describe what happened in everyday terms (`kind: 'expense'`, `paidFromAccountId`); the
  builder turns that into sides and is the one enforcement point for the balance rule.
  A route or service that assembles movements itself is a defect.
- **Nothing about payment state is stored.** `paid`, `outstandingMinor`, `locked`, a
  contact's balance and every account balance are computed from movements and
  settlements, so two screens can never disagree. There is no status column.
- **A category *is* an account** (`ExpenseCategory` / `IncomeCategory` role). The word
  "category" stays on screen; the `categories` table is deprecated and unread.
- **One emitter for every kind of record**: `ledgerEvents` (`record-update`,
  `record-deleted`, `settlement-changed`) plus `accountEvents`, both in
  `$lib/server/ledger/events.ts`. Each stream filters `ledgerEvents` down to its own
  kind — `/api/expenses/stream` and `/api/income/stream` keep their URLs. Three emitters
  meant forgetting one was silent; one emitter carrying the kind removes that.
- **`ledger/types.ts` is the interface freeze.** Changing a type there is a change every
  caller sees — treat it as a broadcast, not a quiet edit.

**Named URL exception — the kinds with no screen of their own.** Expense, Income and
Journal records each have a list screen and a `/<feature>/[id]` deep link. **Payment,
Transfer, OpeningBalance and InvoiceIssue records deliberately do not**, because none of
them is a thing a user goes looking for by itself — each is reached from the thing it
happened to:

| Kind | Where you find it |
|---|---|
| Payment | The expense or invoice it settled, through `SettlementList` |
| Transfer | The history of either account it moved money between |
| OpeningBalance | Its account's drawer, as "Starting balance" |
| InvoiceIssue | The invoice that created it |

Consequence to keep in mind: `SettlementList.svelte`'s `canOpen` links only Expense and
Income rows, so a payment row renders without a chevron — a deliberately dead-ended row
rather than a chevron that goes nowhere. If a payments list is ever added, that is the one
function to update. This is the Principle VI exception recorded in writing; `plan.md`'s
Complexity Tracking records the separate, larger claims exception.

**Named full-page exception.** Reports (`/reports/*`) and an account's history
(`/accounts/[id]/history`) are full pages, not drawers: they are multi-column tables read
side by side and exported, not a record's fields. Each still has its own deep-linkable
URL. Every screen that *is* a record detail — account, opening balance, payment, journal
entry, record detail — keeps the Sheet standard, so the drawer chrome stays uniform.
Note the split on accounts: `/accounts/[id]` is the drawer (shallow-routed), and
`/accounts/[id]/history` is the report the drawer links to through the relation-card
contract.

### Permissions (RBAC)

Every resource action gates through `hasPermission(locals, resource, action)` (`src/lib/server/permissions.ts`) — never through role checks or client-side hiding alone.

- `ResourceName` is a closed union (`dashboard`, `expenses`, `income`, `import`, `contacts`, `quotations`, `invoices`, `reconciliation`, `accounts`, `reports`, `journal`); `ActionName` is `view | add | change | delete`. Adding a new resource means adding it to `ResourceName`/`ALL_RESOURCES` in `permissions.ts`.
- Two of those carry rules of their own. `reports` is **view-only** — it must never be granted `add`/`change`/`delete` anywhere, because seeing every figure is a different thing from being able to change one. `journal` is granted by **no seeded group**: entering a record's two sides by hand is how the books can be made to say anything, so it is granted deliberately or not at all.
- `hooks.server.ts` calls `getEffectivePermissions(db, userId)` once per request and stores the result on `locals.permissions` / `locals.isSuperuser`. Route code never queries permissions itself — it only calls `hasPermission`.
- Effective permissions = union of the user's group permissions (`groupPermissions`), OR'd with any per-user overrides (`userPermissions`) — overrides are additive, never restrictive. A group with `isSuperuser: true` bypasses all checks (`hasPermission` short-circuits on `locals.isSuperuser`).
- Every API route that reads or mutates a resource must call `hasPermission(locals, resource, action)` and return a `403` on failure — see `src/routes/api/income/+server.ts` for the reference shape (`view` for GET, `add`/`change`/`delete` for the corresponding verbs).

### Settings Page Patterns

The consolidated Settings page (`src/routes/(app)/settings/+page.svelte`) established two patterns other multi-field or list-editing pages should reuse:

- **Unsaved-changes guard**: an `isDirty` `$derived` compares live `$state` against the server-loaded snapshot. `beforeNavigate` intercepts in-app navigation while dirty and opens `ConfirmDialog` (`unsavedConfirmOpen`) instead of navigating away.
- **Stage locally, save once**: edits to list-like settings (providers, categories, company logo) mutate local `$state` only — nothing hits the DB until the page's single Save action runs. A locally-added, not-yet-persisted row is marked so it can be told apart from saved rows without a round-trip — the Category tab stages *account* rows and marks a new one with `id: null`, then diffs the staged list server-side into create / rename / drop. A dropped category that already has records is **archived, not deleted**, so its history survives.

### Drawer / Detail Sheet Standard

Every record-detail and create/edit drawer (contacts, expenses, income, accounts, payments, journal entries, etc.) is built on the shared `Sheet` primitive (`$lib/components/ui/sheet`, a bits-ui `Dialog` wrapper) and must follow this shape. The goal is that a user can't tell which feature they're in from the drawer chrome alone.

**Named exception — task workspaces:** A route whose primary purpose is a multi-step working surface may use a full-page workspace instead of a drawer/detail sheet. The reconciliation matching route, `/reconciliation/[id]/match`, is the reference exception: matching needs simultaneous access to bank transactions, candidate records, selection state, and reconciliation actions, so the available width and persistent context of a full workspace are essential. This exception changes only the visual treatment; each workspace must still have its own real, deep-linkable and shareable URL, and navigation to it must preserve the deep-link rules documented below.

**Shell**
- Desktop: slides in from the right, `width: 500px; max-width: 95vw`.
- Always include `gap:0;` in the `Sheet.Content` inline `style=`. The base `sheet-content.svelte` ships a Tailwind `gap-4` (16px) flex gap between its children; since header/body/footer already control their own spacing via padding, the extra flex gap just adds unwanted dead space above the hero amount/first field.
- Mobile: slides up from the bottom (`panelSide = isMobile ? 'bottom' : 'right'`).
  - Full-view sheets (record detail/edit, `height: 100dvh`) get **square** corners — they cover the whole viewport so a radius reads as a bug, not a feature.
  - Partial-height sheets (e.g. filter panels) keep **rounded** top corners (`16px 16px 0 0`).

**Header** (`padding: 22px 22px 16px`, border-bottom)
- Left: `.sheet-eyebrow` (small muted label/icon) + `.sheet-title-text`.
- Right: **only** the close button (`Sheet.Close` with class `sheet-close` + `X` icon, size 16). Never put a dropdown menu, status badge, or any other action here — those belong in the body or footer.

**Body** (`padding: 20px 22px`, scrollable, `flex: 1`)
- Hero amount (`.detail-amount`) for records with a monetary value.
- A true lifecycle status renders via `StatusBadge.svelte` inside `.detail-statusrow`, directly under the hero amount — never in the header.
- Forms use the existing `.field` / `.field-label` conventions.
- Attachments and the audit trail go at the bottom of the body, in that order: `AttachmentManager.svelte` first, then `<AuditTrail recordType="..." recordId={...} />` last. Every create/update/delete action must call `recordAudit`/`diffRecords` (`src/lib/server/audit.ts`) after the DB write; the client holds a `bind:this` ref to `AuditTrail` and calls `.refresh()` on it after a successful save so the trail updates without a full reload.

**Footer** (`.sheet-foot`, defined once in `layout.css` — don't redeclare it per page)
- Sticky: lives *outside* the scrollable body, not inside it. For forms, this means the `<form>` itself is the flex column (`flex:1; display:flex; flex-direction:column; overflow:hidden;`) with a scrollable fields div and a non-scrolling `.sheet-foot` as siblings inside it — see `contacts/+page.svelte` for the reference implementation.
- Optional `.sheet-foot-note` (muted, 12px) above the action row for contextual info.
- `.sheet-foot-actions`: flex row, `gap: 8px`, right-aligned, using the shared button classes from `layout.css`:
  - `.sheet-btn` — base neutral outline button.
  - `.sheet-btn-delete` — `.sheet-btn` + icon gap; always `Trash2` (size 14) + "Delete" label, leftmost action (use `margin-right:auto` to pin it to the far left when Cancel/Save also exist). Add `disabled` + a `title` tooltip when deletion is blocked by a relationship (a settled or reconciled record, an in-use contact, an account holding movements, etc.) — don't silently hide the button.
  - `.sheet-btn-primary` — filled primary button (Save / Record payment / etc.), rightmost.
- Delete always routes through the shared `ConfirmDialog.svelte` (`danger` prop) + a hidden `<form method="POST" action="?/delete">` submitted via `requestSubmit()`. Never a header dropdown/kebab menu.

**Status chips**
- Any true lifecycle status (a record's paid / part-paid / owed, an invoice's draft / sent / paid) goes through `StatusBadge.svelte` — don't hand-roll an inline `<span class="statusbadge ...">`. Add new tones/labels to its `byLabel`/`byCode` maps rather than duplicating the markup.
- Role badges (contacts) are a different concept — not a lifecycle status — and intentionally keep their own pill style using `var(--secondary)`. This is a deliberate exception, not a gap to "fix".

### Cross-Feature Relation Cards

Whenever a record-detail sheet shows a reference to a *different* record (e.g. an account's own history, the payments that settled an expense), the card/row must follow one of the two shapes below, and **both shapes share the same interaction contract**. The goal: a user shouldn't see two different "this points at another record" affordances that behave differently.

**Two shapes, same contract**
- **Single-record reference** (this record points at exactly one other record) — icon box (`34×34`, radius 7, `background: var(--accent)`) + title/status + muted subline + trailing chevron. Reference: `.ob-card` in `components/accounts/AccountSheet.svelte`.
- **List-of-many** (this record has many of another type linked to it) — compact row, no icon box, primary text + muted subline on the left, optional `StatusBadge`/amount, trailing chevron. Reference: `components/ledger/SettlementList.svelte`.

**Interaction contract (applies to both shapes)**
- If the card/row has exactly **one** action (navigate to the related record), the whole element is a `<button type="button">`, not a wrapped `<div>` with an inner link.
- Add the shared `related-link` class (defined once in `layout.css`) alongside the layout class — it provides `cursor: pointer` and the hover treatment (`border-color: var(--primary); background: var(--accent);`). Don't redeclare this hover rule per feature.
- End with a trailing `ChevronRight` (size 13–14, `color: var(--muted-foreground)`) as a static "this is clickable" affordance hint, visible even without hovering.
- Navigate via the deep-link pattern below — never inline-render the other feature's detail sheet.

**Multi-action rows still share the `related-link` hover**
- A row with more than one independent action (e.g. `AttachmentManager`'s `.attach-item`: open file, delete) still gets the shared `related-link` class for visual consistency with single-action relation cards — same `border-color`/`background` hover on the row.
- Don't duplicate the hover on the inner action elements too — the row hover already signals interactivity. Only the action that has a *different* effect than "this row relates to something" — e.g. the delete button's destructive hover — keeps its own distinct hover.
- **Exception to the `<button onclick={goto(...)}>` rule above**: when the primary action navigates to a real URL outside the app (e.g. opening an uploaded file, not another Akaun record), use a real `<a href>` instead of a `goto()` button, so native browser behaviors work — right-click context menu, Ctrl/Cmd-click to open in a new tab, middle-click. Wrap everything except the other action(s) in the anchor (see `.attach-link-area` in `AttachmentManager.svelte`); a `<button>` can't nest inside `<a>`, so sibling actions like delete stay outside it as their own click targets. The `goto()`-button pattern is reserved for in-app SPA navigation, where there's no real href to give native semantics to anyway.

**Deep-link pattern (every record is a shareable URL)**

Every record detail (expenses, income, contacts, accounts) is reachable at a real path, `/<feature>/[id]`, so a user can copy the URL while a sheet is open and send it to someone else. The Sheet stays the only visual treatment — there is no separate full-page detail view — this is achieved with SvelteKit shallow routing (`pushState`/`history.back()`), not a second route paradigm.

- Each feature has a shared page component (`$lib/components/<feature>/<Feature>Page.svelte`) rendered by **two** thin routes: `/<feature>/+page.svelte` (passes `openId={null}`) and `/<feature>/[id]/+page.svelte` (passes `openId={data.open<Feature>Id}`). Both routes' `+page.server.ts` call one shared loader (`$lib/server/loaders/<feature>.ts`) so actions/load logic live in one place.
- The shared loader redirects to the bare list (`/<feature>`) if `openId` doesn't match a loaded record (deleted, bad id, no access to that specific record).
- In-app, clicking a row calls the page's open-detail function, which sets the local `$state` record **and** calls `pushState(resolve('/(app)/<feature>/[id]', { id: String(id) }), { viaPush: true })` — this updates the URL live without a real navigation, so SSE connections and scroll position are preserved.
- Closing (X / overlay / Escape, all routed through `Sheet.Root`'s `onOpenChange`) calls a `closeDetail()` that checks `page.state.viaPush` (from `$app/state`): if true, `history.back()` (unwinds to the list URL we pushed from, and gives the browser/mobile back button this behavior for free); if false (arrived via a pasted link or page refresh, no useful history entry), `goto(resolve('/<feature>'), { replaceState: true })`.
- On mount, if `openId` was passed in (a real navigation to `/<feature>/[id]`, not an in-app click), the open-detail function is called with `{ push: false }` since the URL is already correct.
- Cross-feature navigation buttons (e.g. an account drawer's "See every movement" card) call `goto(resolve('/(app)/<feature>/[id]', { id: String(targetId) }))` directly — no query strings.
- Reference implementations: `openExpense`/`closeDetail` in `ExpensesPage.svelte`, `openDetail`/`closeDetail` in `AccountsPage.svelte`. Contacts is a variant — `/contacts/[id]` opens the existing shared edit form directly (`openEdit(c, { push: false })`); only editing an *existing* contact gets a URL, "Add contact" does not. Copy this pattern verbatim for any new feature that needs a detail sheet.

## Tooling

**The two Vitest projects need two different runtimes, so `bun run test` runs them
separately.**

- `server` runs under **Bun** (`bun --bun vitest --project server`). It has to: the
  upgrade-conversion spec tests against a real temporary SQLite database, as the
  constitution requires, and that needs `bun:sqlite`.
- `client` runs under **Node** (`vitest --project client`). It has to: Playwright cannot
  launch a browser under Bun's runtime — it fails with `Failed to connect to the browser
  session … within the timeout` after about a minute.

`bun run test` chains both. `bun run test:unit` is the Bun one, so pass
`--project server` when using it directly; a server spec run under Node dies on
`bun:sqlite`, and a client spec run under Bun hangs on the browser.

Two further consequences of the Bun half:

- `vite.config.ts` sets `ssr.noExternal: ['zod']`. Left external, zod resolves through
  Bun's CJS interop to a namespace with no `z` on it, and **every** spec that imports a
  schema dies with `undefined is not an object (evaluating 'z.object')`. Production is
  unaffected.
- Keep using the idiomatic `import { z } from 'zod'`. The fix belongs in the config, not
  in a hundred import statements.

**Prettier needs `.prettierignore` to be usable at all.** Without it Prettier walks the
whole tree and reports ~3,900 files, 3,600 of them build output under `src-tauri/` — so
`bun run lint` could never pass. Note `.gitignore` is *not* consulted by Prettier, so
anything ignored there that is still on disk has to be repeated. There is still no
Prettier config, so `prettier-plugin-svelte` never loads and `.svelte` files are skipped
entirely; the remaining ~200 `src` failures are a pre-existing tabs-vs-spaces split, best
fixed as its own chore rather than inside a feature branch.

## Gotchas

**`bun run check` wedges any dev-server client that's already open.** `check` runs `svelte-kit sync`, which regenerates `.svelte-kit/generated/client/nodes/*.js`, `root.js` and `matchers.js`. Vite hot-reloads those modules, but a browser tab loaded before the regen keeps the old route→node mapping, so a route index can resolve to a *different* page component than the one the server rendered. The symptoms are misleading and look nothing like a tooling problem:

- The page goes **blank** with the correct URL but the wrong (or root-layout) `<title>`.
- The console throws from a component you never navigated to — e.g. `ReportsPage.svelte:203 Cannot read properties of undefined (reading 'length')`, because `ReportsPage` got mounted with another route's `data`.
- It's preceded by `Failed to hydrate: HierarchyRequestError: Failed to execute 'appendChild' on 'Node'`, since the SSR HTML is for the route you actually requested.

This is reproducible on demand: open a page, run `bunx svelte-kit sync`, watch it break. **A plain reload does not fix it** — the browser keeps modules keyed to the old optimizer hash. Recovery is: stop the dev server, `rm -rf node_modules/.vite`, restart, reload. Nothing is wrong with the app code, so don't go bug-hunting in the component the stack trace names.

Practical rule: run `bun run check` when no dev client is open, or treat the page as needing a full restart afterwards.

**`$lib/server` can't be imported client-side.** SvelteKit strips/blocks `$lib/server/*` imports from `.svelte` files at build time. Rules that both halves need — the record lock (`ledger/locking.ts`), the display sign (`ledger/account-type.ts`), the derived paid state (`ledger/settlement-rules.ts`), the balance rule the journal screen previews (`ledger/entry-builder.ts`) — are hand-duplicated client-side with a `// Mirrors src/lib/server/<file>.ts's <fnName> — ...` comment explaining the rule. See `components/accounts/display-sign.ts`, `components/ledger/record-status.ts`, `components/journal/journal-rules.ts`. Keep both copies in sync manually — there's no shared import to enforce it.

Prefer *not* needing a mirror: `GET /api/records` already returns `paid`, `outstandingMinor`, `locked` and `lockedReason` computed server-side, so a screen that just displays them needs no copy of the rule at all. Mirror only what has to run before a round trip.
