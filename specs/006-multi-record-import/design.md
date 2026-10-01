# 006 Multi-record Import + Profiles — technical design

## Context

Today Auto Import turns one document into one record. The single-record assumption is hard-coded in the LLM schema (`import/providers/shared.ts:3-12`), in a silent `slice(0, 6000)` (`shared.ts:76`), in the flat review columns and the scalar `result_id` (`db/schema.ts:278-320`), in the one-row worker (`worker.ts:211-348`), in the inline confirm (`api/import/[jobId]/confirm/+server.ts:69-361`) and in four unconditional file deletes. The goal is for receipts, invoices and marketplace statements to produce N records: either Summary lines or Every transaction, never both, through user-defined **import profiles**, with the standard reading (today's receipt path) as the fallback. The requirements are already in `specs/006-multi-record-import/spec.md` (FR-001 to FR-049). An earlier brief (`plans/currently-the-auto-import-elegant-lecun.md`) was checked against the code by 6 agents. This plan keeps its direction and corrects it in the places listed under "Changes from the earlier brief".

**Decided with the user (2026-09-30):**
- A form writes the schema. Raw JSON is used only for extra fields.
- The router runs in code. There is no tool-calling loop.

## The answer to "JSON Schema or prompt?"

A schema makes the **shape** of the output deterministic. It does not decide **which lines** are picked or **what they mean**. Determinism therefore comes from three layers, and the schema is only one of them:

1. **Structure (code compiles the schema):**
   - The compiled schema holds only the sections of the chosen mode, so in Summary mode a transaction row has nowhere to go (FR-032).
   - Fee types are a string `enum`, **nullable**. Code drops lines where it is null and lists them under ignored lines. This is what makes FR-034 real: a strict enum without null would force a stray line into the closest type.
2. **Code after extraction:**
   - kind by sign
   - fee type → pinned category
   - control total in cents (`ledger/money.ts` `toMinor`)
   - contact match, FX, duplicate check
3. **Guidance (probabilistic, scoped):**
   - the profile's instructions and each section's and fee type's description, sent as schema `description`s
   - never a user-editable envelope

Users edit a profile on a **form**: sections, mode, kind, fixed category, fee types with pinned categories, and the stated-total label per mode. The server builds the schema from the form. "Advanced: extra fields" is a JSON Schema fragment (flat scalars only). The same whitelist validator parses it on the client and the server.

## The answer to "agentic loop?"

**There is no agent or tool loop to reuse.** The code has two copies of provider failover plus structured-call-with-text-fallback, one in `import/providers/index.ts:24-144` and one in `reconciliation/statement-llm.ts:15-207`. Reuse therefore means merging those two into one module.

The flow "identify → profile? → else legacy" is a **router that runs in code**:

```
route = explicitChoice
     ?? phraseMatch(text, enabledProfiles)          // exactly one profile matches all its phrases → no AI
     ?? (enabled.length ? detect(head 3k chars)      // one Output.object({profile: enum([...ids,'none'])})
                        : 'standard')
'standard' → today's receipt call, unchanged (FR-003/004/040)
else       → withProviderFailover(closure: header call + one structured call per piece → merge)
```

- **No tool loop.** It would resend up to 200k chars on every step. Tools combined with a structured response are weak on Gemini and Groq. `hasToolCall` also fires on an invalid submit. And document text would get to choose which tool runs (FR-042).
- **Later: one bounded, code-driven re-check.** Only if Phase 0 shows control-total mismatches are common: when the total disagrees, make one extra structured call that includes the difference.

## Changes from the earlier brief

| Brief | Now | Why |
|---|---|---|
| Fan out into child `import_queue` rows | New **`import_items`** table (FK `job_id`, index `(job_id,state)`) | The spec now wants a paged table of up to 1,000 items. With child rows, every queue reader, the SSE snapshot and `mergeServerJobs` would need to filter children out, and 4 routes would delete the file they share. |
| US1-3 on a separate `items[]` envelope, cards UI | One section→schema compiler from the start. "Several items" is a **built-in profile** | The envelope, the separate prompt, the group cards and the Split fan-out would all be thrown away later. |
| Merge pieces by de-duplicating on (date, ref, amount, desc) | **Each line belongs to one piece**: lines prefixed `L0412│`, each piece has an owned range plus ~15 lines of context, items carry `source_line`, and code keeps an item only if its line is in the owned range | The old dedupe merges genuinely identical rows, such as two 1.00 ad fees on one day. Uncertain cases near a boundary are flagged for the reviewer, never deleted. |
| `z.fromJSONSchema` to validate | Hand-written `FieldSpec[]` model with two outputs: the schema sent (`jsonSchema(wire, {validate})`) and a validator | `z.fromJSONSchema` is semi-experimental, no client file imports zod today, and the whitelist is small. |
| Output.choice | Output.object with an enum | `Output.choice` wraps its answer in `{result}`, so the text fallback would need a special case for it. |
| Caps of 40k chars and 50 items | 200k chars and 1,000 items, read in pieces | These are the numbers in the spec's Assumptions. |

## Stages

### S0 — Foundations (no visible change)

- **Characterisation tests first** for `callLLMWithProviders`. It has none today.
- **New `src/lib/server/llm/structured-call.ts`:**
  - `extractJsonObject`: the quote-aware version from `statement-llm.ts:26-47`.
  - `callStructured(model, provider, spec)`:
    - `generateText` + `Output.object`, `temperature: 0`, throttled before **every** call.
    - The unsupported cache is keyed `type:model:schemaId`, and set only on a 400. That includes a 400 inside a `RetryError`.
    - A `NoObjectGeneratedError` falls back to text for this call only.
    - `NoOutputGeneratedError` becomes `OutputTruncatedError`.
  - `withProviderFailover(providers, closure)`.
- **Move both callers onto it**, then delete the dead `llm/retry.ts`. Rewrite `statement-llm.spec.ts` with `MockLanguageModelV4` (from `ai/test`).
- **Worker tick must not block** (`worker.ts:93` awaits the whole batch).
- **Emitted rows leave out the text columns.**
- **New `services/import.ts` `confirmImportRow(db, reviewFields, …)`:**
  - A conditional claim: `UPDATE … WHERE state=PendingReview RETURNING`.
  - One sync `db.transaction` covering the contact, `createRecord`, the attachment and Imported. This fixes the race at `confirm:81→276` and the orphan contact.
  - Events deferred until after commit. `createRecord` emits inside the transaction today (`services/ledger.ts:108-120`), so it needs a way to defer those emits.
- **`file-storage.ts`:**
  - a `root` param, so tests never touch `data/storage`
  - an idempotent move
  - `releaseIfUnreferenced`, used by the attachment DELETE, skip, discard and history clear
- **History row links to `/records/[id]`** (FR-021). `normalizeJob` needs to keep `resultId`.
- **Exit:** the receipt characterisation tests are unchanged, and the hash of `data/akaun.db` is unchanged.

### S0.5 — Phase 0 research (no product code)

A throwaway script imports only `document-text.ts` and `structured-call.ts`, **never `db/client.ts`**, and runs on copies of the maintainer's samples outside `data/`. It checks four things:
- whether the right lines are picked
- whether text-only reading scrambles the marketplace table (test `unpdf mergePages:false`)
- whether `Output.object` works with a compiled schema on OpenRouter, Google and Groq, including enum size
- how many output tokens 100 rows take

If the table comes out scrambled, US8 is blocked, so this must run before any UI is built.

### S1 — US1-3 and the core of US4/5

- **Migration `0022`** (additive):
  - `CREATE TABLE import_items`. Its review columns come from a shared `reviewColumns()` drizzle helper and one `ReviewFields` type, with `source_line`, `section_key`, `fee_type`, `kind` and `result_id` added.
  - `ALTER TABLE import_queue ADD` `read_as`, `profile_id`, `profile_snapshot`, `import_mode`, `read_how` (chosen/detected/standard), `extraction_notes` (stated total, ignored[]), `progress_done`, `progress_total`.
  - `ImportState.Grouped = 9`, append-only.
- **`import/profile-compiler.ts`:** built-in profiles written as `FieldSpec`. The compiled envelope is:
  ```
  { header{counterparty,date,reference,currency}, stated_total,
    sections{<slug>: Item[]}, ignored[] }
  ```
  where `Item = {description, amount (signed), date, reference, source_line, fee_type?, category_account_id?, extras?}`. All properties are required, nullable where optional, with `additionalProperties:false`. Unknown keys are **stripped** in validation, because Google drops `additionalProperties`.
- **Worker:**
  - Lift `worker.ts:249-348` into `buildReviewFields(db, item, ctx)`.
  - FX dates are de-duplicated.
  - Duplicate check per item runs with `extractedText: null`. Filename is off automatically, because there is no queue row with that `result_id`.
  - One transaction inserts the items and flips the parent to Grouped, after checking the parent still exists. 1 item → today's flat receipt columns. 0 items → Failed "No items found".
- **Parent hash stop before the LLM call** (FR-026): same hash on a Grouped parent that has an Imported item, or on an Imported receipt.
- **Records from items get `extracted_text` NULL.** A shared file is also not re-indexed. `attachments/+server.ts:88-94` and `search-rebuild/worker.ts:84-97` would otherwise put the full text back (FR-029).
- **Routes:**
  - `GET/PATCH /api/import/[jobId]/items`
  - a bulk route for confirm-all/selected (run **one after another** on the server), skip and set-category
  - a group Source account saved on the server
  - `DELETE` on a parent removes pending items only
  - events `item-update` / `item-deleted` with **no snapshot**, plus one parent summary emit
- **UI:**
  - The upload form gets "Read as" and "Import" selects, remembered in localStorage and Zod-validated in `POST /api/import`.
  - The review card moves out of `import/+page.svelte:763-975` into `ImportReviewCard.svelte`.
  - New `/import/[id]` page on `DetailPage`, with loaders split into `loaders/import.ts` `loadImportPage`/`loadImportDetail`. It loads every slim item row (≤1,000) and pages and filters on the client, like `RecordsPage`. It reuses `BulkActionBar`, `FilterDropdown`, `StatusBadge`, `ImportSourceAccountSelect` and `ImportCategoryAccountSelect`. Row selection is copied from `RecordsPage.svelte:192,365-437`.
  - The queue card links with `row-link`. The rail shows the file, the control total and the ignored lines.

### S2 — US6-7: profiles

- **`import_profiles` table:** name, description, phrases JSON, instructions, sections JSON, stated-total label per mode, enabled.
- **Shared validator `src/lib/import-profile-schema.ts`** (the `sequence-template.ts:97` pattern):
  - the whitelist (`FRAGMENT_KEYWORDS` and `FIELD_KEYWORDS` in `src/lib/import-profile-schema.ts`): on the extra-fields object only `type`, `properties` and `required`; on each field only `type`, `description` and `enum` (text values, and only on a text field). A value that may be missing is written as a type list with `"null"`, such as `["string", "null"]`. The type is `string`, `number`, `integer` or `boolean`; nested values (`properties` or `items` on a field, or the type `object` or `array`) are refused. `items` is not on the list.
  - the "none" sentinel (`NONE_VALUE`): a list of choices that may be empty — a section's fee type, or a nullable extra field with an `enum` — is sent with `"none"` as one more choice, not with null. A strict provider (OpenAI, Groq) allows only the values `enum` names, and Google refuses a null inside an `enum`, so null cannot be said there. The reading turns `"none"` back into null, and the validator refuses `"none"` as a fee type key or as a choice.
  - caps: 20 sections, 50 fee types per section, 200 enum values in total, 20 extras
  - slug keys only, and canonical names are reserved
  - error messages name the path
- **Where to edit:**
  - The list lives in the Settings › Intelligence tab.
  - The editor is its own page, `/settings/import-profiles/[id|new]`, on `DetailPage`: stage the whole profile and save once.
  - `/api/import/profiles` writes are gated by `hasPermission('import','change')`; reading the list or one profile needs `import.view`, as the editor page does (read-only without `change`).
  - Add `recordAudit` with a new `'import_profile'` `RecordType`.
- **Review note (migration 0025, additive):** `review_note` on the review columns of the queue and of items. The reading writes it when a fee type's tied category is for the other kind of line (FR-034); while it is set, `itemAttention` returns it, and choosing a category clears it. The receipt card shows it too, for a one-item reading.
- **Two starters:** "Fee document" and "Marketplace statement summary" (the summary half only; the transactions half waits for US8).
- **FR-037:** a provider 400 on a profile schema **fails that document**, with no text fallback. Built-in schemas keep the fallback. `schemaId = profile:<id>:<sha256(wire)>`, and a snapshot of the profile is stored on the job (FR-038, Read again).

### S3 — US8-9

- **Pieces:** made from pages, owned ranges plus context, split in half on `OutputTruncatedError` (depth ≤2, then Failed with the limit named). Progress goes in the columns.
- **Header call:** first and last page plus the Summary sections.
- **Auto-detect:** the router above.
- **"Read again":** delete the pending items and requeue, guarded by "no item is Imported".

## S0.5 research results (2026-09-30)

Samples: a Shopee monthly Income Statement (3 pages), a Shopee ads e-invoice (2 lines plus tax), and a Shopify bill in USD. Model: `gemma-4-31b-it` on Google AI Studio (what the book uses). OpenRouter's `google/gemma-4-31b-it:free` returned 429 from the shared free pool for every attempt over 6 minutes, so it gave no results. The research script used only `unpdf` and the SDK, not app modules and not the database.

| Case | Result |
|---|---|
| Ads invoice, several items | Exact: 732.87 and 1,080.00 (amounts including tax); stated total 1,812.87. |
| Shopee statement, Summary, 15 fee types | Exact: 15 of 15 leaf lines, each with a distinct fee type and none null; they sum to 13,732.56 to the cent, matching Total Payout Released. The 4 group subtotals were left out. 90 s, 7.3k tokens in, 0.9k out. |
| Shopify bill, standard | Values correct, but Gemma wrapped the JSON in a ``` fence, so strict parsing failed. The text fallback in `structured-call.ts` covers this. |
| Shopee daily payout table, page 1 (6 rows × 15 columns) | All 90 cells correct, including cells the PDF split across lines (`719.1` / `7`) and the U+2212 minus sign. **Every row total the model added up itself was wrong** (381.10 against the true 470.22). 88 s for 2k output tokens. |
| Same table, all 31 rows | Stopped by Bun's default 300 s fetch timeout. |

**What this changes**

- **Code does all the arithmetic.** The model transcribes and code adds up. This is already true of the control total. Never ask the model for a derived figure.
- **Every transaction is not built for now** (user decision). The Shopee table is one row per day with 15 amount columns, not one transaction per line, so it would need one row to produce several records. Summary covers the real case exactly. US8 and FR-043 (pieces) are deferred. FR-010 still applies: an over-long document fails with the limit named, and is never cut short.
- **Output speed is the limit, not input size.** About 10–20 tokens/s on this model. Any later piece plan must size pieces by expected output tokens and keep each call well under 300 s, because Bun's `fetch` times out at 300 s.
- **Text:** `unpdf` with `mergePages: true` returns the text on one line with no line breaks. Several-items and profile readings use `mergePages: false`, joined with line breaks and L-numbers. The receipt path is left as it is (FR-004).
- **The structured-to-text fallback is required, not optional,** for Gemma on Google.

**Revised S3:** auto-detect (recognition phrases, then one detect call) and Read again. The piece reader waits for a document type that needs it.

## Critical files

- **LLM:** `src/lib/server/llm/structured-call.ts` (new), `import/providers/{index,shared}.ts`, `reconciliation/statement-llm.ts`
- **Import server:** `import/worker.ts`, `import/duplicate-detector.ts`, new `import/profile-compiler.ts`, `services/import.ts`, `services/ledger.ts` (deferring emits)
- **Data and storage:** `db/schema.ts`, `drizzle/0022_*`, `src/lib/enums.ts`, `file-storage.ts`
- **Routes:** `src/routes/api/import/**`, `api/records/[id]/attachments/**`
- **UI:** `(app)/import/+page.svelte`, new `(app)/import/[id]`, `loaders/import.ts`
- **Shared validator:** `src/lib/import-profile-schema.ts`

## Spec changes made with this design

- **FR-035:** raw JSON covers extra fields only. The canonical fields are generated from the form.
- **FR-043:** how the pieces are merged (each line belongs to one piece). Uncertain rows near a boundary are flagged, never dropped.
- **FR-045:** kept as today. Confirm checks `import.change` only (`confirm:72`), not `records.add`; group confirm uses the same check.
- **Noted, not in scope:**
  - Settings actions and the Settings loader have no `hasPermission`, so the profile pages must gate themselves.
  - Clearing history removes the FR-026 evidence, for receipts too.

## Verification

- **Tests first, `server` project under Bun,** using a temp SQLite DB and `os.tmpdir()` storage roots:
  - `structured-call` (structured OK, 400 fallback, a custom-schema 400 does not poison other schemas, truncation)
  - receipt characterisation
  - compiler snapshot per starter, plus a round-trip check that every value the schema accepts passes the validator
  - null fee type ends up in ignored lines
  - by-sign
  - signed control total in cents
  - owned-range merge that keeps identical rows
  - 0/1/N items
  - parent hash stop
  - no filename or content false positive on last month's items
  - `confirmImportRow` rollback and double-confirm race
  - interrupted confirm-all run again
  - file refcount on the attachment delete, skip, discard and history clear paths
- **After schema edits:** `bun run db:generate`, then check that `0022` is `CREATE TABLE` plus `ALTER … ADD` only and that its `when` is later than `0021`.
- **Before finishing:** `bun run check` (with no dev tab open), `bun run lint`, `bun run test`.
- **Safety:** `ps aux | grep "vite dev"` first. `sha256sum data/akaun.db` before and after. No browser and no dev server.
- **The user checks by hand:** the S1 fee document, the S2 marketplace Summary, and the S3 300-row statement.

## Delivery

No spec-kit. S0 is implemented directly, tests first, one commit per piece. Stop at S0.5 for the maintainer's sample documents. S1, S2 and S3 follow in order, with a manual check after each.
