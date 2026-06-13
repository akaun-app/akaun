# Akaun Web — SvelteKit Rebuild Plan

## Context

Rebuilding the SwiftUI personal finance tracker (Akaun) as a SvelteKit webapp hosted on a public VPS. The app tracks expenses, income, and reimbursement claims for a single user (freelancer/small business). Key requirements: web UI for daily use, REST API compatible with iOS Shortcuts for quick expense logging on mobile, SQLite now with a clean PostgreSQL migration path. Reference docs: `/Users/tanghaoquan/Code/Akaun/WEBAPP_REFERENCE.md`, `/Users/tanghaoquan/Code/Akaun/CLAUDE.md`.

---

## Architecture Decisions

- **ORM**: Drizzle ORM (`drizzle-orm` + `better-sqlite3`) — same schema works for SQLite and PostgreSQL; swapping DB is a one-file change
- **Adapter**: `@sveltejs/adapter-node` (required for `better-sqlite3`; replaces `adapter-auto`)
- **Auth**: Session-based auth for web UI (login page + `httpOnly` session cookie); Bearer token for all `/api/*` routes (iOS Shortcuts). Schema is multi-user-ready from day one; single active user at launch.
- **Money**: Stored as `REAL` (float) in SQLite; `NUMERIC(10,2)` on PostgreSQL migration for precision. Display with `Intl.NumberFormat` (2 decimal places).
- **Multi-user & permissions**: Single shared ledger (not per-user-isolated data). `users` table holds login credentials only. Access control is via **groups**: a `groups` table (with an `is_superuser` flag), a `group_permissions` grid (view/add/change/delete per resource), and a `user_groups` many-to-many join. Superusers (members of any `is_superuser` group) bypass the grid entirely; everyone else gets the union of permissions across their groups. Users may belong to zero groups (locked-out-but-not-deleted state). See **Phase 2.5** for full detail. `user_id` FK on entity tables (`expenses`, `incomes`, `claims`, etc.) is retained as a `created_by`-style audit field, not as a data-visibility filter.
- **OCR**: Tesseract.js (server-side WASM, no system binary needed) + `pdf-parse` for text PDFs
- **Charts**: Chart.js (bar, donut, grouped bar) via Svelte 5 `$effect` canvas wrappers
- **Svelte 5**: All state with `$state`/`$derived`/`$effect` runes — no legacy stores

---

## Phase 1 — Foundation

### Packages to Install
```bash
bun add drizzle-orm better-sqlite3 argon2
bun add -d @sveltejs/adapter-node drizzle-kit @types/better-sqlite3
```

### Files to Create/Modify

**`vite.config.ts`** — Change `adapter-auto` import to `adapter-node`

**`src/lib/server/db/schema.ts`** — All Drizzle table definitions:
- `users` — id, email (UNIQUE), password_hash, first_name, last_name, bearer_token (TEXT, UNIQUE, nullable — for `/api/*` Shortcuts auth), created_at. No role/permission columns — access is entirely group-derived (see Phase 2.5).
- `groups` — id, name (UNIQUE), description, is_superuser (boolean, default `false`)
- `group_permissions` — group_id (FK → groups, CASCADE), resource (TEXT), can_view, can_add, can_change, can_delete (booleans, default `false`); PK (group_id, resource)
- `user_groups` — user_id (FK → users, CASCADE), group_id (FK → groups, CASCADE); PK (user_id, group_id)
- `expenses` — id, expense_number (UNIQUE), item_name, supplier, reference, remark, category, status (unpaid/pending/paid), date (TEXT YYYY-MM-DD), **amount REAL NOT NULL**, claim_id (FK → claims, SET NULL), **created_by (FK → users)**, **updated_by (FK → users)**, created_at, updated_at
- `incomes` — id, income_number, source, description_text, reference, remark, category, date, **amount REAL NOT NULL**, **created_by (FK → users)**, **updated_by (FK → users)**
- `claims` — id, claim_number, date, status (pending/done), **created_by (FK → users)**, **updated_by (FK → users)**
- `expense_attachments`, `income_attachments`, `claim_attachments` — id, parent_id (FK CASCADE), filename, display_name, added_date
- `app_sequences` — prefix, date_key, last_sequence INT; UNIQUE(prefix, date_key) — global running numbers across the shared ledger (no longer per-user)
- `expense_search_text`, `income_search_text` — expense_id/income_id (UNIQUE FK CASCADE), text
- `sessions` — id (UUID PK), user_id (FK → users), created_at, expires_at
- `settings` — key TEXT (PK), value TEXT — app-wide settings shared by all users (currency, categories, godMode, etc.)
- `import_queue` — see Phase 5 for full definition; table created in Phase 1 so the schema is complete from the start

