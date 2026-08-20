# Specification Quality Checklist: One Ledger, One Records Screen, One Flat Account List

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-08-17
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
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

## Constitution Alignment (project-specific)

- [x] Principle VII — glossary present; no unexplained domain term; the "why" is given, not just the rule
- [x] Principle VII — the recommendation states what is given up, not only the preferred option (see "What is NOT messy")
- [x] Principle I — every screen stated as usable at mobile width (SC-009)
- [x] Principle II — no new datastore, service or mandatory network dependency implied
- [x] Destructive change carries a stated data-migration path, with backup responsibility explicitly assigned (FR-038)
- [x] Every access change is stated rather than silent (FR-031b, FR-046, D-05)

## Notes

**Validation pass 5 (2026-08-17)** — all items pass. No `[NEEDS CLARIFICATION]` markers remain.

Six decisions, each recorded with what it gives up:

- **Q1 → D-01**: one form, everyday words, both sides always named. Gives up the marginally
  smaller free-form grid; keeps the app usable by a non-accountant.
- **Q2 → D-02**: the by-hand capability survives as an ability rather than a screen, gating the
  full account list and any third side. Held by no seeded group, off by default, enforced
  server-side (FR-031–FR-031e, SC-011, SC-012). Gives up one extra ability for an administrator
  to understand; keeps the only actual control in the feature.
- **Q3 → D-03**: retired tables removed outright; backing up before upgrading is the user's own
  responsibility, so the release notes carry the warning rather than the system taking a copy.
  Recorded with the note that this departs from how the earlier one-off conversion behaved.
- **D-04**: addresses of the removed screens retire outright, no redirects, and the
  pre-conversion id look-up goes with them. Gives up old bookmarks and links shared out of the
  app; the maintainer does not keep them. In-app links are still the app's responsibility (US5).
- **D-05**: an account's history becomes the Records list narrowed to that account, with a
  running balance; the separate full-page history retires. Gives up some width, and adds one
  conditional rule (the balance column hides when the rows would be incomplete or out of order,
  FR-043). Also moves that view from the reports ability to the records ability — the one place
  this feature does not leave existing access untouched, called out rather than left silent.
- **D-06**: reconciling moves into the account it already belongs to; the menu item goes and the
  cross-account "still needs clearing" tab becomes a Records filter. Gives up a place you land
  on in favour of a filter you have to think to look for — the real cost, recorded as such —
  and means an unfinished reconciliation or a misfiled statement is no longer centrally listed,
  which FR-053–FR-055 exist to cover. Who may reconcile does not change (FR-057).

Ready for `/speckit-plan`. Five things the plan should expect to address, none a spec gap:

1. `CLAUDE.md` documents the per-feature deep-link pattern, the named-URL exception table
   (Payment / Transfer / OpeningBalance / InvoiceIssue have no screen of their own) and
   `SettlementList`'s `canOpen`. Merging three screens into one changes all three, so the plan
   must update `CLAUDE.md` in the same change (Principle VI).
2. `CLAUDE.md`'s "Named full-page exception" lists `/accounts/[id]/history` as a full page the
   account drawer links to through the relation-card contract. D-05 retires that page, so that
   paragraph and the accounts split it describes both need rewriting.
3. Removing stored tables is a destructive schema change, so the plan must state its
   data-migration path explicitly (Development Workflow & Quality Gates).
4. `CLAUDE.md`'s "Named exception — task workspaces" cites `/reconciliation/[id]/match` as the
   reference exception. That route **does not exist on disk** — reconciliation is one 2,852-line
   component on `/reconciliation` — so the documented exception is already stale. D-06 gives the
   matching surface a real address (FR-052), which is the chance to make the doc true.
5. `ReconciliationPage.svelte` is 2,852 lines carrying upload, extraction state, two tabs,
   matching and auto-matching. D-06 removes one of its two tabs and changes where it is entered
   from, so the plan should say whether it is split or moved whole. Not a spec question — the
   spec fixes behaviour, not file layout — but it is the largest single piece of work here.
