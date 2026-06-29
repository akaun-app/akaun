# Akaun Web — SvelteKit Rebuild Plan

## Context

Rebuilding the SwiftUI personal finance tracker (Akaun) as a SvelteKit webapp hosted on a public VPS. The app tracks expenses, income, and reimbursement claims for a single user (freelancer/small business). Key requirements: web UI for daily use, a token-authenticated REST API so external clients/scripts can log expenses and upload receipt/income documents programmatically, SQLite now with a clean PostgreSQL migration path. Reference docs: `/Users/tanghaoquan/Code/Akaun/WEBAPP_REFERENCE.md`, `/Users/tanghaoquan/Code/Akaun/CLAUDE.md`.

---

## Architecture Decisions

- **ORM**: Drizzle ORM (`drizzle-orm` + `better-sqlite3`) — same schema works for SQLite and PostgreSQL; swapping DB is a one-file change
- **Adapter**: `@sveltejs/adapter-node` (required for `better-sqlite3`; replaces `adapter-auto`)
- **Auth**: Session-based auth for web UI (login page + `httpOnly` session cookie); Bearer token for all `/api/*` routes (programmatic clients/scripts). Schema is multi-user-ready from day one; single active user at launch.
- **Money**: Stored as `REAL` (float) in SQLite; `NUMERIC(10,2)` on PostgreSQL migration for precision. Display with `Intl.NumberFormat` (2 decimal places).
- **Multi-user & permissions**: Single shared ledger (not per-user-isolated data). `users` table holds login credentials only. Access control is via **groups**: a `groups` table (with an `is_superuser` flag), a `group_permissions` grid (view/add/change/delete per resource), and a `user_groups` many-to-many join. Superusers (members of any `is_superuser` group) bypass the grid entirely; everyone else gets the union of permissions across their groups. Users may belong to zero groups (locked-out-but-not-deleted state). See **Phase 2.5** for full detail. `user_id` FK on entity tables (`expenses`, `incomes`, `claims`, etc.) is retained as a `created_by`-style audit field, not as a data-visibility filter.
- **OCR**: Tesseract.js (server-side WASM, no system binary needed) + `pdf-parse` for text PDFs
- **Charts**: Chart.js (bar, donut, grouped bar) via Svelte 5 `$effect` canvas wrappers
- **Svelte 5**: All state with `$state`/`$derived`/`$effect` runes — no legacy stores
- **Enums**: All closed-set enums (`expenses.status`, `claims.status`, `import_queue.state` / `document_type` / `result_type` / `duplicate_signal`, `contacts.entity_type`, `contact_roles.role`, reset `scope`) are stored as **`INTEGER`** codes, never TEXT. The backend owns the INT↔label mapping in a single source-of-truth module, `src/lib/server/enums.ts`. Codes are **append-only** — never reuse or renumber a retired code, or historical rows silently change meaning. Open-ended string keys that grow as the app gains features (e.g. `group_permissions.resource`, user-defined `category`) stay TEXT — they are keys, not value enums. Tradeoff: raw DB rows read as `status = 2` not `status = 'paid'`, so `enums.ts` is the authoritative legend.

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
- `users` — id, email (UNIQUE), password_hash, name, bearer_token (TEXT, UNIQUE, nullable — for `/api/*` programmatic auth), created_at. No role/permission columns — access is entirely group-derived (see Phase 2.5).
- `groups` — id, name (UNIQUE), description, is_superuser (boolean, default `false`)
- `group_permissions` — group_id (FK → groups, CASCADE), resource (TEXT), can_view, can_add, can_change, can_delete (booleans, default `false`); PK (group_id, resource)
- `user_groups` — user_id (FK → users, CASCADE), group_id (FK → groups, CASCADE); PK (user_id, group_id)
- `expenses` — id, expense_number (UNIQUE), item_name, **contact_id (FK → contacts, SET NULL)** (replaces old free-text `supplier`; see Phase 2.6), reference, remark, category, **status INTEGER NOT NULL** (`ExpenseStatus`: unpaid/pending/paid — see `enums.ts`), date (TEXT YYYY-MM-DD), **amount REAL NOT NULL**, claim_id (FK → claims, SET NULL), **created_by (FK → users)**, **updated_by (FK → users)**, created_at, updated_at
- `incomes` — id, income_number, **contact_id (FK → contacts, SET NULL)** (replaces old free-text `source`; see Phase 2.6), description_text, reference, remark, category, date, **amount REAL NOT NULL**, **created_by (FK → users)**, **updated_by (FK → users)**
- `claims` — id, claim_number, date, **status INTEGER NOT NULL** (`ClaimStatus`: pending/done — see `enums.ts`), **created_by (FK → users)**, **updated_by (FK → users)**
- `contacts` — id, **entity_type INTEGER NOT NULL** (`EntityType`: individual/business; no default), legal_name (TEXT NOT NULL), registration_no, email, phone, address, remark, is_active (BOOLEAN DEFAULT `true`), **created_by (FK → users)**, **updated_by (FK → users)**, created_at, updated_at — see Phase 2.6
- `contact_roles` — contact_id (FK → contacts, CASCADE), **role INTEGER** (`Role`: customer/supplier/employee — see `enums.ts`); PK (contact_id, role); INDEX (role, contact_id) — see Phase 2.6
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
**`scripts/create-admin.ts`** — One-time script: `bun run scripts/create-admin.ts <email> <password> [name]` → creates the first user and adds it to the seeded `Administrators` group (`is_superuser = true`). Subsequent users/groups are managed via Settings → Users (Phase 2.5).

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
- Resources in the grantable grid: `expenses`, `income`, `claims`, `import`, `categories`, `contacts`. System-level areas — `settings` (general/intelligence/backup/reset/advanced), user & group management, and backup/restore — are **superuser-only** and never appear in the grid, so a non-superuser can never escalate their own access.
- **Claims minimal view**: the claims list/detail always shows only a minimal summary (item name, amount, date) for the expenses attached to a claim, regardless of the viewer's `expenses.view` — so `claims.view` is sufficient on its own and doesn't leak full expense detail.

### Schema (added in Phase 1, see above)

```
groups            — id, name (UNIQUE), description, is_superuser BOOLEAN DEFAULT false
group_permissions — group_id FK, resource TEXT, can_view, can_add, can_change, can_delete BOOLEAN DEFAULT false
                    PK (group_id, resource)
user_groups       — user_id FK, group_id FK
                    PK (user_id, group_id)
```

`users.bearer_token` (added in Phase 1) gives each user their own API token; `/api/*` auth resolves the token to a user, then applies that user's effective permissions exactly like a session would.

### Seed Data

On first migration, seed:
- `Administrators` group — `is_superuser = true`, no `group_permissions` rows needed (short-circuited). Cannot be renamed or deleted (enforced in the API).
- A few starter groups with pre-filled `group_permissions`, editable/deletable by any superuser:

| Group | Expenses | Income | Claims | Import | Categories | Contacts |
|---|---|---|---|---|---|---|
| Bookkeeper | view, add, change | view, add, change | view, add, change | view, add | view, change | view, add, change |
| Data Entry | add | add | — | add | view | view, add |
| Reviewer | view | view | view | view | view | view |

`scripts/create-admin.ts` creates the first user and adds them to `Administrators`.

### Files to Create

**`src/lib/server/permissions.ts`**:
- `getEffectivePermissions(userId)` → `{ [resource]: { view, add, change, delete } }`, with an `isSuperuser` flag. Queries `user_groups` joined to `groups`/`group_permissions` once; superuser short-circuits to all-true.
- `hasPermission(locals, resource, action)` → boolean, used in every `+server.ts` / `+page.server.ts` before reads or mutations.

**`src/hooks.server.ts`** (extends Phase 2 version) — after resolving the session user or bearer token, calls `getEffectivePermissions` once and attaches the result to `event.locals.permissions` / `event.locals.isSuperuser`.

### API Routes