**Amount field naming**: `amount` (REAL) throughout. On PostgreSQL migration, change column type to `NUMERIC(10,2)` for exact decimal storage.

**`src/lib/server/db/client.ts`** — SQLite singleton via `better-sqlite3`; enables WAL mode; runs Drizzle migrations on startup. This is the only file that changes for SQLite→PostgreSQL migration.

**`drizzle.config.ts`** — Points to schema file, output dir `drizzle/`

**`src/lib/server/running-number.ts`** — `nextNumber(db, prefix, date)` → atomic SQLite transaction with `INSERT … ON CONFLICT DO UPDATE SET last_sequence = last_sequence + 1 RETURNING last_sequence`; returns `EX20260610-001`. Sequence is global across the shared ledger (not per-user).

**`src/lib/server/file-storage.ts`** — `saveToTemp()`, `moveToFinal()`, `urlForFile()`, `displayName()`, `deleteFile()`. Base path from `STORAGE_PATH` env var. All paths stored in DB are **relative to `STORAGE_PATH`**; `urlForFile()` prepends the base path at read time.

File path strategy:
- **Temp** (at upload): `import/temp/{uuid}_{originalFilename}` — used while job is in any pre-confirmed state
- **Final** (after confirm): `{type}/{year}/{month}/{uuid}_{originalFilename}` — bucketed by document date, e.g. `expenses/2026/06/...`, `income/2026/06/...`, `claims/2026/06/...`

Year/month bucketing uses the **document's date** (not upload date) so receipts for the same period stay together. `moveToFinal(tempPath, type, documentDate)` handles the directory creation and atomic rename. Temp files for `failed` or `skipped` jobs are swept by a startup cleanup that deletes temp files older than 7 days with no corresponding active queue row.

**`src/lib/server/settings.ts`** — Typed `getSetting(key)` / `setSetting(key, value)` wrapping the global `settings` KV table (single row per key, shared by all users). Keys mirror Swift UserDefaults: `display.currencyCode`, `expense.categories`, `income.categories`, `autoImport.apiKey`, `autoImport.model`, `godMode.enabled`, etc.

**`src/lib/server/env.ts`** — Reads `STORAGE_PATH`, `DATABASE_PATH` from `process.env`; throws clearly on missing required vars. (Bearer tokens are now per-user, stored in the `users` table — see Phase 2.5 — not a single shared `API_BEARER_TOKEN`.)

**`.env.example`** — Template documenting all env vars.

---

## Phase 2 — Authentication

### Files to Create

**`src/hooks.server.ts`** — SvelteKit handle hook:
- `/api/*` routes: validate `Authorization: Bearer <token>` against the token stored on the matching `users` row (see `bearer_token` column, Phase 2.5); return 401 otherwise; attach the resolved user + their effective permission set to `event.locals`
- All other routes: check for valid session cookie in `sessions` table; redirect to `/login` if missing/expired; attach `event.locals.user` + `event.locals.permissions` (effective view/add/change/delete per resource, resolved from group membership)

**`src/routes/login/+page.svelte`** — Simple login form (email + password fields)

**`src/routes/login/+page.server.ts`** — Form action: verify password with argon2; create session row; set `httpOnly` session cookie; redirect to `/`

**`src/routes/logout/+server.ts`** — DELETE session from DB; clear cookie

**`src/lib/server/auth.ts`** — `validateSession(cookie)` helper; `getSessionUser(cookie)` returns user row; `getEffectivePermissions(userId)` returns the resolved `{ resource: { view, add, change, delete } }` map (superuser short-circuit + union across groups) — see Phase 2.5

### Setup Utility
**`scripts/create-admin.ts`** — One-time script: `bun run scripts/create-admin.ts <email> <password> [firstName] [lastName]` → creates the first user and adds it to the seeded `Administrators` group (`is_superuser = true`). Subsequent users/groups are managed via Settings → Users (Phase 2.5); each user can edit their own name/email/password via Settings → Profile.

