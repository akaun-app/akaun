# View Original Document From Auto Import Review Card — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a reviewer open the original uploaded PDF/image for a `pending_review` auto-import job in a new browser tab, straight from the review card.

**Architecture:** A new nested route `GET /api/import/[jobId]/file` streams the job's temp file (permission-checked, job-id-keyed — no raw path from the client), mirroring the existing `[jobId]/confirm` and `[jobId]/skip` routes. The review card's existing filename label becomes a real `<a target="_blank">` link to that endpoint, styled with the shared `related-link` hover class already used by `AttachmentManager.svelte`.

**Tech Stack:** SvelteKit (routes, `+server.ts` handlers), Drizzle ORM, `@lucide/svelte` icons, plain CSS in `src/routes/layout.css`.

## Global Constraints

- **No automated/browser testing.** Per `CLAUDE.md`'s Verification Policy, do not write Playwright tests, do not start the dev server to click through the UI, and do not add a vitest suite for this endpoint (none exists for any `+server.ts` route in this repo today). Verify via `bun run check` (svelte-check) and `bun run lint` (prettier + eslint), plus manual code reading.
- Follow the Drawer/Card conventions already in `CLAUDE.md`: a navigation to an external, non-Akaun resource uses a real `<a href>`, not a `goto()` button.
- Design reference: `docs/superpowers/specs/2026-07-01-import-review-view-document-design.md`.

---

### Task 1: Backend — `GET /api/import/[jobId]/file`

**Files:**
- Create: `src/routes/api/import/[jobId]/file/+server.ts`

**Interfaces:**
- Consumes: `db` from `$lib/server/db/client.js`, `importQueue` from `$lib/server/db/schema.js` (fields used: `id`, `tempFilePath`, `originalFilename`), `STORAGE_PATH` from `$lib/server/env.js`, `hasPermission` from `$lib/server/permissions.js`.
- Produces: `GET` handler at `/api/import/{jobId}/file` returning the raw file bytes with `Content-Type` and `Content-Disposition: inline` headers (200), or `401`/`403`/`404` `Response` with a plain-text body.

- [x] **Step 1: Write the route handler**

```ts
import type { RequestHandler } from './$types.js';
import { existsSync, readFileSync } from 'fs';
import { join, resolve, sep } from 'path';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db/client.js';
import { importQueue } from '$lib/server/db/schema.js';
import { STORAGE_PATH } from '$lib/server/env.js';
import { hasPermission } from '$lib/server/permissions.js';

const MIME: Record<string, string> = {
	pdf: 'application/pdf',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	png: 'image/png'
};

export const GET: RequestHandler = ({ locals, params }) => {
	if (!locals.user) return new Response('Unauthorized', { status: 401 });
	if (!hasPermission(locals, 'import', 'view')) return new Response('Forbidden', { status: 403 });

	const row = db.select().from(importQueue).where(eq(importQueue.id, params.jobId)).get();
	if (!row) return new Response('Not found', { status: 404 });

	const storageRoot = resolve(STORAGE_PATH);
	const abs = resolve(join(STORAGE_PATH, row.tempFilePath));
	if (!abs.startsWith(storageRoot + sep) && abs !== storageRoot) {
		return new Response('Forbidden', { status: 403 });
	}
	if (!existsSync(abs)) return new Response('Not found', { status: 404 });

	const content = new Blob([readFileSync(abs)]);
	const ext = row.tempFilePath.split('.').pop()?.toLowerCase() ?? '';
	const contentType = MIME[ext] ?? 'application/octet-stream';

	const displayFilename = row.originalFilename;
	const asciiFallback = displayFilename.replace(/[\x00-\x1f"\\]/g, '_') || 'file';
	const encoded = encodeURIComponent(displayFilename);
	const disposition = `inline; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;

	return new Response(content, {
		headers: {
			'Content-Type': contentType,
			'Content-Disposition': disposition
		}
	});
};
```

This mirrors the containment check and `Content-Disposition` handling already
used by `src/routes/api/files/[...path]/+server.ts`, but authorizes by job id
+ the `import.view` permission instead of an attachment-table lookup — no raw
filesystem path ever comes from the client.

- [x] **Step 2: Type-check and lint**

Run: `bun run check`
Expected: no new errors from `src/routes/api/import/[jobId]/file/+server.ts`.

Run: `bun run lint`
Expected: no new errors/warnings from the new file (fix any prettier
formatting diffs it reports automatically via `bunx prettier --write <file>`
if needed, then re-run).

- [x] **Step 3: Manual trace-through (static, per CLAUDE.md — no live server)**

Read back the file and confirm by inspection:
- A request with no session (`locals.user` unset) gets `401`.
- A session without `import`/`view` permission gets `403`.
- An unknown `jobId` gets `404`.
- A valid job whose temp file still exists on disk gets `200` with a
  `Content-Type` matching its extension and `Content-Disposition: inline`.
- A valid job whose file was already moved by confirm (temp path no longer
  exists) gets `404`, not a crash.

- [ ] **Step 4: Commit**

```bash
git add src/routes/api/import/\[jobId\]/file/+server.ts
git commit -m "$(cat <<'EOF'
feat(import): add endpoint to view a pending job's source file

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Frontend — filename becomes an "open in new tab" link

