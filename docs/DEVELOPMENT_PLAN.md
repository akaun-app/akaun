# Akaun Web — SvelteKit Rebuild Plan

## Context

Rebuilding the SwiftUI personal finance tracker (Akaun) as a SvelteKit webapp hosted on a public VPS. The app tracks expenses, income, and reimbursement claims for a single user (freelancer/small business). Key requirements: web UI for daily use, REST API compatible with iOS Shortcuts for quick expense logging on mobile, SQLite now with a clean PostgreSQL migration path. Reference docs: `/Users/tanghaoquan/Code/Akaun/WEBAPP_REFERENCE.md`, `/Users/tanghaoquan/Code/Akaun/CLAUDE.md`.

---

## Architecture Decisions

- **ORM**: Drizzle ORM (`drizzle-orm` + `better-sqlite3`) — same schema works for SQLite and PostgreSQL; swapping DB is a one-file change
- **Adapter**: `@sveltejs/adapter-node` (required for `better-sqlite3`; replaces `adapter-auto`)
- **Auth**: Session-based auth for web UI (login page + `httpOnly` session cookie); Bearer token for all `/api/*` routes (iOS Shortcuts). Schema is multi-user-ready from day one; single active user at launch.
- **Money**: Stored as `REAL` (float) in SQLite; `NUMERIC(10,2)` on PostgreSQL migration for precision. Display with `Intl.NumberFormat` (2 decimal places).
- **Multi-user**: `users` table + `user_id` FK on all entity tables built into the schema now, even though the app launches with a single admin user. Permissions role column (`owner` / `editor` / `viewer`) reserved for future use.
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
- `users` — id, email (UNIQUE), password_hash, role (TEXT: `owner`/`editor`/`viewer`, default `owner`), created_at. Single row at launch; role column reserved for multi-user permissions.
- `expenses` — id, expense_number (UNIQUE), item_name, supplier, reference, remark, category, status (unpaid/pending/paid), date (TEXT YYYY-MM-DD), **amount REAL NOT NULL**, claim_id (FK → claims, SET NULL), **user_id (FK → users)**, created_at, updated_at
- `incomes` — id, income_number, source, description_text, reference, remark, category, date, **amount REAL NOT NULL**, **user_id (FK → users)**
- `claims` — id, claim_number, date, status (pending/done), **user_id (FK → users)**
- `expense_attachments`, `income_attachments`, `claim_attachments` — id, parent_id (FK CASCADE), filename, display_name, added_date
- `app_sequences` — prefix, date_key, last_sequence INT, **user_id (FK → users)**; UNIQUE(prefix, date_key, user_id)
- `expense_search_text`, `income_search_text` — expense_id/income_id (UNIQUE FK CASCADE), text
- `sessions` — id (UUID PK), user_id (FK → users), created_at, expires_at
- `settings` — **user_id (FK → users)**, key TEXT, value TEXT; PK(user_id, key) — per-user settings

**Amount field naming**: `amount` (REAL) throughout. On PostgreSQL migration, change column type to `NUMERIC(10,2)` for exact decimal storage.

**`src/lib/server/db/client.ts`** — SQLite singleton via `better-sqlite3`; enables WAL mode; runs Drizzle migrations on startup. This is the only file that changes for SQLite→PostgreSQL migration.

**`drizzle.config.ts`** — Points to schema file, output dir `drizzle/`

**`src/lib/server/running-number.ts`** — `nextNumber(db, prefix, date)` → atomic SQLite transaction with `INSERT … ON CONFLICT DO UPDATE SET last_sequence = last_sequence + 1 RETURNING last_sequence`; returns `EX20260610-001`

**`src/lib/server/file-storage.ts`** — `importFile()`, `urlForFile()`, `displayName()`, `deleteFile()`. Base path from `STORAGE_PATH` env var. Files named `{UUID}_{originalName}`, stored in `expenses/`, `income/`, `claims/` subdirectories.

**`src/lib/server/settings.ts`** — Typed `getSetting(key)` / `setSetting(key, value)` wrapping the `settings` KV table. Keys mirror Swift UserDefaults: `display.currencyCode`, `expense.categories`, `income.categories`, `autoImport.apiKey`, `autoImport.model`, `godMode.enabled`, etc.

**`src/lib/server/env.ts`** — Reads `STORAGE_PATH`, `DATABASE_PATH`, `API_BEARER_TOKEN` from `process.env`; throws clearly on missing required vars.

**`.env.example`** — Template documenting all env vars.

---

## Phase 2 — Authentication

### Files to Create

**`src/hooks.server.ts`** — SvelteKit handle hook:
- `/api/*` routes: validate `Authorization: Bearer <token>` against `API_BEARER_TOKEN` env var; return 401 otherwise
- All other routes: check for valid session cookie in `sessions` table; redirect to `/login` if missing/expired

**`src/routes/login/+page.svelte`** — Simple login form (email + password fields)

**`src/routes/login/+page.server.ts`** — Form action: verify password with argon2; create session row; set `httpOnly` session cookie; redirect to `/`