### Multi-User Readiness
- Data is a **single shared ledger** — no `WHERE user_id = ?` filtering on reads. Every query in `src/lib/server/queries/*.ts` instead passes through `hasPermission(locals, resource, action)` before running, enforced centrally rather than per-row.
- `created_by` / `updated_by` columns on entity tables provide an audit trail without restricting visibility.
- The `sessions` table already links to `users`, so login/session handling needs no changes when groups/permissions are introduced — Phase 2.5 is additive on top of this.

---

## Phase 2.5 — User Management & Permissions

### Concept

Replaces the old owner/editor/viewer role idea with **groups**, modeled loosely on Linux users/groups:

- A **group** has a name, description, an `is_superuser` flag, and (if not superuser) a permission grid: for each **resource**, whether members can **view / add / change / delete**.
- A **user** belongs to zero or more groups. Effective permission for a resource/action is `true` if *any* of the user's groups grants it (union, most-permissive-wins), or unconditionally `true` for every resource/action if the user belongs to *any* `is_superuser` group.
- A user with **zero groups** can still log in but sees an effectively empty app (no nav items render, all routes 403/404) — a "deactivated but not deleted" state, surfaced in the user list with a warning badge rather than blocked at creation time.
- Resources in the grantable grid: `expenses`, `income`, `claims`, `import`, `categories`. System-level areas — `settings` (general/intelligence/backup/reset/advanced), user & group management, and backup/restore — are **superuser-only** and never appear in the grid, so a non-superuser can never escalate their own access.
- **Claims minimal view**: the claims list/detail always shows only a minimal summary (item name, amount, date) for the expenses attached to a claim, regardless of the viewer's `expenses.view` — so `claims.view` is sufficient on its own and doesn't leak full expense detail.

### Schema (added in Phase 1, see above)

```
groups            — id, name (UNIQUE), description, is_superuser BOOLEAN DEFAULT false
group_permissions — group_id FK, resource TEXT, can_view, can_add, can_change, can_delete BOOLEAN DEFAULT false
                    PK (group_id, resource)
user_groups       — user_id FK, group_id FK
                    PK (user_id, group_id)
```

`users.bearer_token` (added in Phase 1) gives each user their own Shortcuts token; `/api/*` auth resolves the token to a user, then applies that user's effective permissions exactly like a session would.

### Seed Data

On first migration, seed:
- `Administrators` group — `is_superuser = true`, no `group_permissions` rows needed (short-circuited). Cannot be renamed or deleted (enforced in the API).
- A few starter groups with pre-filled `group_permissions`, editable/deletable by any superuser:

| Group | Expenses | Income | Claims | Import | Categories |
|---|---|---|---|---|---|
| Bookkeeper | view, add, change | view, add, change | view, add, change | view, add | view, change |
| Data Entry | add | add | — | add | view |
| Reviewer | view | view | view | view | view |

`scripts/create-admin.ts` creates the first user and adds them to `Administrators`.

### Files to Create

**`src/lib/server/permissions.ts`**:
- `getEffectivePermissions(userId)` → `{ [resource]: { view, add, change, delete } }`, with an `isSuperuser` flag. Queries `user_groups` joined to `groups`/`group_permissions` once; superuser short-circuits to all-true.
- `hasPermission(locals, resource, action)` → boolean, used in every `+server.ts` / `+page.server.ts` before reads or mutations.

**`src/hooks.server.ts`** (extends Phase 2 version) — after resolving the session user or bearer token, calls `getEffectivePermissions` once and attaches the result to `event.locals.permissions` / `event.locals.isSuperuser`.

### API Routes

| Endpoint | Methods | Notes |
|---|---|---|
| `/api/users` | GET, POST | List users (with group memberships + superuser-derived flag); create user (email, password, name, optional bearer token, group IDs). Superuser only. |
| `/api/users/[id]` | GET, PATCH, DELETE | PATCH: name, email, password reset, regenerate bearer token. Superuser only. |
| `/api/users/[id]/groups` | GET, PATCH | Get/replace this user's group memberships (array of group IDs, can be empty). Superuser only. |
| `/api/profile` | GET, PATCH | **Self-service**, any authenticated user (no permission grid involved). GET returns own `firstName`/`lastName`/`email`/group memberships (read-only display); PATCH updates own `firstName`/`lastName`/`email`, and optionally `password` (requires current password). Bearer-token requests are also accepted, scoped to the token's user. |
| `/api/groups` | GET, POST | List groups with permission grids; create a new group. Superuser only. |
| `/api/groups/[id]` | GET, PATCH, DELETE | Edit name/description/is_superuser; DELETE blocked for `Administrators` and for any group with members (reassign first). Superuser only. |
| `/api/groups/[id]/permissions` | GET, PATCH | Get/replace the view/add/change/delete grid for a group (no-op if `is_superuser`). Superuser only. |

