# API Contract: Sessionless Reconciliation

All mutations require authentication, reconciliation RBAC, Zod validation at the route boundary,
an audit entry, and an SSE event.

- `GET /api/reconciliation?from=&to=` returns bank-facing records, statement lines, statements, and allocations. Dates filter Akaun records only.
- `GET /api/reconciliation/statements` returns derived Active/Completed statement summaries.
- `POST /api/reconciliation/statements` accepts one PDF/JPEG/PNG multipart `file`, creates the statement, and starts extraction. There is no manual statement creation.
- `GET /api/reconciliation/statements/{statementId}` returns the statement and editable extracted lines.
- `DELETE /api/reconciliation/statements/{statementId}` cascades lines and allocations.
- `PATCH /api/reconciliation/lines/{lineId}` edits date, description, amount, direction, or note.
- `DELETE /api/reconciliation/lines/{lineId}` removes the extracted line and its allocations.
- `PUT /api/reconciliation/records/{itemType}/{itemId}/allocations` accepts `{ allocations: { lineId, amount }[] }` and atomically replaces only that record's allocations.
- `GET /api/reconciliation/stream` publishes snapshot, statement, line, and allocation events.

Income may allocate only Money In. Claims and direct-paid unclaimed expenses may allocate only Money
Out. Duplicate line ids, direction mismatch, record over-allocation, and line over-allocation return
`409`. Claimed expenses are absent from the bank-facing record set and therefore return `404`.