**`src/routes/logout/+server.ts`** — DELETE session from DB; clear cookie

**`src/lib/server/auth.ts`** — `validateSession(cookie)` helper; `getSessionUser(cookie)` returns user row

### Setup Utility
**`scripts/create-admin.ts`** — One-time script: `bun run scripts/create-admin.ts <email> <password>` → creates the first `owner` user in the DB. Subsequent users can be added via a future admin UI.

### Multi-User Readiness
- All queries in `src/lib/server/queries/*.ts` include `WHERE user_id = ?` (scoped to the session user)
- `role` column on `users` is present but not enforced at launch — enforcement added when multi-user is activated
- The `sessions` table already links to `users`, so upgrading to multi-user login is additive (no schema change needed)

---

## Phase 3 — Core CRUD API (also iOS Shortcuts endpoints)

### Route Structure
All under `src/routes/api/`:

| Endpoint | Methods | Notes |
|---|---|---|
| `/api/expenses` | GET, POST | GET: filter by status/category/date/amount/search; POST: iOS Shortcuts create |
| `/api/expenses/[id]` | GET, PATCH, DELETE | PATCH enforces amount locking (always) + descriptive locking (unless godMode) |
| `/api/expenses/[id]/attachments` | POST | multipart file upload |
| `/api/income` | GET, POST | Same pattern |
| `/api/income/[id]` | GET, PATCH, DELETE | No locking (all fields always editable) |
| `/api/income/[id]/attachments` | POST | |
| `/api/claims` | GET, POST | POST body: `{ date, expenseIds[] }` — creates claim, sets expenses status=pending |
| `/api/claims/[id]` | GET, PATCH, DELETE | PATCH with `status=done` triggers mark-as-claimed workflow; DELETE reverts expenses to unpaid |
| `/api/claims/[id]/attachments` | POST | |
| `/api/import` | POST | multipart file upload → enqueue auto-import job → return `{ jobId }` |
| `/api/import/[jobId]` | GET, DELETE | Poll job state |
| `/api/import/[jobId]/confirm` | POST | Commit ready item to DB |
| `/api/settings` | GET, PATCH | All settings |
| `/api/backup/export` | GET | Stream ZIP |
| `/api/backup/import` | POST | Restore from ZIP |
| `/api/reset` | POST | `{ scope: 'settings'|'data'|'everything' }` |

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
  settings/+layout.svelte     — tab nav for 7 panes
  settings/general, intelligence, categories, backup, reset, advanced
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

### Files to Create

**`src/lib/server/import/extractor.ts`** — `extractText(filePath)`:
- Text PDFs → `pdf-parse`
- Scanned PDFs (< 50 avg chars/page) → `pdfjs-dist` page render → Tesseract.js
- Images → Tesseract.js directly

**`src/lib/server/import/llm.ts`** — Port of `DocumentProcessor.swift`: calls OpenRouter API with structured JSON schema, exponential backoff (3 retries for 429/5xx), `parseAmount()`, `parseReceiptDate()`

**`src/lib/server/import/duplicate-detector.ts`** — Port of `DuplicateDetector.swift`: checks filename, reference value, amount+date+supplier signal

**`src/lib/server/import/category-hint.ts`** — Generates categorization hint from last 100 unique (item, category) pairs; triggers after 5 records, regenerates every 10 new entries; stored in `settings` table

**`src/lib/server/import/queue.ts`** — `ImportQueue` class managing in-memory job state machine: `extracting → calling → ready → imported/failed`. Semaphore for configurable 1–10 parallel tasks + rate-limit delay.

### Import Queue Table (add to schema in Phase 1)
`import_queue` — id (UUID), state, source_filename, display_name, document_type, item_name, supplier, date, **amount REAL**, reference, category, error, created_at — persists queue across server restarts

### Auto Import UI
`src/routes/import/+page.svelte`:
- File drop zone + file picker
- Processing section (spinners for in-flight items)
- Review table (editable fields inline before confirming)
- Duplicate warning badge per row with "Skip" action
- Poll `/api/import` every 2 seconds when items are in-flight (stops when all done)

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

1. **Auth**: visit app URL without login → redirected to `/login`; wrong password → stays on login; correct → access granted; iOS Shortcuts POST with Bearer token bypasses cookie check
2. **Running numbers**: create 2 expenses on same day → `EX20260610-001` and `EX20260610-002`; next day → resets to `EX20260611-001`
3. **Claim workflow**: create claim with 2 unpaid expenses → both status=pending; total = sum of their amounts; "Mark as Claimed" → both paid; delete claim → both revert to unpaid
4. **Locking**: PATCH `amount` on a claimed expense → 403; PATCH descriptive fields with God Mode off → 403; God Mode on → 200
5. **Auto Import**: upload PDF → transitions extracting → calling → ready; confirm → expense record created with correct amount
6. **iOS Shortcuts**: `POST /api/expenses` with Bearer token → 201 with expenseNumber; without token → 401
7. **Backup**: export → ZIP with all 4 expected files; import the same ZIP → all records intact