### Enforcement Pattern

```ts
// In a +server.ts handler, e.g. POST /api/expenses
if (!hasPermission(locals, 'expenses', 'add')) {
  return new Response('Forbidden', { status: 403 });
}
```

```ts
// GET handlers: hide existence rather than reveal-then-deny
if (!hasPermission(locals, 'import', 'view')) {
  return new Response('Not Found', { status: 404 });
}
```

PATCH handlers run this permission check **first**, then apply the existing field-level locking from `src/lib/server/locking.ts` (e.g. amount-locking on claimed expenses) — permission governs *whether you can touch this resource at all*, locking governs *which fields, given the resource's current state*.

### UI

- `settings/profile/+page.svelte` (**every authenticated user**, not superuser-gated) — edit own first name, last name, email; change password (requires current password); view (read-only) own group memberships; regenerate own bearer token for iOS Shortcuts.
- `settings/users/+page.svelte` (superuser-only tab) — table of users (name, email, groups, "no groups" warning badge, last login); create/edit user form (first name, last name, email, password); per-user group multi-select; password reset / regenerate bearer token actions.
- `settings/groups/+page.svelte` (superuser-only tab) — list of groups; create/edit group (name, description, is_superuser toggle — disabled for `Administrators`); permission grid editor (checkboxes, disabled entirely if `is_superuser` is on).
- `+layout.svelte` sidebar — display name shown as `firstName + " " + lastName` (fallback to email) in the user menu; nav items conditionally rendered from `locals.permissions` (e.g. no `import.view` → no "Import" link); Settings → Profile renders for everyone; Users/Groups/Backup/Reset/Advanced tabs only render for `locals.isSuperuser`.
- Server-side route guards remain the actual enforcement; hidden nav items are convenience only.

---

## Phase 3 — Core CRUD API (also iOS Shortcuts endpoints)

### Route Structure
All under `src/routes/api/`:

| Endpoint | Methods | Notes |
|---|---|---|
| `/api/expenses` | GET, POST | GET requires `expenses.view` (404 if absent); POST requires `expenses.add`. Filter by status/category/date/amount/search; POST: iOS Shortcuts create |
| `/api/expenses/[id]` | GET, PATCH, DELETE | PATCH requires `expenses.change`, then enforces amount locking (always) + descriptive locking (unless godMode); DELETE requires `expenses.delete` |
| `/api/expenses/[id]/attachments` | POST | Requires `expenses.change` |
| `/api/income` | GET, POST | Same permission pattern against `income.*` |
| `/api/income/[id]` | GET, PATCH, DELETE | No locking (all fields always editable); permission-gated as above |
| `/api/income/[id]/attachments` | POST | |
| `/api/claims` | GET, POST | Permission-gated against `claims.*`. POST body: `{ date, expenseIds[] }` — creates claim, sets expenses status=pending |
| `/api/claims/[id]` | GET, PATCH, DELETE | PATCH with `status=done` triggers mark-as-claimed workflow; DELETE reverts expenses to unpaid. List/detail show only minimal expense fields (item name, amount, date) regardless of the viewer's `expenses.view` |
| `/api/claims/[id]/attachments` | POST | |
| `/api/import` | GET, POST | Permission-gated against `import.*`. POST: multipart upload → save to temp → enqueue job → return `202 { jobId }`; GET: list all jobs across the shared ledger (for polling) |
| `/api/import/[jobId]` | GET, DELETE | GET: single job state + extracted fields; DELETE: cancel queued/failed job + delete temp file |
| `/api/import/[jobId]/confirm` | POST | Optional JSON body with field overrides; backend merges onto queue row then inserts record + moves file |
| `/api/import/[jobId]/skip` | POST | Mark job as skipped (e.g. duplicate); delete temp file |
| `/api/settings` | GET, PATCH | All settings — superuser only |
| `/api/users`, `/api/users/[id]`, `/api/users/[id]/groups` | GET/POST/PATCH/DELETE | User management — superuser only (see Phase 2.5) |
| `/api/groups`, `/api/groups/[id]`, `/api/groups/[id]/permissions` | GET/POST/PATCH/DELETE | Group & permission management — superuser only (see Phase 2.5) |
| `/api/backup/export` | GET | Stream ZIP — superuser only |
| `/api/backup/import` | POST | Restore from ZIP — superuser only |
| `/api/reset` | POST | `{ scope: 'settings'|'data'|'everything' }` — superuser only |

