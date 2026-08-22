# Contract: Account "sub-type" on the Accounts API

Extends the existing endpoints — no new routes. Both already: check
`hasPermission(locals, 'accounts', 'add' | 'change')`, validate with a Zod schema, call
`recordAudit`, and emit on `accountEvents` after the write (all unchanged, per Principle IV/VI).

## `POST /api/accounts`

Existing schema (`routes/api/accounts/+server.ts`): `{ type, name, parentId }`.

**Change**: add `subType`.

```
{
  type: AccountType
  name: string
  parentId?: number
  subType?: AccountSubType  // required by the service layer when type === Asset; rejected (400) if present for any other type
}
```

- `type === Asset` and `subType` missing → `400`, same shape as other required-field validation
  errors today.
- `type === Asset` and `subType === Equipment` → `400`. Equipment is never set through this
  endpoint (Research §4); it continues to be set wherever the existing record-form/category path
  already sets it.
- `type !== Asset` and `subType` present → `400` (`.strict()` schema rejects the
  unknown-for-this-type field, same pattern as `role` being absent from the patch schema today).

## `PATCH /api/accounts/[id]`

Existing schema (`routes/api/accounts/[id]/+server.ts`): `{ name?, type?, parentId?, active? }`
(`.strict()`).

**Change**: add `subType?: AccountSubType`.

- Allowed only when the account is otherwise editable — same 403/409 behavior the endpoint already
  returns for a locked/system account, reused rather than duplicated (Research §3). No new
  movement-count check is added for a `subType`-only patch, even though one already exists and is
  enforced for a `type` patch.
- Same two rejections as `POST` above: `subType === Equipment` and `subType` on a non-Asset
  account are both `400`.
- The audit diff (`recordAudit`) includes the `subType` change like any other field, so account
  history shows when and by whom a "needs review" account was classified.

## `GET /api/accounts` / account list & detail reads

Every `AccountView` returned now includes `subType: AccountSubType | null`. `null` on an Asset
account is the "needs review" state (FR-005) — callers (account list, account pickers, the new
Cash Flow Statement) treat `null` as its own visible state, never as a default sub-type.
