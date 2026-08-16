# Specification Quality Checklist: Double-Entry Ledger

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-08-14
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain — both outstanding questions resolved 2026-08-15; see Notes
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

**Validation iteration 1 — 2026-08-14**

Two questions remain open, recorded in the spec's *Outstanding Questions* section rather than as
inline markers so the surrounding requirements stay readable:

- **Q1 — Opening position.** What balance each account starts from and as at what date. This blocks
  FR-010 and SC-007: without it, every account balance and any statement of financial position is
  wrong from the first day of use. Highest-impact open item.
- **Q2 — Equipment.** Whether spreading equipment cost over its useful life is in scope here or
  deferred. This is a scope boundary, not a detail — it changes what US5 must produce and whether
  the *Out of Scope* list is correct as written.

Everything else was resolved during the specification conversation and is recorded in
*Clarifications* and *Assumptions*. Nine decisions were settled there, including revenue timing,
one general record versus separate stores, no separate store for amounts owed and owing, derived
rather than user-set paid state, and invoices remaining documents.

**Validation iteration 2 — 2026-08-15 (`/speckit-clarify`)**

Both outstanding questions are closed and the *Outstanding Questions* section has been removed:

- **Q1 — Opening position** → one user-recorded opening balance per account, as at a chosen date,
  entered as an ordinary balancing event against a dedicated opening-balances owners' account.
  Upgrade-created accounts open at zero, so SC-001 holds mechanically. FR-010 rewritten.
- **Q2 — Equipment** → capitalisation in scope (FR-006b), depreciation schedules and automatic
  postings out of scope and added to *Out of Scope*.

Three further ambiguities were resolved in the same session:

- **Editing a settled or reconciled record** → prevented, not flagged. FR-017a added; the edge case
  and SC-012 rewritten from "surfaces the discrepancy" to a refusal that names the undo path. This
  extends the existing `src/lib/server/locking.ts` rules rather than adding a second mechanism.
- **Categories** → category and account are one concept (FR-006a), matching mainstream accounting
  software. Existing categories migrate to accounts of the matching kind (FR-033). An independent
  tag dimension for department/project slicing is explicitly out of scope.
- **The other side of an everyday record** → the category itself, so no account is resolved behind
  the scenes and FR-020/SC-010 are unaffected (FR-011).

**Validation iteration 3 — 2026-08-15 (`/speckit-clarify`, contacts and readability)**

Two further decisions, plus a full rewrite of the spec in plain language:

- **Contacts and accounts** → a contact is never an account (FR-008a). People the business trades
  with are held in two shared "owed" accounts with the contact named on each movement, and per-
  contact balances are worked out by filtering (FR-008). Partners are the exception: each gets
  their own capital and drawings account so the balance sheet can name them (FR-008b). This
  resolves a contradiction between the Session 2026-08-14 clarification (control accounts sliced by
  counterparty) and the old Key Entities line ("an account may be tied to a counterparty").
- **Deleting a contact with history** → blocked; archive only (FR-009a). A contact nothing points at
  can still be deleted. Mirrors FR-009 for accounts and the existing disabled-delete-with-tooltip
  pattern in `CLAUDE.md`. The *Counterparty deleted while still owed money* edge case is now
  resolved rather than merely asserted.
- **Plain-language rewrite.** The whole spec was rewritten for a reader without an accounting
  background, and a *Words Used In This Spec* glossary added. No requirement was dropped, no MUST
  softened, and every FR/SC identifier is unchanged. This is now mandated by Constitution
  Principle VII (added in v1.2.0, in the same change).

**Validation iteration 4 — 2026-08-15 (`/speckit-clarify`, full consistency review)**

A read of the whole spec against itself found four contradictions and one gap. All five are closed:

- **Invoices contradicted themselves** — Assumptions said invoices were unchanged in the first
  release, while US3 scenario 7 and all of US6 required them to feed the ledger. Resolved in favour
  of feeding it (FR-018a); the superseded half of the 2026-08-14 clarification is marked as such.
- **Claims were both kept and abolished** — US1 promised every claim survives, Assumptions said a
  claim stops being a record kind. Resolved: retired outright (FR-036a), screen and `claims`
  permission resource included. Old claim URLs are deliberately not preserved — a
  conscious exception to Principle VI's shareable-URL rule, taken because they are unused, and one
  the plan should record in Complexity Tracking.
- **A contact had two homes** — on the Record in Key Entities, on the Movement in FR-008. Resolved:
  the record owns it, movements inherit (FR-008). Consequence recorded as an edge case: one record
  covers one contact.
- **Nothing defined a partner** — FR-008b required each partner to have accounts while Assumptions
  denied any notion of a partner. Resolved: "partner" is a contact role (FR-008b), the single
  stated exception to FR-008a.
- **Existing bank statements had no account** (gap) — FR-021 requires one, FR-037 forbids manual
  steps. Resolved: assigned to the default bank account at upgrade (FR-034a), with FR-032a now
  requiring that account, the two shared owed accounts and the opening-balances account to exist
  before anything is moved.

Also tightened: SC-009 no longer implies every user gains a step (a single-account user gains none).

**Validation iteration 5 — 2026-08-15 (`/speckit-clarify`, migration of files and numbers)**

Two migration constraints the spec had never stated, raised by the user and grounded in the code:

- **Attachment files move** (FR-032b, FR-032c). Today they live under `expenses/`, `income/` and
  `claims/` by year and month (`src/lib/server/file-storage.ts:85`), in three separate attachment
  tables. The user chose to move them into one layout rather than leave them in place. Because a
  file move is the one part of the upgrade a database rollback cannot undo, FR-032b requires
  copy-verify-then-remove, skipping files already moved so a re-run is safe, no deletion until
  FR-038's check passes, and a missing file reported rather than failing the whole upgrade.
- **Reference numbers never change** (FR-032d, FR-032e). `expense_number`, `income_number` and
  `claim_number` are stored on the record, not recomputed, so preservation is free — the risk was
  only ever a renumbering decision. These numbers are used as bank transfer references outside
  Akaun, so reissuing one breaks a payment trail the app cannot repair. No unified numbering scheme
  is introduced; retired claims carry their number onto the payment they become and new payments
  continue that counter.

New success criteria SC-013 (every pre-upgrade number present and searchable, character for
character) and SC-014 (attachment counts and contents match; interrupting and re-running produces
the same result) make both checkable rather than merely asserted.

**Constitution touchpoints to carry into `/speckit-plan`** (not spec defects, but they will be
gated at the Constitution Check):

- Principle V makes test-first mandatory for financial calculation. The rules governing FR-001 to
  FR-003 and the derived paid state in FR-012 fall squarely in that scope.
- Principle III (build what is needed) is in genuine tension with a change of this size. It is
  justified by present, named needs — partner capital, equipment, instalments, and the statutory
  filing that follows incorporation — but that justification MUST be recorded in the plan's
  Complexity Tracking table or the gate blocks the plan.
- The Development Workflow section requires destructive schema changes to state their
  data-migration path because users self-host. FR-037 and FR-038 encode this.
- Principle VII (plain language) now applies to `plan.md` and `tasks.md` too, and to every UI
  label and error message this feature adds — notably the refusal messages required by FR-016,
  FR-017a and FR-009a, which must say what to do next in ordinary words.

All items pass. The spec is ready for `/speckit-plan`.