### Key Server Utilities
**`src/lib/server/locking.ts`** — `canEditDescriptive(expense, godMode)` / `canEditAmount(expense)` — direct port of SwiftUI locking logic

**`src/lib/server/queries/expenses.ts`**, `income.ts`, `claims.ts` — Drizzle query builders for list/filter/search; keeps `+server.ts` files thin

### iOS Shortcuts JSON Contract
```json
POST /api/expenses
Authorization: Bearer <token>
{ "itemName": "...", "supplier": "...", "date": "2026-06-10", "amount": 8.50, "category": "Food & Beverage", "reference": "", "remark": "" }
→ 201 { "id": 42, "expenseNumber": "EX20260610-001", ... }
```

---

## Phase 4 — Web UI

### Additional Packages
```bash
bun add chart.js
```

### Route Structure
```
src/routes/
  +layout.svelte              — sidebar nav, session user
  +layout.server.ts           — load settings (currency, godMode) into PageData
  +page.svelte                — redirect to /dashboard

  dashboard/+page.svelte, +page.server.ts
  expenses/+page.svelte, +page.server.ts
  expenses/new/+page.svelte, +page.server.ts
  expenses/[id]/+page.svelte, +page.server.ts
  income/  (same pattern)
  claims/  (same pattern)
  import/+page.svelte, +page.server.ts
  settings/+layout.svelte     — tab nav for panes (Profile visible to everyone; Users/Groups tabs only render for superusers)
  settings/general, intelligence, categories, backup, reset, advanced, profile, users, groups
```

### Component Library (`src/lib/components/`)
- `ui/StatusBadge.svelte` — colored badge (unpaid=red, pending=amber, paid=green)
- `ui/CurrencyDisplay.svelte` — renders float amount via `Intl.NumberFormat`
- `ui/AmountInput.svelte` — numeric text input bound to float value
- `ui/SearchInput.svelte` — 300ms debounce built in
- `ui/FilterPanel.svelte` — expense filter drawer (status, category, date range, amount range)
- `ui/AttachmentList.svelte` — display + delete
- `ui/FileUpload.svelte` — drag-and-drop
- `ui/ConfirmDialog.svelte` — modal confirmation
- `charts/BarChart.svelte`, `DonutChart.svelte`, `LineBarChart.svelte` — Chart.js wrappers via `$effect`

### Svelte 5 Patterns
```ts
// Global app state (src/lib/state/app.svelte.ts)
export const appState = $state({ godMode: false, currency: 'MYR' });

// Debounced search (in +page.svelte)
let search = $state('');
let query = $state('');
$effect(() => {
  const t = setTimeout(() => query = search, 300);
  return () => clearTimeout(t);
});

// Locking
const canEditAmount = $derived(!expense.claimId);
```

### Dashboard
Pure-function helpers in `src/lib/dashboard-helpers.ts` (no Svelte deps, port from Swift):
- `computeTrendData()`, `computeCashFlowData()`, `computeCategoryData()`, `computePeriodTotals()`

Period selector (last 2 months / current month / current year) is client-side `$state` — no page reload.

---

## Phase 5 — Auto Import

### Additional Packages
```bash
bun add pdf-parse tesseract.js pdfjs-dist uuid
bun add -d @types/uuid @types/pdf-parse
```

### Import Flow

```
POST /api/import (upload)
  → file saved to import/temp/{uuid}_{filename}
  → import_queue row created (state: queued)
  → worker picks up job
      → state: extracting  (OCR / pdf-parse)
      → state: processing  (LLM call → determines document_type, extracts fields)
      → state: pending_review
  → user reviews in UI (editable fields)
  → POST /api/import/[jobId]/confirm (optional correction body)
      → state: confirmed
      → DB transaction: INSERT expense or income, INSERT attachment record
      → file moved: import/temp/... → {type}/{year}/{month}/{uuid}_{filename}
      → state: imported
```

