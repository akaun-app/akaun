# Contract: Accounts and Defaults API

All mutations retain permission checks, strict Zod validation, audit and SSE. Failures use existing
`400/403/404/409 { error, reason }` conventions.

`AccountView` contains `id,code,name,type,parentId,active,hasChildren,postingEligible,
directBalanceMinor,rolledUpBalanceMinor,path`; it contains no role.

- `GET /api/accounts?type=&includeArchived=&search=`: type/tree/code order, with ancestor context.
- `POST /api/accounts`: `{name,type,parentId?}`; server assigns code; returns 201.
- `GET /api/accounts/[id]`: returns account; merged source canonicalizes to survivor.
- `PATCH /api/accounts/[id]`: strict partial `{name,type,parentId,active}`; code is never accepted.
- `DELETE /api/accounts/[id]`: only a leaf without movements/statements/defaults/dependencies.
- `GET /api/settings/account-defaults`: six purposes, required type, account or null, validity.
- `PUT /api/settings/account-defaults`: atomically replaces all six after type/active/leaf checks.

The separate Categories page/role filters retire; Revenue and Expense use the same account contract.