| Endpoint | Methods | Notes |
|---|---|---|
| `/api/users` | GET, POST | List users (with group memberships + superuser-derived flag); create user (name, email, password, optional bearer token, group IDs). Superuser only. |
| `/api/users/[id]` | GET, PATCH, DELETE | PATCH: name, email, password reset, regenerate bearer token. Superuser only. |
| `/api/users/[id]/groups` | GET, PATCH | Get/replace this user's group memberships (array of group IDs, can be empty). Superuser only. |
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

- `settings/users/+page.svelte` (superuser-only tab) — table of users (name, email, groups, "no groups" warning badge, last login); create/edit user form (name, email, password); per-user group multi-select; password reset / regenerate bearer token actions.
- `settings/groups/+page.svelte` (superuser-only tab) — list of groups; create/edit group (name, description, is_superuser toggle — disabled for `Administrators`); permission grid editor (checkboxes, disabled entirely if `is_superuser` is on).
- `+layout.svelte` sidebar — display the user's `name` (fallback to email) in the user menu; nav items conditionally rendered from `locals.permissions` (e.g. no `import.view` → no "Import" link); Settings → Users/Groups/Backup/Reset/Advanced tabs only render for `locals.isSuperuser`.
- Server-side route guards remain the actual enforcement; hidden nav items are convenience only.

---

## Phase 2.6 — Contacts

### Concept

Replaces the free-text `supplier` (on expenses) and `source` (on incomes) fields with a **first-class Contacts entity** — a shared directory of the people and businesses the ledger transacts with. This is the foundation for future features (invoicing, payroll, quotations, statements, per-contact statistics) that all need a stable, deduplicated party record rather than repeated name strings.

Two orthogonal axes describe a contact:

- **Entity type** — *what the contact is*: `individual` or `business`. Drives which descriptive fields are meaningful (a business has a registration number; an individual typically doesn't). **Mandatory at creation — no default.** The create form forces an explicit choice; only the one-time data migration assigns a value without a user (see **Migration** below).
- **Roles** — *what the contact does for the ledger*: `customer`, `supplier`, `employee` (extensible). A contact may hold **multiple roles** simultaneously (e.g. a contractor who is both a supplier and an employee), stored in a `contact_roles` join table rather than a column on `contacts`. This avoids the duplicate-contact problem that a single-role column would create.

### Enum Storage

`entity_type` and `role` are stored as **`INTEGER`** codes per the project-wide enum convention (see Architecture Decisions). The INT↔label maps live in `src/lib/server/enums.ts` alongside every other enum (`ExpenseStatus`, `ClaimStatus`, `ImportState`, etc.). Codes are append-only.

```ts
// src/lib/server/enums.ts — single source of truth for ALL enum codes (append-only)

// --- contacts ---
export const EntityType = { Individual: 1, Business: 2 } as const;
export const Role       = { Customer: 1, Supplier: 2, Employee: 3 } as const;

// --- expenses / claims ---
export const ExpenseStatus = { Unpaid: 1, Pending: 2, Paid: 3 } as const;
export const ClaimStatus   = { Pending: 1, Done: 2 } as const;

// --- import_queue ---
export const ImportState = {
  Queued: 1, Extracting: 2, Processing: 3, PendingReview: 4,
  Confirmed: 5, Imported: 6, Skipped: 7, Failed: 8
} as const;
export const DocumentType   = { Expense: 1, Income: 2 } as const;  // also import_queue.result_type
export const DuplicateSignal = { Filename: 1, Reference: 2, AmountDateSupplier: 3 } as const;

// --- reset scope ---
export const ResetScope = { Settings: 1, Data: 2, Everything: 3 } as const;

// Label maps + helpers (toLabel / fromLabel) accompany each; API bodies use INT codes,
// responses may also include resolved labels for client convenience.
```

### Schema (added in Phase 1, alongside the rest)

```
contacts
  id              INTEGER PK
  entity_type     INTEGER NOT NULL   ← EntityType code; no schema default (UI forces choice;
                                       migration writes Business). See enums.ts.
  legal_name      TEXT NOT NULL      ← migration target for old supplier/source strings
  registration_no TEXT               ← business reg / SSM no; nullable
  email           TEXT
  phone           TEXT
  address         TEXT               ← single address; billing/shipping split deferred
  remark          TEXT
  is_active       BOOLEAN DEFAULT true   ← soft-deactivate without breaking FKs
  created_by      INTEGER FK → users
  updated_by      INTEGER FK → users
  created_at      TIMESTAMP
  updated_at      TIMESTAMP

contact_roles
  contact_id      INTEGER FK → contacts (CASCADE)
  role            INTEGER            ← Role code; see enums.ts
  PK (contact_id, role)
  INDEX (role, contact_id)           ← REQUIRED: makes "all suppliers" filter index-only
```

**Index rationale**: the composite PK `(contact_id, role)` covers "what roles does this contact have" (detail view). The dropdown filter "all suppliers" queries by `role` first, a non-leading PK column, so it needs the explicit `(role, contact_id)` index to stay index-only rather than scanning. Without it the join table can be *slower* than boolean flags — this index is what justifies the join-table choice.

### Entity Table Changes

`expenses` and `incomes` lose their text name columns and gain a contact FK (reflected in the Phase 1 schema above):

```
expenses:  DROP COLUMN supplier  → ADD contact_id INTEGER FK → contacts (SET NULL)
incomes:   DROP COLUMN source    → ADD contact_id INTEGER FK → contacts (SET NULL)
```

`SET NULL` (not CASCADE): deactivating or deleting a contact must never delete financial records — it nulls the link instead. `is_active = false` is the normal "retire a contact" path; hard delete is reserved for merge losers.

`import_queue` keeps its `supplier` column as the **raw LLM-extracted name string** (a contact may not exist yet at extraction time) and gains `matched_contact_id` + `match_candidates` (see the `import_queue` schema and **Contact Resolution** in Phase 5). During processing the worker fuzzy-matches the extracted name against `contacts.legal_name` (role-appropriate) and the review combobox lets the user accept the match, pick another contact, or type a new name created on confirm. This is the only place a raw name string survives — the entity tables themselves carry no text name.

### Validation Policy — Soft

Role-to-entity assignment is **soft-validated**: the contact dropdown on the expense form filters to `role = Supplier`, the income form to `role = Customer`, but there is **no DB constraint** tying an entity row to a contact's roles. Rationale:

- A hard constraint would orphan or block historical expenses the moment a contact is reclassified (supplier role removed).
- It would fight the merge transaction (merging a supplier into a contact lacking the flag mid-transaction would fail the constraint).
- The FK already guarantees the contact *exists*; the role is UI guidance, not a gate.

The backend may optionally emit a non-blocking warning when an assignment crosses roles, but never rejects it.

### Permissions

`contacts` is a grantable resource in the Phase 2.5 grid (`view / add / change / delete`) — already reflected in the resources list and seed-group table above. **Merge** is gated behind **both** `contacts.change` and `contacts.delete` (it repoints records *and* hard-deletes the losers).

### Merge

Solves the existing duplicate-name mess (`ABC Sdn Bhd` / `ABC SDN BHD` / `ABC`). The operation picks a **survivor** and one or more **losers**, moves every reference onto the survivor, then **hard-deletes the losers**. No tombstone, no `merged_into` redirect, no unmerge — once references are repointed, nothing in the DB points at a loser, so the delete is safe and permanent.

> "Repoint references" is simply the `UPDATE` statements that move child rows (expenses, incomes, future invoices/payroll) onto the survivor *before* the delete. It is not a persistent link — after the transaction commits there is no trace of the loser anywhere in the schema.

```
POST /api/contacts/merge   { survivorId, loserIds[] }

1. Permission: hasPermission(locals, 'contacts', 'change') && hasPermission(locals, 'contacts', 'delete')
2. Validate: survivorId ∉ loserIds; all ids exist
3. BEGIN
   a. UPDATE expenses SET contact_id = survivor WHERE contact_id IN (losers)
   b. UPDATE incomes  SET contact_id = survivor WHERE contact_id IN (losers)
      -- quotations + invoices added in Phase 7; (future: payroll — extend this block per new FK)
      UPDATE quotations SET contact_id = survivor WHERE contact_id IN (losers)
      UPDATE invoices   SET contact_id = survivor WHERE contact_id IN (losers)
   c. UNION roles into survivor:
      INSERT OR IGNORE INTO contact_roles (contact_id, role)
        SELECT survivor, role FROM contact_roles WHERE contact_id IN (losers)
      -- MUST run before the delete, or cascade wipes the losers' roles first
   d. (optional) backfill survivor's blank fields (email/phone/address/registration_no)
      from a loser — survivor's existing non-null values always win
   e. DELETE FROM contacts WHERE id IN (losers)
      -- contact_roles rows for losers cascade away automatically
4. COMMIT
```

**Every future table that FKs `contacts` must be added to step 3b.** Centralize the repoint statements in one `mergeContacts(tx, survivorId, loserIds)` helper so adding invoicing later means adding one line, not hunting for missed references.

Merge is **irreversible** (no unmerge by design). A mistaken merge is fixed by re-creating the contact and reassigning by hand.

### Find Duplicates

A cleanup view that clusters contacts by **normalized `legal_name`** (lowercased, trimmed, punctuation/whitespace-collapsed) and surfaces likely-duplicate groups with a bulk "merge into one" action — the primary tool for cleaning up the migrated free-text names.

```
GET /api/contacts/duplicates
→ [ { normalized: "abc sdn bhd", contacts: [ {id, legal_name, ...}, ... ] }, ... ]
```

Normalization is computed at query time (or cached in a generated column later if it becomes slow).

### API Routes

All under `src/routes/api/contacts/`. Permission-gated against `contacts.*` exactly like the expense/income pattern (404 on missing `view`, 403 on missing `add`/`change`/`delete`).

| Endpoint | Methods | Notes |
|---|---|---|
| `/api/contacts` | GET, POST | GET requires `contacts.view`; filter by `role` / `entity_type` / search on `legal_name`; only `is_active = true` unless `?includeInactive=1`. POST requires `contacts.add`; body must include `entity_type` (no default) + `legal_name` + optional `roles[]`. |
| `/api/contacts/[id]` | GET, PATCH, DELETE | PATCH requires `contacts.change`. DELETE requires `contacts.delete` — **soft** by default (`is_active = false`); refuses hard delete if referenced by any expense/income. |
| `/api/contacts/[id]/roles` | GET, PATCH | Replace the contact's role set (array of Role codes, may be empty). Requires `contacts.change`. |
| `/api/contacts/merge` | POST | `{ survivorId, loserIds[] }` — transactional repoint + hard delete. Requires `contacts.change` + `contacts.delete`. |
| `/api/contacts/duplicates` | GET | Normalized-name clusters for the cleanup UI. Requires `contacts.view`. |

### Migration (one-time, Phase 1.5-style data step)

Run after the `contacts` / `contact_roles` tables exist and before dropping the old text columns:

```
1. Create contacts + contact_roles tables.
2. Build the deduplicated contact set from existing data:
   - SELECT DISTINCT TRIM(supplier) FROM expenses WHERE supplier IS NOT NULL AND supplier <> ''
   - SELECT DISTINCT TRIM(source)   FROM incomes  WHERE source   IS NOT NULL AND source   <> ''
   - Dedupe across BOTH sets on normalized name → one contact per distinct normalized name.
3. INSERT each into contacts:
   - legal_name  = the original string
   - entity_type = EntityType.Business   ← migration-only assignment; the "no default / user
                                            must choose" rule governs UI creation, not this backfill.
4. Assign roles in contact_roles:
   - name seen in expenses.supplier → Role.Supplier
   - name seen in incomes.source    → Role.Customer
   - name in BOTH → one contact with BOTH roles
5. Backfill links:
   - UPDATE expenses SET contact_id = (match on normalized supplier)
   - UPDATE incomes  SET contact_id = (match on normalized source)
6. Verify zero orphans (every previously-non-null name resolved to a contact_id).
7. DROP COLUMN expenses.supplier; DROP COLUMN incomes.source.
8. Point the user at /contacts/duplicates to merge near-duplicates that differ beyond
   case/whitespace ("ABC" vs "ABC Sdn Bhd"), and to reclassify the few individuals.
```

### Files to Create / Modify

**`src/lib/server/enums.ts`** — INT↔label maps + `toLabel`/`fromLabel` helpers for **all** enums (contacts, expense/claim status, import states, reset scope); single source of truth, append-only.

**`src/lib/server/db/schema.ts`** (Phase 1 additions) — `contacts`, `contact_roles` tables; `contact_id` FK on `expenses`/`incomes`; `matched_contact_id` on `import_queue`.

**`src/lib/server/queries/contacts.ts`** — Drizzle builders: list/filter by role+entity_type+search, role-set read/replace, duplicate clustering, and the `mergeContacts(tx, survivorId, loserIds)` transaction helper (the one place every contact-referencing table is enumerated).

**`src/routes/api/contacts/**`** — the route handlers above.

**`src/routes/contacts/+page.svelte`, `+page.server.ts`** — contact list (search, role/entity filters, active/inactive toggle, "no roles" badge), create/edit form (entity-type required selector, role multi-select, descriptive fields), and the find-duplicates / merge UI.

**`src/lib/components/ui/ContactSelect.svelte`** — role-filtered contact picker used by the expense (suppliers) and income (customers) forms; soft validation only.

**Expense/Income forms & detail** (Phase 4) — swap the free-text supplier/source input for `ContactSelect`; display resolves `contact_id → legal_name`.

**Auto Import** (Phase 5) — review UI shows `matched_contact_id` (link existing) or "create new contact"; confirm writes the resolved contact onto the new record.

---

## Phase 3 — Core CRUD API (token-authenticated programmatic endpoints)

### Route Structure
All under `src/routes/api/`:

| Endpoint | Methods | Notes |
|---|---|---|
| `/api/expenses` | GET, POST | GET requires `expenses.view` (404 if absent); POST requires `expenses.add`. Filter by status/category/date/amount/search; POST: direct structured create (programmatic clients) |
| `/api/expenses/[id]` | GET, PATCH, DELETE | PATCH requires `expenses.change`, then enforces amount locking (always) + descriptive locking (unless godMode); DELETE requires `expenses.delete` |
| `/api/expenses/[id]/attachments` | POST | Requires `expenses.change` |
| `/api/income` | GET, POST | Same permission pattern against `income.*` |
| `/api/income/[id]` | GET, PATCH, DELETE | No locking (all fields always editable); permission-gated as above |
| `/api/income/[id]/attachments` | POST | |
| `/api/claims` | GET, POST | Permission-gated against `claims.*`. POST body: `{ date, expenseIds[] }` — creates claim, sets expenses `status = ExpenseStatus.Pending` |
| `/api/claims/[id]` | GET, PATCH, DELETE | PATCH with `status = ClaimStatus.Done` triggers mark-as-claimed workflow; DELETE reverts expenses to `ExpenseStatus.Unpaid`. List/detail show only minimal expense fields (item name, amount, date) regardless of the viewer's `expenses.view` |
| `/api/claims/[id]/attachments` | POST | |
| `/api/import` | GET, POST | Permission-gated against `import.*`. POST: multipart upload → save to temp → enqueue job → return `202 { jobId }`; GET: list all jobs across the shared ledger (for polling) |
| `/api/import/[jobId]` | GET, DELETE | GET: single job state + extracted fields; DELETE: cancel queued/failed job + delete temp file |
| `/api/import/[jobId]/confirm` | POST | Optional JSON body with field overrides; backend merges onto queue row then inserts record + moves file |
| `/api/import/[jobId]/skip` | POST | Mark job as skipped (e.g. duplicate); delete temp file |
| `/api/contacts`, `/api/contacts/[id]`, `/api/contacts/[id]/roles`, `/api/contacts/merge`, `/api/contacts/duplicates` | GET/POST/PATCH/DELETE | Contact directory, role sets, merge, duplicate clustering — permission-gated against `contacts.*` (see Phase 2.6) |
| `/api/settings` | GET, PATCH | All settings — superuser only |
| `/api/users`, `/api/users/[id]`, `/api/users/[id]/groups` | GET/POST/PATCH/DELETE | User management — superuser only (see Phase 2.5) |
| `/api/groups`, `/api/groups/[id]`, `/api/groups/[id]/permissions` | GET/POST/PATCH/DELETE | Group & permission management — superuser only (see Phase 2.5) |
| `/api/backup/export` | GET | Stream ZIP — superuser only |
| `/api/backup/import` | POST | Restore from ZIP — superuser only |
| `/api/reset` | POST | `{ scope: ResetScope }` (settings / data / everything — INT code, see `enums.ts`) — superuser only |

### Key Server Utilities
**`src/lib/server/locking.ts`** — `canEditDescriptive(expense, godMode)` / `canEditAmount(expense)` — field-level edit-locking logic (e.g. amount-locking on claimed expenses)

**`src/lib/server/queries/expenses.ts`**, `income.ts`, `claims.ts` — Drizzle query builders for list/filter/search; keeps `+server.ts` files thin

### Programmatic Create — JSON Contract
```json
POST /api/expenses
Authorization: Bearer <token>
{ "itemName": "...", "supplier": "...", "date": "2026-06-10", "amount": 8.50, "category": "Food & Beverage", "reference": "", "remark": "" }
→ 201 { "id": 42, "expenseNumber": "EX20260610-001", ... }
```

This is the direct, queue-bypassing create path for external clients/scripts that already have clean structured data. The client sends `supplier` as a **name string** (it has no contact IDs). The backend resolves it to a `contact_id`: exact-then-normalized match against `contacts.legal_name` among `Role.Supplier` contacts → link if found; otherwise auto-create a `business` contact with the `supplier` role and link it (so programmatic logging never blocks on contact management). Passing a numeric `contactId` instead of `supplier` is also accepted and bypasses resolution. Income POSTs resolve `source` against `Role.Customer` the same way. `status` defaults to `ExpenseStatus.Unpaid` when omitted. Unlike the document-upload path (Phase 5), this endpoint inserts immediately with no review step — the caller is trusted to send final data.

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
  contacts/+page.svelte, +page.server.ts   — list, create/edit, find-duplicates + merge UI
  import/+page.svelte, +page.server.ts
  settings/+layout.svelte     — tab nav for panes (Users/Groups tabs only render for superusers)
  settings/general, intelligence, categories, backup, reset, advanced, users, groups
```

### Component Library (`src/lib/components/`)
- `ui/StatusBadge.svelte` — colored badge keyed off the `ExpenseStatus`/`ClaimStatus` INT code (unpaid=red, pending=amber, paid=green), label via `enums.ts`
- `ui/CurrencyDisplay.svelte` — renders float amount via `Intl.NumberFormat`
- `ui/AmountInput.svelte` — numeric text input bound to float value
- `ui/SearchInput.svelte` — 300ms debounce built in
- `ui/FilterPanel.svelte` — expense filter drawer (status, category, date range, amount range)
- `ui/AttachmentList.svelte` — display + delete
- `ui/FileUpload.svelte` — drag-and-drop
- `ui/ConfirmDialog.svelte` — modal confirmation
- `ui/ContactSelect.svelte` — role-filtered contact picker (suppliers on expense form, customers on income form); soft validation only (see Phase 2.6)
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

## Phase 5 — Auto Import (Document Upload API)

The ingestion counterpart to the direct create endpoint: a token-authenticated **document upload API** so external clients/scripts can POST receipt/income documents (PDF/image) to the backend. Uploads land in a processing **queue** (OCR/text extraction → LLM field extraction), then surface in the web UI for the user to **review and confirm** before anything is inserted into the ledger. Nothing reaches `expenses`/`incomes` without an explicit human confirm.

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
  state             INTEGER NOT NULL ← ImportState code: Queued|Extracting|Processing|PendingReview|Confirmed|Imported|Skipped|Failed (see enums.ts)

  -- file
  temp_file_path    TEXT NOT NULL    ← relative to STORAGE_PATH, e.g. import/temp/{uuid}_{filename}
  original_filename TEXT NOT NULL    ← display name shown in UI

  -- LLM extraction results (populated after processing)
  document_type     INTEGER          ← DocumentType code: Expense|Income — determined by LLM, not caller (see enums.ts)
  item_name         TEXT
  supplier          TEXT             ← RAW extracted name string (entity tables carry no text name)
  matched_contact_id INTEGER         ← FK → contacts, nullable; set only on confident exact-normalized match (see Phase 2.6 / Contact Resolution)
  match_candidates  TEXT             ← JSON array of ranked fuzzy candidates [{id, legal_name, score}], nullable; feeds the review combobox
  date              TEXT             ← YYYY-MM-DD
  amount            REAL
  reference         TEXT
  category          TEXT
  remark            TEXT

  -- duplicate detection
  duplicate_of      INTEGER          ← FK to expenses.id or incomes.id, nullable
  duplicate_signal  INTEGER          ← DuplicateSignal code: Filename|Reference|AmountDateSupplier (see enums.ts)

  -- outcome
  result_id         INTEGER          ← FK to the created expense/income id after import
  result_type       INTEGER          ← DocumentType code (mirrors document_type post-confirm)
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

**`src/lib/server/import/llm.ts`** — calls OpenRouter API with a structured JSON schema; the LLM determines `document_type` (expense or income) and extracts fields including the raw `supplier` name string (it is NOT given the contact list — contact matching is a separate backend step, see Contact Resolution below). Exponential backoff (3 retries for 429/5xx), `parseAmount()`, `parseReceiptDate()`

**`src/lib/server/import/duplicate-detector.ts`** — checks filename, reference value, and amount+date+supplier signal; writes `duplicate_of` + `duplicate_signal` onto the queue row

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

### Contact Resolution (the one contact-aware addition to this phase)

The document carries a supplier/source *name*, not a contact ID, so the extracted name must be reconciled against the Contacts directory (Phase 2.6) before the record can be inserted. The work splits across three stages; **the LLM is never given the contact list** — matching is a deterministic backend job, not a model task.

**Stage 1 — extraction (worker, `processing` state).** The LLM extracts the raw `supplier` string onto the queue row exactly as today. No change.

**Stage 2 — fuzzy matching (worker, after extraction).** A `resolveContactCandidates(name, role)` step normalizes the extracted name (lowercase, trim, collapse whitespace/punctuation) and fuzzy-matches it against `contacts.legal_name`, filtered to the role-appropriate set (`Role.Supplier` for an expense document, `Role.Customer` for income). Outcome written to the queue row:

- **Confident exact-normalized hit** → set `matched_contact_id`; the UI will pre-select it.
- **Near matches above a similarity threshold** → store a small ranked candidate list (top ~5) as `match_candidates` (JSON on the queue row) to feed the UI combobox as suggestions; `matched_contact_id` stays null.
- **No match** → both null; the combobox falls back to the raw extracted name as a free-text "create new" value.

Fuzzy matching is a **hint generator, never an auto-link** unless the match is exact-normalized. Auto-linking on a fuzzy guess would silently misattribute receipts — worse than leaving a row unmatched for the human to resolve.

**Stage 3 — resolve at confirm (UI combobox + create-on-confirm).** The review row's contact field is a **combobox** that: pre-selects `matched_contact_id` if set; offers `match_candidates` and live search over all role-appropriate contacts; and accepts a typed **new name** that matches nothing. The user ends with exactly one of three intents, expressed in the confirm payload:

- `{ contactId: 42 }` — picked an existing contact (matched candidate or searched).
- `{ newContactName: "ABC Trading" }` — typed a name with no match → **create on confirm**.
- (nothing) — left the pre-selected match as-is → backend uses `matched_contact_id`.

No contact is created while typing/reviewing — only on confirm, inside the insert transaction (below). This keeps abandoned/skipped reviews from littering the directory with orphan contacts, which matters precisely because the directory cleanup is a core motivation for Contacts. New contacts created this way **default to `entity_type = business`** with the role-appropriate role attached; the user reclassifies the occasional individual later via the Contacts cleanup view.

### Confirm Backend Logic

```
1. Load import_queue row; assert state = ImportState.PendingReview; assert caller has `import.change` permission (not restricted to the original uploader — shared ledger)
2. Merge optional request body fields onto queue row (in memory only)
3. Resolve contact_id (priority order):
   a. body.contactId present            → use it (existing contact)
   b. body.newContactName present       → create contact (entity_type=Business,
                                            role = Supplier|Customer per document_type) → use new id
   c. else matched_contact_id present   → use it
   d. else (no match, no input)         → create from raw `supplier` string
                                            (entity_type=Business, role-appropriate)
   (contact creation happens INSIDE the transaction below, so an abandoned confirm creates nothing)
4. Set state = ImportState.Confirmed
5. Begin DB transaction:
   a. (if 3b/3d) INSERT contact + contact_role
   b. nextNumber(db, prefix, date) → running number
   c. INSERT into expenses or incomes using merged field values + resolved contact_id
   d. INSERT into expense_attachments or income_attachments with final file path
      (path = {type}/{year}/{month}/{uuid}_{originalFilename}, derived from document date)
   e. UPDATE import_queue SET state=ImportState.Imported, result_id=..., result_type=..., completed_at=now()
6. Commit transaction
7. Move file: import/temp/... → {type}/{year}/{month}/{uuid}_{filename}
   (file move after commit — if move fails, log error; temp file remains recoverable)
```

### Auto Import UI
`src/routes/import/+page.svelte`:
- File drop zone + file picker
- Processing section (spinners for in-flight jobs, showing current state label)
- Review table: editable fields inline; **contact field is a combobox** — pre-selects the matched contact, suggests fuzzy `match_candidates`, allows searching all role-appropriate contacts, and accepts a new typed name flagged "will create (Business) on confirm"; duplicate warning badge with "Skip" action per row
- Confirm button per row; payload sends only changed fields plus the contact intent (`contactId` | `newContactName` | omitted)
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

## Phase 7 — Quotations & Invoicing

### Concept

A **simple** sales-document module: issue quotations to customers, convert accepted quotations into invoices, and mark invoices paid (which records the money as an income). Cash-basis and single-entry, consistent with the rest of the app — no journals, no accruals.

Design principle for this phase: **keep the surface simple, but build the structure so that advanced features (tax, partial payments, multi-currency conversion, recurring, e-invoice) are purely additive later — no migration that reinterprets existing financial rows.** Hard-to-retrofit structure is added now; easy-to-add behaviour is deferred. Concretely:

- **Header totals are stored as `subtotal` + `tax_amount` + `total`** even though `tax_amount = 0` and `subtotal = total` today. When SST registration happens, tax lands at line level and rolls up into these existing columns — additive, no backfill. A single `total` column would make every historical row ambiguous (tax-inclusive vs tax-free) and unreconstructable.
- **`amount_paid` column exists** but behaviour is all-or-nothing (`pay` sets `amount_paid = total`). Partial-payment support later is then pure logic with no schema change and no "what is `amount_paid` for already-paid rows" backfill.
- **`currency` / `exchange_rate` carried** for consistency with `expenses`/`incomes` and the existing multi-currency module; conversion UI deferred.
- **`Expired` (quotation) and `Overdue` (invoice) are derived at read time**, never stored — no nightly status-flipping job. Their enum codes are *reserved in comments* so the append-only numbering stays safe if they ever become stored.
- **Line-level `tax_rate` / `tax_amount` deliberately omitted** — they are nullable and cheap to `ALTER` in later, so they are the correct thing to defer.

This phase also extends the contact-merge helper (Phase 2.6) — the `mergeContacts()` "future: invoices, payroll, quotations" note is finally cashed in here.

### Enum Storage

Append-only additions to `src/lib/server/enums.ts`:

```ts
// --- quotations / invoices ---
export const QuotationStatus = { Draft: 1, Sent: 2, Accepted: 3, Declined: 4, Converted: 5 } as const;
// reserved (DERIVED at read time, never stored): Expired — expiry_date < today && status ∈ {Draft, Sent}

export const InvoiceStatus = { Draft: 1, Sent: 2, Paid: 3, Cancelled: 4 } as const;
// reserved (DERIVED at read time, never stored): Overdue — due_date < today && status != Paid
// reserved (FUTURE, append next free code if/when partial payments ship): PartiallyPaid
```

Codes are append-only like every other enum. The *reserved* labels are documented so a future contributor neither reuses a code nor renumbers.

### Schema (added in Phase 1's `schema.ts`, alongside the rest)

```
quotations
  id                INTEGER PK
  quotation_number  TEXT UNIQUE        ← QT-prefix via nextNumber, e.g. QT20260628-001
  contact_id        INTEGER FK → contacts (SET NULL)   ← Role.Customer
  status            INTEGER NOT NULL   ← QuotationStatus code; see enums.ts
  reference         TEXT               ← customer PO / their ref; nullable
  issue_date        TEXT NOT NULL      ← YYYY-MM-DD
  expiry_date       TEXT               ← YYYY-MM-DD; nullable
  currency          TEXT NOT NULL      ← reuse currency module
  exchange_rate     REAL               ← rate to main currency at issue_date; nullable
  subtotal          REAL NOT NULL      ← sum of line_total
  tax_amount        REAL NOT NULL DEFAULT 0   ← 0 until SST; structural placeholder
  total             REAL NOT NULL      ← subtotal + tax_amount
  notes             TEXT
  terms             TEXT
  converted_invoice_id  INTEGER FK → invoices (SET NULL)  ← set on convert; nullable
  created_by        INTEGER FK → users
  updated_by        INTEGER FK → users
  created_at        TIMESTAMP
  updated_at        TIMESTAMP

invoices
  id                INTEGER PK
  invoice_number    TEXT UNIQUE        ← IV-prefix via nextNumber, e.g. IV20260628-001
  contact_id        INTEGER FK → contacts (SET NULL)   ← Role.Customer
  status            INTEGER NOT NULL   ← InvoiceStatus code; see enums.ts
  reference         TEXT
  issue_date        TEXT NOT NULL      ← YYYY-MM-DD
  due_date          TEXT               ← YYYY-MM-DD; nullable; drives derived Overdue
  currency          TEXT NOT NULL
  exchange_rate     REAL
  subtotal          REAL NOT NULL
  tax_amount        REAL NOT NULL DEFAULT 0
  total             REAL NOT NULL
  amount_paid       REAL NOT NULL DEFAULT 0   ← all-or-nothing today; column kept for partial later
  notes             TEXT
  terms             TEXT
  source_quotation_id   INTEGER FK → quotations (SET NULL)   ← back-link when converted; nullable
  result_income_id      INTEGER FK → incomes (SET NULL)      ← set when paid → income; nullable
  created_by        INTEGER FK → users
  updated_by        INTEGER FK → users
  created_at        TIMESTAMP
  updated_at        TIMESTAMP

quotation_lines
  id            INTEGER PK
  quotation_id  INTEGER FK → quotations (CASCADE)
  description   TEXT NOT NULL
  quantity      REAL NOT NULL
  unit_price    REAL NOT NULL
  line_total    REAL NOT NULL      ← quantity * unit_price
  sort_order    INTEGER NOT NULL
  -- tax_rate / tax_amount deliberately omitted: nullable, cheap to ALTER in with SST

invoice_lines
  id            INTEGER PK
  invoice_id    INTEGER FK → invoices (CASCADE)
  description   TEXT NOT NULL
  quantity      REAL NOT NULL
  unit_price    REAL NOT NULL
  line_total    REAL NOT NULL
  sort_order    INTEGER NOT NULL
```

`quotations.converted_invoice_id` and `invoices.source_quotation_id` are the two-way link between a quotation and the invoice it became — mutual `SET NULL` so deleting either side never cascades into financial data loss.

### Lifecycle

```
Quotation:  Draft → Sent → Accepted ──convert──▶ Invoice (Draft)
                         └→ Declined
            Expired = DERIVED (expiry_date < today && status ∈ {Draft, Sent})

Invoice:    Draft → Sent → Paid ──▶ INSERT income (nextNumber), back-link result_income_id
                         └→ Cancelled
            Overdue = DERIVED (due_date < today && status != Paid)
```

- **Convert** copies `contact_id`, `currency`, `exchange_rate`, all line items, and totals onto a new `Draft` invoice; sets quotation `status = Converted` and links both directions. Refuses if the quotation is already `Converted`.
- **Pay** mirrors the claims→expense-status workflow: a transaction that sets `status = Paid`, `amount_paid = total`, runs `nextNumber` for an income record, INSERTs the `incomes` row (resolving `contact_id` → income's customer), and stores `result_income_id`. Idempotent guard: refuses if already `Paid`.

### Permissions

Two new grantable resources in the Phase 2.5 grid: `quotations` and `invoices` (`view / add / change / delete`). Add columns to the seed-group grid (e.g. Bookkeeper: view/add/change on both; Reviewer: view only; Data Entry: add). Standard pattern — 404 on missing `view`, 403 on missing `add`/`change`/`delete`.

### Contacts Integration

- Both documents link to a `Role.Customer` contact via `ContactSelect`.
- **Add `quotations` and `invoices` to `mergeContacts()` step 3b** — the one-line-per-table extension the helper was designed for. This is mandatory: a merge that misses these tables would orphan a survivor's invoices.
- **Usage-count guard**: a contact referenced by any quotation or invoice cannot be hard-deleted (extend the existing Phase 2.6 / Contacts-module 409 guard to count these tables).

### API Routes

All under `src/routes/api/`. Permission-gated against `quotations.*` / `invoices.*` exactly like the expense/income pattern.

| Endpoint | Methods | Notes |
|---|---|---|
| `/api/quotations` | GET, POST | GET requires `quotations.view` (filter by status/contact/date/search); POST requires `quotations.add`, body includes header + `lines[]`; computes `subtotal`/`total`, assigns `QT` number |
| `/api/quotations/[id]` | GET, PATCH, DELETE | PATCH `quotations.change` (replace header + lines); DELETE `quotations.delete` |
| `/api/quotations/[id]/convert` | POST | Requires `invoices.add`; creates `Draft` invoice from the quotation, sets quotation `Converted`, links both ways; 409 if already converted |
| `/api/quotations/[id]/pdf` | GET | Requires `quotations.view`; branded PDF |
| `/api/invoices` | GET, POST | Same pattern against `invoices.*`; list query computes derived `Overdue` flag |
| `/api/invoices/[id]` | GET, PATCH, DELETE | As above |
| `/api/invoices/[id]/pay` | POST | Requires `invoices.change`; transactional mark-paid + income insert + `result_income_id` back-link; 409 if already `Paid` |
| `/api/invoices/[id]/pdf` | GET | Requires `invoices.view`; branded PDF |
| `/api/quotations/stream`, `/api/invoices/stream` | GET (SSE) | `quotation-update`/`-delete`, `invoice-update`/`-delete`; SSR provides initial state (no snapshot), per the established stream pattern |

### PDF Export

Shared server-side template for both document types (line-item table, totals block, customer block from `contact_id`, company branding — logo/address/registration from `settings`). Use the `pdf` skill. The totals block already renders a tax line (showing `0.00` today) so enabling SST later is template-free.

### Files to Create / Modify

**`src/lib/server/enums.ts`** — append `QuotationStatus`, `InvoiceStatus` (+ reserved-label comments) and their label maps.

**`src/lib/server/db/schema.ts`** — `quotations`, `invoices`, `quotation_lines`, `invoice_lines` tables.

**`src/lib/server/queries/quotations.ts`, `invoices.ts`** — Drizzle builders: list/filter/search, header+lines read/replace (lines replaced as a set inside a transaction), derived `Expired`/`Overdue` computation, the `convertQuotationToInvoice(tx, id)` and `markInvoicePaid(tx, id)` transaction helpers.

**`src/lib/server/queries/contacts.ts`** — extend `mergeContacts()` (add quotations + invoices repoint) and the usage-count guard.

**`src/routes/api/quotations/**`, `src/routes/api/invoices/**`** — the route handlers above, including the two `stream` endpoints wired to a `quotationEvents` / `invoiceEvents` emitter (mirror `import/events.ts`).

**`src/routes/quotations/+page.svelte`, `[id]/+page.svelte`** and **`src/routes/invoices/+page.svelte`, `[id]/+page.svelte`** — list (status/overdue badges, search, customer filter) + detail/edit (header form + line-item editor); "Convert to Invoice" and "Record Payment" actions.

**`src/lib/components/ui/LineItemEditor.svelte`** — reusable add/remove/reorder line rows, live `line_total` and `subtotal`/`total` computation; shared by both document forms.

**`src/lib/components/ui/StatusBadge.svelte`** — extend to key off `QuotationStatus`/`InvoiceStatus` (including derived `Expired`/`Overdue`) via `enums.ts`.

**Dashboard** (Phase 4) — add an "Outstanding & Overdue" widget: count + total of unpaid invoices, with overdue highlighted.

**Sidebar nav** — add `Quotations` and `Invoices` items, conditionally rendered from `locals.permissions`.

### Deferred (additive later — no migration that reinterprets existing rows)

Tax fields (line `tax_rate`/`tax_amount` + header rollup already wired), partial payments (`amount_paid` already present), multi-currency conversion UI, recurring invoices, payment-method field, email-send, and myInvois/Peppol e-invoice fields. Each is a new nullable column or a new endpoint — none forces reinterpretation of rows written in this phase.

---

## Phase 7.5 — PDF Template Builder

### Concept

A drag-and-drop template designer that lets users configure how their quotations and invoices look when exported as PDFs. The designer produces a `layout_json` blob stored in the DB; the PDF renderer reads it at export time to compose the document. The document data (line items, contact, totals) is always live — the template only controls structure and presentation.

Design constraints locked in for this phase:
- **One active default template** per document type, configured in Settings. The active template is always used for PDF export — no per-document override.
- **Shared template** for both quotations and invoices (document type = `Both`). Separate QT/IV templates are supported by the schema but not required now.
- **Three-zone layout** — Header (multi-column), Body (single-column), Footer (multi-column). Multi-column is only available in the header and footer zones; the body is always a strict vertical stack. This matches real invoice structure and makes PDF rendering tractable.
- **Global theme** — one brand color + one font family applied uniformly. No per-block styling beyond alignment and spacing.
- **Primitive custom blocks** — text, image, divider, spacer. Purpose-specific blocks (bank account, certification, T&C) are intentionally not built; users compose them from primitives. This keeps the block catalogue small and the renderer simple.

### Enum Storage

Append-only additions to `src/lib/server/enums.ts`:

```ts
// --- document templates ---
export const TemplateDocumentType = { Quotation: 1, Invoice: 2, Both: 3 } as const;
export const TemplateFont = { Inter: 1, Roboto: 2, Lato: 3, Merriweather: 4 } as const;
```

### Schema

One new table added to `src/lib/server/db/schema.ts`:

```
document_templates
  id              INTEGER PK
  uuid            TEXT UNIQUE NOT NULL    ← used as the on-disk asset folder name
  name            TEXT NOT NULL
  document_type   INTEGER NOT NULL        ← TemplateDocumentType code; see enums.ts
  is_default      INTEGER NOT NULL DEFAULT 0   ← 0|1; enforced one-per-document_type at app layer
  theme_color     TEXT NOT NULL DEFAULT '#1a56db'   ← hex
  theme_font      INTEGER NOT NULL DEFAULT 1         ← TemplateFont code
  layout_json     TEXT NOT NULL           ← serialised TemplateLayout; see Layout JSON shape below
  created_by      INTEGER FK → users
  updated_by      INTEGER FK → users
  created_at      TIMESTAMP
  updated_at      TIMESTAMP
```

No migrations needed on `quotations` or `invoices` — the active default template is resolved at export time from `document_templates WHERE is_default = 1 AND document_type IN (?, 3)`, so existing document rows carry no template reference.

**`settings` table** — the existing KV table gains two new keys:
- `template.quotation.defaultId` — integer ID of the active quotation template
- `template.invoice.defaultId` — integer ID of the active invoice template

These are set via Settings → Templates and read by the PDF export endpoint.

### Template Asset Storage

Each template's image assets (used by `image` blocks) are stored on disk under:

```
{STORAGE_PATH}/
  templates/
    {template-uuid}/
      assets/
        {asset-uuid}.ext
```

`image` block config stores only the filename (`{asset-uuid}.ext`). The renderer resolves the full path as `{STORAGE_PATH}/templates/{template-uuid}/assets/{filename}` at render time. Deleting a template deletes the entire `{template-uuid}/` folder — no orphan asset cleanup required.

### Layout JSON Shape

```ts
type TemplateLayout = {
  header: {
    columns: ColumnDef[]       // 1–3 columns; widths must sum to 100
  }
  body: {
    blocks: BlockDef[]         // ordered stack; no columns
  }
  footer: {
    columns: ColumnDef[]       // 1–3 columns; widths must sum to 100
  }
}

type ColumnDef = {
  width: number                // percentage of zone width
  blocks: BlockDef[]
}

type BlockDef = {
  id: string                   // stable uuid within the layout; used as React key equivalent
  type: BlockType
  config: Record<string, unknown>   // per-type config; see Block Catalogue below
  style?: {
    marginTop?: number         // mm
    marginBottom?: number      // mm
    align?: 'left' | 'center' | 'right'
  }
}
```

### Block Catalogue

**System blocks** — data-bound; repositionable within their zone but not deletable:

| `type` | Config fields | Notes |
|---|---|---|
| `company-header` | `showLogo: bool`, `showAddress: bool` | Logo + company name + address from `settings` |
| `document-meta` | `showReference: bool` | QT/IV number, issue date, expiry/due date, reference |
| `customer-block` | `showRegistrationNo: bool` | Contact name, address, reg number |
| `line-items-table` | `showUnitPrice: bool`, `showQty: bool` | Always present in body; cannot be moved to header/footer |
| `totals-block` | `showTaxRow: bool` | Subtotal, tax (0.00 today), total, amount paid if invoice |

**Optional system blocks** — data-bound; removable:

| `type` | Config fields | Notes |
|---|---|---|
| `notes` | `label: string` | Renders `quotations.notes` / `invoices.notes` if non-empty |
| `paid-stamp` | `color: string`, `opacity: number` | Diagonal "PAID" overlay; only renders when `InvoiceStatus.Paid` |
| `issued-by` | `label: string` | Name of the `created_by` user |

**Primitive custom blocks** — freely added, configured, removed:

| `type` | Config fields | Notes |
|---|---|---|
| `text` | `title?: string`, `body: string`, `fontSize: number` | Plain text; `\n` respected. Use for bank details, T&C, notes, etc. |
| `image` | `filename: string`, `widthPercent: number`, `align: 'left'\|'center'\|'right'` | Asset from template's asset folder. Use for stamps, signatures, certification logos. |
| `divider` | `color: string`, `thickness: number` | Horizontal rule |
| `spacer` | `heightMm: number` | Blank vertical gap |

### Default Template (seeded on first boot)

A sensible starting layout is seeded automatically if no template exists yet — no placeholder text, only system blocks:

```
Header (2 columns):
  Col 1 (40%): company-header  { showLogo: true, showAddress: true }
  Col 2 (60%): document-meta   { showReference: true }

Body:
  customer-block    { showRegistrationNo: true }
  line-items-table  { showUnitPrice: true, showQty: true }
  totals-block      { showTaxRow: true }
  notes             { label: 'Notes' }

Footer (1 column — full width):
  (empty — user adds text/image blocks as needed)
```

### Designer UX

Accessed via Settings → Templates. Layout:

```
┌─────────────────────────────────────────────────────────────┐
│  Templates  [+ New]                    Theme: [●] [Font ▾]  │
│  ──────────────────────────────────────────────────────────  │
│  [Default ✓]  [Formal]  [Minimal]                           │
└─────────────────────────────────────────────────────────────┘
┌──────────────┬──────────────────────────┬────────────────────┐
│  Block       │  Canvas                  │  Config            │
│  Palette     │                          │                    │
│              │  ▼ HEADER  [+col][-col]  │  (click a block    │
│  System      │  ┌────────┬───────────┐  │   to open its      │
│  ─────────   │  │company │doc-meta   │  │   config panel)    │
│  company-    │  │-header │           │  │                    │
│  header      │  └────────┴───────────┘  │                    │
│  document-   │                          │                    │
│  meta        │  ▼ BODY                  │                    │
│  customer-   │  ┌───────────────────┐   │                    │
│  block       │  │ customer-block    │⠿  │                    │
│  line-items  │  │ line-items-table  │⠿  │                    │
│  totals      │  │ totals-block      │⠿  │                    │
│  notes       │  │ notes             │⠿  │                    │
│  paid-stamp  │  └───────────────────┘   │                    │
│  issued-by   │                          │                    │
│              │  ▼ FOOTER [+col][-col]   │                    │
│  Custom      │  ┌───────────────────┐   │                    │
│  ─────────   │  │ (drop blocks here)│   │                    │
│  text        │  └───────────────────┘   │                    │
│  image       │                          │                    │
│  divider     │                          │                    │
│  spacer      │                          │                    │
└──────────────┴──────────────────────────┴────────────────────┘
          [Preview PDF]       [Save]   [Set as Default]
```

Interaction rules:
- Drag from palette → drop into a zone (or a column within header/footer)
- Reorder blocks within a zone/column by dragging the `⠿` handle
- System blocks (`company-header`, `line-items-table`, etc.) show no delete button; optional system blocks and all custom blocks show one
- `line-items-table` and `totals-block` are body-only — they cannot be dragged into header or footer (enforced in the drop handler)
- Click any block → right panel shows its config fields
- **+col / −col** buttons on header and footer zones add/remove columns (min 1, max 3); adding a column splits remaining width equally; removing the last non-empty column is blocked with an inline warning
- **Preview PDF** calls `GET /api/templates/[id]/preview` — renders with the most recent real quotation or invoice, or a fully synthetic document if none exists yet — and opens the PDF in a new tab
- **Set as Default** calls `POST /api/templates/[id]/default`; updates the `settings` key for the template's document type; the previously-default template is demoted
- Theme color and font are global controls in the toolbar; changes are live in the canvas preview

### API Routes

All under `src/routes/api/templates/`. Superuser-only for create/edit/delete; any user with `quotations.view` or `invoices.view` can hit the preview and export endpoints.

| Endpoint | Methods | Notes |
|---|---|---|
| `/api/templates` | GET, POST | List all templates; create new (seeds default layout JSON) |
| `/api/templates/[id]` | GET, PATCH, DELETE | PATCH: name, theme, layout_json. DELETE: removes DB row + `{uuid}/` asset folder; blocks deletion of the only remaining template |
| `/api/templates/[id]/assets` | POST | Multipart upload of a single image; saves to `templates/{uuid}/assets/{asset-uuid}.ext`; returns `{ filename }` |
| `/api/templates/[id]/assets/[filename]` | DELETE | Removes asset file from disk |
| `/api/templates/[id]/preview` | GET | Renders PDF using this template + synthetic (or most-recent real) document data; returns `application/pdf` |
| `/api/templates/[id]/default` | POST | Sets `is_default = 1` for this template, clears `is_default` on any other template with overlapping `document_type`; updates the `settings` key |

Existing `/api/quotations/[id]/pdf` and `/api/invoices/[id]/pdf` endpoints are updated to resolve the active template via the `settings` key and pass `layout_json` to the renderer.

### PDF Renderer

The existing simple PDF template (Phase 7) is replaced by a layout-driven renderer:

```
src/lib/server/pdf/
  renderer.ts          ← entry point: resolveTemplate() → renderLayout() → PDF bytes
  layout.ts            ← zone/column layout engine (computes x/y/width for each block)
  blocks/
    company-header.ts
    document-meta.ts
    customer-block.ts
    line-items-table.ts
    totals-block.ts
    notes.ts
    paid-stamp.ts
    issued-by.ts
    text.ts
    image.ts
    divider.ts
    spacer.ts
```

Each block module exports a single `render(doc, blockDef, data, theme)` function. The layout engine calls them in order, passing the computed bounding box. Theme (color, font) is resolved once at the top and threaded through. Use the `pdf` skill for the underlying PDF generation.

### Files to Create / Modify

**`src/lib/server/enums.ts`** — append `TemplateDocumentType`, `TemplateFont` and their label maps.

**`src/lib/server/db/schema.ts`** — add `documentTemplates` table.

**`src/lib/server/pdf/`** — new directory replacing the single Phase 7 PDF template file; renderer + layout engine + per-block modules as above.

**`src/lib/server/queries/templates.ts`** — Drizzle builders: list, get, create (with default layout seed), update, delete (+ asset folder cleanup), set-default (clears prior default for same document_type, updates settings keys).

**`src/routes/api/templates/**`** — route handlers above.

**`src/routes/(app)/settings/`** — new "Templates" tab (alongside General, Intelligence, Categories, Advanced); renders the designer canvas.

**`src/lib/components/template-designer/`** — client-side designer components:
- `TemplateDesigner.svelte` — root; manages layout state, drag state, selected block
- `ZoneCanvas.svelte` — renders one zone (header/body/footer); handles column add/remove
- `ColumnCanvas.svelte` — renders one column within header/footer; handles block drop + reorder
- `BlockPalette.svelte` — left panel; draggable block type list
- `BlockConfigPanel.svelte` — right panel; dynamic form keyed off selected block's `type`
- `BlockPreview.svelte` — visual representation of each block in the canvas (not the real PDF render — a lightweight HTML approximation for design-time feedback)
- `ThemeControls.svelte` — color picker + font selector in the toolbar

### Deferred

- Per-document template override (a `template_id` FK on `quotations`/`invoices` and a picker on the document form)
- Email sending with PDF attachment
- Custom page size / orientation (A4 portrait assumed throughout)
- Header/footer repeat on multi-page documents (first-page-only layout for now)
- Rich text in `text` blocks (bold, bullets) — plain text with `\n` is sufficient for bank details and T&C

---

## SQLite → PostgreSQL Migration Path

Only 3 files need to change:
1. `schema.ts` — `sqliteTable` → `pgTable`, `TEXT` date → `timestamp`, `REAL` amount → `NUMERIC(10,2)`, integer PKs → `serial`. INT-coded enum columns (`status`, `state`, `entity_type`, `role`, etc.) carry over unchanged — `INTEGER` → `integer`, no value remapping, which is a side benefit of coding enums as INT rather than TEXT.
2. `client.ts` — swap `better-sqlite3` driver for `node-postgres`
3. `drizzle.config.ts` — change dialect + connection string

All query code in `src/lib/server/queries/*.ts` is unchanged — Drizzle's query builder is dialect-agnostic. Run `drizzle-kit generate` to produce the PostgreSQL migration SQL. Estimated effort: 1–2 days.

---

## Verification Checklist (per phase)

1. **Auth**: visit app URL without login → redirected to `/login`; wrong password → stays on login; correct → access granted; programmatic POST with a user's Bearer token bypasses cookie check
2. **Running numbers**: create 2 expenses on same day → `EX20260610-001` and `EX20260610-002`; next day → resets to `EX20260611-001`
3. **Claim workflow**: create claim with 2 unpaid expenses → both status=pending; total = sum of their amounts; "Mark as Claimed" → both paid; delete claim → both revert to unpaid; claim list/detail shows only minimal expense fields (item, amount, date) even for a user without `expenses.view`
4. **Locking**: PATCH `amount` on a claimed expense → 403; PATCH descriptive fields with God Mode off → 403; God Mode on → 200
5. **Auto Import**: upload PDF via API → `202` with jobId; poll shows `extracting → processing → pending_review`; confirm with no body → expense/income created with LLM-extracted values; confirm with corrected amount → corrected value in DB; file moves from `import/temp/` to `expenses/{year}/{month}/`; duplicate upload → `duplicate_signal` set, skip deletes temp file. **Contact resolution**: a receipt whose supplier exactly matches a contact → pre-selected in the review combobox; a near-match → appears as a candidate but is not auto-linked; confirming with a typed new name → new business contact created in the same transaction and linked; abandoning/skipping the review → no contact created.
6. **Token API**: `POST /api/expenses` with a user's Bearer token → 201 with expenseNumber; without token → 401; token belonging to a user without `expenses.add` → 403
7. **Backup**: export → ZIP with all 4 expected files; import the same ZIP → all records intact; both endpoints return 403 for a non-superuser
8. **Groups & permissions**: create a "Reviewer" group (`view` only on all resources), assign a new user (with a name set) to it → that user can view expenses/income/claims/import but POST/PATCH/DELETE all return 403, and `/settings/users`, `/settings/groups`, `/settings/backup` etc. return 403/redirect; sidebar shows the user's name; remove the user from all groups → nav collapses to empty shell, all data routes 403/404, login still succeeds; add user to `Administrators` → full access including Settings → Users/Groups; attempt to rename or delete `Administrators` → blocked
9. **Contacts & enums**: create a `business` contact with `entity_type` INT code → stored as INT, GET returns resolved label; omit `entity_type` on POST → 400 (no default). Assign `supplier` + `employee` roles → both rows in `contact_roles`; expense dropdown lists it, income dropdown does not; assigning an expense to a customer-only contact via API still succeeds (soft validation).
10. **Contact merge**: two duplicate suppliers each linked to expenses → merge → survivor holds all those expenses + union of both role sets; loser rows gone from `contacts` and `contact_roles`; refused for a user lacking `contacts.delete`; `/api/contacts/duplicates` clusters `ABC Sdn Bhd` / `ABC SDN BHD` together. Soft-delete a referenced contact → `is_active=false`, linked expenses retain `contact_id`.
11. **Contacts migration**: run against seed data with duplicate supplier/source strings → distinct contacts created, roles assigned (supplier/customer/both), all expenses/incomes relinked via `contact_id`, `supplier`/`source` columns dropped, zero orphaned references.
12. **Quotation → invoice → income**: create a quotation with 2 line items → `QT`-numbered, `subtotal`/`total` = line sum, `tax_amount = 0`; convert → new `Draft` invoice (`IV`-numbered) with copied lines + contact, quotation now `Converted`, both link fields set, second convert → 409; mark invoice `Paid` → `amount_paid = total`, an income record created via `nextNumber`, `result_income_id` back-linked, second pay → 409.
13. **Derived statuses**: an invoice past `due_date` and not `Paid` → list/detail report `Overdue` without any stored status change; a quotation past `expiry_date` in `Draft`/`Sent` → reports `Expired`; neither writes to the `status` column.
14. **Quotation/invoice permissions & merge**: a user with only `quotations.view` can list/PDF but POST/PATCH/convert → 403; `invoices` resource enforced the same way. Merge two customer contacts each linked to invoices → survivor holds all invoices and quotations, losers gone; a contact referenced by any invoice/quotation → hard delete returns 409.
15. **PDF template builder**: on first boot with no templates → default template seeded (company-header + document-meta in header, customer-block + line-items + totals + notes in body, empty footer); create a second template → both appear in Settings → Templates list; set new template as default → `settings` key updated, old template demoted; add an `image` block, upload an asset → file appears in `templates/{uuid}/assets/`; delete template → asset folder removed from disk, blocked if it is the only template; `GET /api/quotations/[id]/pdf` uses the active default template; `GET /api/templates/[id]/preview` returns a valid PDF without an existing document. Non-superuser cannot POST/PATCH/DELETE templates → 403.
