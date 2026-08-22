# Contract: Account Live Events

`GET /api/accounts/stream` remains the sole authenticated account SSE stream.

| Event | Payload | Action |
|---|---|---|
| `account-update` | `{account: AccountView}` | Upsert and recalculate visible tree |
| `account-deleted` | `{id,canonicalId?}` | Remove or replace retired identity |
| `accounts-refresh` | `{reason: hierarchy|defaults|migration}` | Refetch multi-row paths/totals |

No polling and no partial migration events. Hierarchy/type changes emit update plus refresh; one
migration refresh occurs only after commit.