### `import_queue` Schema (create in Phase 1)

```
import_queue:
  id                UUID PK          ← also the jobId exposed in the API
  created_by        FK → users NOT NULL ← who uploaded the file; not used for visibility filtering
  state             TEXT NOT NULL    ← queued | extracting | processing | pending_review | confirmed | imported | skipped | failed

  -- file
  temp_file_path    TEXT NOT NULL    ← relative to STORAGE_PATH, e.g. import/temp/{uuid}_{filename}
  original_filename TEXT NOT NULL    ← display name shown in UI

  -- LLM extraction results (populated after processing)
  document_type     TEXT             ← 'expense' | 'income' — determined by LLM, not caller
  item_name         TEXT
  supplier          TEXT
  date              TEXT             ← YYYY-MM-DD
  amount            REAL
  reference         TEXT
  category          TEXT
  remark            TEXT

  -- duplicate detection
  duplicate_of      INTEGER          ← FK to expenses.id or incomes.id, nullable
  duplicate_signal  TEXT             ← 'filename' | 'reference' | 'amount_date_supplier'

  -- outcome
  result_id         INTEGER          ← FK to the created expense/income id after import
  result_type       TEXT             ← 'expense' | 'income' (mirrors document_type post-confirm)
  error             TEXT

  created_at        TIMESTAMP
  processed_at      TIMESTAMP        ← when LLM finished
  confirmed_at      TIMESTAMP
  completed_at      TIMESTAMP        ← when record was inserted + file moved
```

### Files to Create

**`src/lib/server/import/extractor.ts`** — `extractText(filePath)`:
- Text PDFs → `pdf-parse`
- Scanned PDFs (< 50 avg chars/page) → `pdfjs-dist` page render → Tesseract.js
- Images → Tesseract.js directly

**`src/lib/server/import/llm.ts`** — Port of `DocumentProcessor.swift`: calls OpenRouter API with structured JSON schema; LLM determines `document_type` (`expense` or `income`) in addition to extracting fields. Exponential backoff (3 retries for 429/5xx), `parseAmount()`, `parseReceiptDate()`

**`src/lib/server/import/duplicate-detector.ts`** — Port of `DuplicateDetector.swift`: checks filename, reference value, amount+date+supplier signal; writes `duplicate_of` + `duplicate_signal` onto the queue row

**`src/lib/server/import/category-hint.ts`** — Generates categorisation hint from last 100 unique (item, category) pairs; triggers after 5 records, regenerates every 10 new entries; stored in `settings` table

**`src/lib/server/import/worker.ts`** — `startImportWorker()`: long-lived async loop started in `src/hooks.server.ts` at server startup. Picks up `queued` jobs from the DB (recovers in-flight jobs on restart), processes them through the state machine, enforces a configurable concurrency limit (1–10 parallel tasks) + rate-limit delay between LLM calls. Worker runs entirely outside the request/response cycle.

```ts
// src/hooks.server.ts (startup side effect)
import { startImportWorker } from '$lib/server/import/worker';
startImportWorker();
```

### API Contract

```
POST /api/import
Authorization: Bearer <token>
Content-Type: multipart/form-data
  file: <binary>
→ 202 { "jobId": "uuid" }
```

No `document_type` in the request — the LLM determines it during processing.

```
POST /api/import/[jobId]/confirm
Authorization: Bearer <token>
Content-Type: application/json

// Body is optional — only include fields the user actually corrected
{
  "item_name": "...",
  "amount": 12.50,
  "date": "2026-06-11",
  "category": "..."
}
→ 201 { "id": 42, "expenseNumber": "EX20260611-001" }
```

The backend performs a **field-level merge**: only fields present in the body override the LLM-extracted values; omitted fields use the queue row as-is. Edits are never written back to `import_queue` — they go directly into the final `expenses` or `incomes` record.

### Confirm Backend Logic