**Files:**
- Modify: `src/routes/(app)/import/+page.svelte:3-12` (icon import), `:547` (markup)
- Modify: `src/routes/layout.css:680` (`.review-file` rule)

**Interfaces:**
- Consumes: `GET /api/import/{jobId}/file` from Task 1; `job.id` and
  `job.originalFilename` already present on the `Job` type
  (`src/routes/(app)/import/+page.svelte:40-61`); shared `.related-link` class
  (`src/routes/layout.css:608-609`).
- Produces: no new exports — this is leaf UI.

- [x] **Step 1: Add the `ExternalLink` icon import**

In `src/routes/(app)/import/+page.svelte`, the top of the lucide import block
currently reads (lines 3-12):

```svelte
	import {
		Upload,
		Clock,
		Receipt,
		Check,
		X,
		AlertTriangle,
		RotateCcw,
		Camera
	} from '@lucide/svelte';
```

Change to:

```svelte
	import {
		Upload,
		Clock,
		Receipt,
		Check,
		X,
		AlertTriangle,
		RotateCcw,
		Camera,
		ExternalLink
	} from '@lucide/svelte';
```

- [x] **Step 2: Turn the filename label into a link**

Still in `src/routes/(app)/import/+page.svelte`, find (around line 547):

```svelte
								<div class="review-file"><Receipt size={15} /> {job.originalFilename}</div>
```

Replace with:

```svelte
								<a
									href="/api/import/{job.id}/file"
									target="_blank"
									rel="noopener"
									class="review-file related-link"
									aria-label="Open {job.originalFilename}"
								>
									<Receipt size={15} />
									{job.originalFilename}
									<ExternalLink size={11} color="var(--muted-foreground)" />
								</a>
```

- [x] **Step 3: Update `.review-file` CSS for the anchor + hover hit box**

In `src/routes/layout.css`, find (line 680):

```css
.review-file { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 500; color: var(--foreground); }
```

Replace with:

```css
.review-file { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 500; color: var(--foreground); text-decoration: none; border: 1px solid transparent; border-radius: 7px; padding: 3px 7px; margin: -3px -7px; }
```

The transparent border means `.related-link:hover`'s
`border-color: var(--primary)` swap doesn't shift layout; the matching
negative margin keeps the visible text flush with `.review-detected` and
`.review-grid` below it (same trick already used by `.review-detected` two
lines down in this file).

- [x] **Step 4: Type-check and lint**

Run: `bun run check`
Expected: no new errors (in particular, no "possibly null" complaints about
`job.id`/`job.originalFilename` — both are typed as required fields on
`Job`).

Run: `bun run lint`
Expected: clean; if prettier reformats the new markup, accept its formatting
and re-run to confirm.

- [x] **Step 5: Manual trace-through (static, per CLAUDE.md — no live server)**

Read the rendered markup/CSS back and confirm:
- The card header's flex layout (`review-head { justify-content:
  space-between }`) still places the filename link on the left and the
  duplicate badge / Expense-Income toggle on the right, matching the
  approved mockup.
- The link's `href` interpolates `job.id` (the queue row's UUID `id` field,
  not `originalFilename`) — this must match the `params.jobId` the Task 1
  route reads.
- No other review-card row (Pipeline, Failed, History) was touched — this
  link only appears in the `pending_review` list, per the design's "out of
  scope" note.

- [ ] **Step 6: Commit**

```bash
git add "src/routes/(app)/import/+page.svelte" src/routes/layout.css
git commit -m "$(cat <<'EOF'
feat(import): open source document from pending-review card

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```
