# Contract: Account "kind" on the Accounts API

Extends the existing endpoints — no new routes. Both already: check
`hasPermission(locals, 'accounts', 'add' | 'change')`, validate with a Zod schema, call
`recordAudit`, and emit on `accountEvents` after the write (all unchanged, per Principle IV/VI).

## `POST /api/accounts`

Existing schema (`routes/api/accounts/+server.ts`): `{ type, name, parentId }`.

**Change**: add `kind`.

```
{
  type: AccountType
  name: string
  parentId?: number
  kind?: AccountKind        // required by the service layer when type === Asset; rejected (400) if present for any other type
}
```

- `type === Asset` and `kind` missing → `400`, same shape as other required-field validation
  errors today.
- `type === Asset` and `kind === Equipment` → `400`. Equipment is never set through this
  endpoint (Research §4); it continues to be set wherever the existing record-form/category path
  already sets it.
- `type !== Asset` and `kind` present → `400` (`.strict()` schema rejects the unknown-for-this-type
  field, same pattern as `role` being absent from the patch schema today).

## `PATCH /api/accounts/[id]`

Existing schema (`routes/api/accounts/[id]/+server.ts`): `{ name?, type?, parentId?, active? }`
(`.strict()`).

**Change**: add `kind?: AccountKind`.

- Allowed only when the account is otherwise editable — same 403/409 behavior the endpoint already
  returns for a locked/system account, reused rather than duplicated (Research §3). No new
  movement-count check is added for a `kind`-only patch, even though one already exists and is
  enforced for a `type` patch.
- Same two rejections as `POST` above: `kind === Equipment` and `kind` on a non-Asset account are
  both `400`.
- The audit diff (`recordAudit`) includes the `kind` change like any other field, so account
  history shows when and by whom a "needs review" account was classified.

## `GET /api/accounts` / account list & detail reads

Every `AccountView` returned now includes `kind: AccountKind | null`. `null` on an Asset account
is the "needs review" state (FR-005) — callers (account list, account pickers, the new Cash Flow
Statement) treat `null` as its own visible state, never as a default kind.