```
1. Load import_queue row; assert state = pending_review; assert caller has `import.change` permission (not restricted to the original uploader — shared ledger)
2. Merge optional request body fields onto queue row (in memory only)
3. Set state = confirmed
4. Begin DB transaction:
   a. nextNumber(db, prefix, date) → running number
   b. INSERT into expenses or incomes using merged field values
   c. INSERT into expense_attachments or income_attachments with final file path
      (path = {type}/{year}/{month}/{uuid}_{originalFilename}, derived from document date)
   d. UPDATE import_queue SET state='imported', result_id=..., result_type=..., completed_at=now()
5. Commit transaction
6. Move file: import/temp/... → {type}/{year}/{month}/{uuid}_{filename}
   (file move after commit — if move fails, log error; temp file remains recoverable)
```

### Auto Import UI
`src/routes/import/+page.svelte`:
- File drop zone + file picker
- Processing section (spinners for in-flight jobs, showing current state label)
- Review table: editable fields inline; duplicate warning badge with "Skip" action per row
- Confirm button per row; sends only changed fields in the optional body
- Poll `GET /api/import` every 2 seconds while any job is in `queued | extracting | processing`; stops when all jobs reach a terminal or reviewable state

---

## Phase 6 — Backup & Advanced

### Additional Packages
```bash
bun add archiver
bun add -d @types/archiver
```

**Backup export** (`GET /api/backup/export`): ZIP stream containing `database.sqlite` (via `VACUUM INTO`), `documents/`, `settings.json`, `manifest.json`

**Backup import** (`POST /api/backup/import`): validate manifest version, replace DB + documents, reimport settings

**Reset** (`POST /api/reset`): scoped data deletion with transactions

**God Mode**: toggle in Settings → Advanced; server reads from `settings` table in every PATCH handler

---

## SQLite → PostgreSQL Migration Path

Only 3 files need to change:
1. `schema.ts` — `sqliteTable` → `pgTable`, `TEXT` date → `timestamp`, `REAL` amount → `NUMERIC(10,2)`, integer PKs → `serial`
2. `client.ts` — swap `better-sqlite3` driver for `node-postgres`
3. `drizzle.config.ts` — change dialect + connection string

All query code in `src/lib/server/queries/*.ts` is unchanged — Drizzle's query builder is dialect-agnostic. Run `drizzle-kit generate` to produce the PostgreSQL migration SQL. Estimated effort: 1–2 days.

---

## Verification Checklist (per phase)

1. **Auth**: visit app URL without login → redirected to `/login`; wrong password → stays on login; correct → access granted; iOS Shortcuts POST with a user's Bearer token bypasses cookie check
2. **Running numbers**: create 2 expenses on same day → `EX20260610-001` and `EX20260610-002`; next day → resets to `EX20260611-001`
3. **Claim workflow**: create claim with 2 unpaid expenses → both status=pending; total = sum of their amounts; "Mark as Claimed" → both paid; delete claim → both revert to unpaid; claim list/detail shows only minimal expense fields (item, amount, date) even for a user without `expenses.view`
4. **Locking**: PATCH `amount` on a claimed expense → 403; PATCH descriptive fields with God Mode off → 403; God Mode on → 200
5. **Auto Import**: upload PDF via API → `202` with jobId; poll shows `extracting → processing → pending_review`; confirm with no body → expense/income created with LLM-extracted values; confirm with corrected amount → corrected value in DB; file moves from `import/temp/` to `expenses/{year}/{month}/`; duplicate upload → `duplicate_signal` set, skip deletes temp file
6. **iOS Shortcuts**: `POST /api/expenses` with a user's Bearer token → 201 with expenseNumber; without token → 401; token belonging to a user without `expenses.add` → 403
7. **Backup**: export → ZIP with all 4 expected files; import the same ZIP → all records intact; both endpoints return 403 for a non-superuser
8. **Groups & permissions**: create a "Reviewer" group (`view` only on all resources), assign a new user to it → that user can view expenses/income/claims/import but POST/PATCH/DELETE all return 403, and `/settings/users`, `/settings/groups`, `/settings/backup` etc. return 403/redirect; remove the user from all groups → nav collapses to empty shell, all data routes 403/404, login still succeeds; add user to `Administrators` → full access including Settings → Users/Groups; attempt to rename or delete `Administrators` → blocked
9. **Profile**: any logged-in user (including a zero-group user) can open Settings → Profile, update first/last name and email, and change their own password with the correct current password (wrong current password → rejected); display name in the sidebar updates immediately; a non-superuser cannot reach `/settings/users` or `/settings/groups` even though `/settings/profile` is accessible