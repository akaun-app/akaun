# View original document from the Auto Import "pending review" card

## Problem

While a job sits in `pending_review` on `/import`, the reviewer sees AI-extracted
fields (item, supplier, amount, date, etc.) but has no way to see the actual
receipt/invoice file to check the AI got it right. The uploaded file exists on
disk (`importQueue.tempFilePath`) but nothing in the UI links to it.

## Why the existing file route doesn't work

`GET /api/files/[...path]` (used by `AttachmentManager.svelte` to open
confirmed attachments) authorizes a request by checking that the requested
path is registered in `expenseAttachments`, `incomeAttachments`, or
`claimAttachments`. A job's temp file isn't inserted into any of those tables
until *after* confirm (see `confirm/+server.ts`), so this route would 403 for
a still-pending job. It shouldn't be loosened to trust arbitrary
`import_queue.temp_file_path` values passed as a raw path param — that's a
wider trust surface than necessary.

## Design

### Backend: `GET /api/import/[jobId]/file`

New route, sibling to the existing `[jobId]/confirm` and `[jobId]/skip`
routes:

- Require `locals.user` and `hasPermission(locals, 'import', 'view')` (same
  check as the job-list `GET /api/import`).
- Look up the job by `params.jobId`; 404 if missing.
- Resolve `row.tempFilePath` under `STORAGE_PATH` (reuse the existing
  containment check from `api/files/[...path]/+server.ts`); read the file,
  404 if it's gone (e.g. already moved by confirm).
- Respond with the same `Content-Type` (by extension) / `Content-Disposition:
  inline` handling as `api/files/[...path]/+server.ts`, so it opens in the
  browser's native PDF/image viewer instead of downloading.
- Authorization is by job id + permission only — no raw filesystem path is
  ever accepted from the client, so this doesn't reopen the traversal
  question `api/files` has to guard against.

This only serves files that are still in temp storage (i.e. useful for any
non-terminal job state), but the UI only ever links to it for
`pending_review` cards.

### Frontend: `review-file` becomes a link

In `src/routes/(app)/import/+page.svelte`, the existing card-header label:

```svelte
<div class="review-file"><Receipt size={15} /> {job.originalFilename}</div>
```

becomes:

```svelte
<a
  href="/api/import/{job.id}/file"
  target="_blank"
  rel="noopener"
  class="review-file related-link"
  aria-label="Open {job.originalFilename}"
>
  <Receipt size={15} /> {job.originalFilename} <ExternalLink size={11} />
</a>
```

- A real `<a href>` (not a `goto()` button), per the CLAUDE.md exception for
  links that leave the app to an external resource — preserves right-click /
  ctrl-click / middle-click.
- `related-link` (shared hover class, already used by `AttachmentManager`'s
  `.attach-item`) needs `.review-file` to have a real (possibly transparent)
  border so hover doesn't shift layout — add `border: 1px solid transparent;
  border-radius: 7px; padding: 3px 7px; margin: -3px -7px;` to `.review-file`
  in `layout.css` so the hit box grows without disturbing `.review-head`'s
  flex layout. Also add `color: inherit; text-decoration: none;` since it's
  now an anchor.
- Trailing `ExternalLink` (lucide, size 11) after the filename as a static
  "this opens something" hint, muted-foreground colored — same idea as the
  trailing chevron on relation cards, adapted for "leaves the app" instead of
  "navigates in-app."

### Out of scope

- No change to `/api/files/[...path]` or the attachment tables.
- No inline preview/thumbnail — just opens in a new tab, per the request.
- Not adding this to the Pipeline/Failed/History rows — only `pending_review`
  cards show the AI-extracted fields a reviewer would want to check against
  the source file.
