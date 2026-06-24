# Akaun Web — Claude Code Notes

## Verification Policy

Do not attempt automated browser/UI testing or live verification (no Playwright, no logging into the dev server, no scraping `.env` for credentials to drive a session). Verify changes via static code analysis only: read the diff, check types/lint (`bun run check`, `bun run lint`), and reason about correctness from the code. Leave visual/behavioral confirmation to the user.

## Architecture Decisions

### Real-Time Updates: SSE-Only

All features that need live UI updates must use **Server-Sent Events (SSE)**, not polling.

**Pattern:**
- Create a `GET` endpoint at `src/routes/api/<feature>/stream/+server.ts` that returns a `ReadableStream` with `Content-Type: text/event-stream`
- Use the singleton `importEvents` EventEmitter pattern (`src/lib/server/import/events.ts`) — create a parallel `<feature>Events` emitter for each domain
- Every server action (POST, PATCH, DELETE) that mutates state must call `events.emit(...)` after the DB write so all connected clients see the change
- On the client, open the EventSource in `onMount` and close it in `onDestroy` — never in `$effect` (which re-runs on reactive dependency changes and would tear down the connection)

**Client merge pattern** (`mergeServerJobs` in the import page is the reference implementation):
- On connect, the stream sends a full snapshot of current state
- Subsequent events are incremental updates (`item-update`, `item-deleted`, etc.)
- `mergeServerJobs`-style merge: update existing items, prepend brand-new items from other tabs
- Do **not** add items to local `$state` optimistically from the upload/create action — let the SSE event be the sole driver. This eliminates race conditions between the fetch response and the SSE event arriving on the same connection.
- Do **not** store non-plain objects (e.g. `File`, `Blob`) in Svelte 5 `$state` — keep them in a plain `Map` alongside the reactive array

**Snapshot vs. no-snapshot:**
- Import queue (small, finite set of active jobs): send a full snapshot on connect so reconnects catch up automatically.
- Paginated lists (income, expenses, claims): **no snapshot**. SSR provides the initial state; SSE provides incremental updates only. If the connection drops briefly, `EventSource` auto-reconnects and the next event re-syncs the affected item. A full page reload re-fetches the correct state.

**Why not polling?**
Polling was considered and rejected. SSE gives instant updates, no wasted requests, and simpler client code once the pattern is established.

### Drawer / Detail Sheet Standard

Every record-detail and create/edit drawer (claims, contacts, expenses, income, etc.) is built on the shared `Sheet` primitive (`$lib/components/ui/sheet`, a bits-ui `Dialog` wrapper) and must follow this shape. The goal is that a user can't tell which feature they're in from the drawer chrome alone.

**Shell**
- Desktop: slides in from the right, `width: 500px; max-width: 95vw`.
- Always include `gap:0;` in the `Sheet.Content` inline `style=`. The base `sheet-content.svelte` ships a Tailwind `gap-4` (16px) flex gap between its children; since header/body/footer already control their own spacing via padding, the extra flex gap just adds unwanted dead space above the hero amount/first field.
- Mobile: slides up from the bottom (`panelSide = isMobile ? 'bottom' : 'right'`).
  - Full-view sheets (record detail/edit, `height: 100dvh`) get **square** corners — they cover the whole viewport so a radius reads as a bug, not a feature.
  - Partial-height sheets (e.g. filter panels) keep **rounded** top corners (`16px 16px 0 0`).

**Header** (`padding: 22px 22px 16px`, border-bottom)
- Left: `.sheet-eyebrow` (small muted label/icon) + `.sheet-title-text`.
- Right: **only** the close button (`Sheet.Close` with class `sheet-close` + `X` icon, size 16). Never put a dropdown menu, status badge, or any other action here — those belong in the body or footer.

**Body** (`padding: 20px 22px`, scrollable, `flex: 1`)
- Hero amount (`.detail-amount`) for records with a monetary value.
- A true lifecycle status renders via `StatusBadge.svelte` inside `.detail-statusrow`, directly under the hero amount — never in the header.
- Forms use the existing `.field` / `.field-label` conventions.

**Footer** (`.sheet-foot`, defined once in `layout.css` — don't redeclare it per page)
- Sticky: lives *outside* the scrollable body, not inside it. For forms, this means the `<form>` itself is the flex column (`flex:1; display:flex; flex-direction:column; overflow:hidden;`) with a scrollable fields div and a non-scrolling `.sheet-foot` as siblings inside it — see `contacts/+page.svelte` for the reference implementation.
- Optional `.sheet-foot-note` (muted, 12px) above the action row for contextual info.
- `.sheet-foot-actions`: flex row, `gap: 8px`, right-aligned, using the shared button classes from `layout.css`:
  - `.sheet-btn` — base neutral outline button.
  - `.sheet-btn-delete` — `.sheet-btn` + icon gap; always `Trash2` (size 14) + "Delete" label, leftmost action (use `margin-right:auto` to pin it to the far left when Cancel/Save also exist). Add `disabled` + a `title` tooltip when deletion is blocked by a relationship (linked claim, in-use contact, etc.) — don't silently hide the button.
  - `.sheet-btn-primary` — filled primary button (Save / Mark as claimed / etc.), rightmost.
- Delete always routes through the shared `ConfirmDialog.svelte` (`danger` prop) + a hidden `<form method="POST" action="?/delete">` submitted via `requestSubmit()`. Never a header dropdown/kebab menu.

**Status chips**
- Any true lifecycle status (claim pending/claimed, expense unpaid/pending/paid, income received) goes through `StatusBadge.svelte` — don't hand-roll an inline `<span class="statusbadge ...">`. Add new tones/labels to its `byLabel`/`byCode` maps rather than duplicating the markup.
- Role badges (contacts) are a different concept — not a lifecycle status — and intentionally keep their own pill style using `var(--secondary)`. This is a deliberate exception, not a gap to "fix".

### Cross-Feature Relation Cards

Whenever a record-detail sheet shows a reference to a *different* record (e.g. an expense's linked claim, a claim's linked expenses), the card/row must follow one of the two shapes below, and **both shapes share the same interaction contract**. The goal: a user shouldn't see two different "this points at another record" affordances that behave differently.

**Two shapes, same contract**
- **Single-record reference** (this record points at exactly one other record) — icon box (`34×34`, radius 7, `background: var(--accent)`) + title/status + muted subline + trailing chevron. Reference: `.linked-claim-card` in `expenses/+page.svelte`.
- **List-of-many** (this record has many of another type linked to it) — compact row, no icon box, primary text + muted subline on the left, optional `StatusBadge`/amount, trailing chevron. Reference: `.claim-exp` in `claims/+page.svelte`.

**Interaction contract (applies to both shapes)**
- If the card/row has exactly **one** action (navigate to the related record), the whole element is a `<button type="button">`, not a wrapped `<div>` with an inner link.
- Add the shared `related-link` class (defined once in `layout.css`) alongside the layout class — it provides `cursor: pointer` and the hover treatment (`border-color: var(--primary); background: var(--accent);`). Don't redeclare this hover rule per feature.
- End with a trailing `ChevronRight` (size 13–14, `color: var(--muted-foreground)`) as a static "this is clickable" affordance hint, visible even without hovering.
- Navigate via the deep-link pattern below — never inline-render the other feature's detail sheet.

**Multi-action rows still share the `related-link` hover**
- A row with more than one independent action (e.g. `AttachmentManager`'s `.attach-item`: open file, delete) still gets the shared `related-link` class for visual consistency with single-action relation cards — same `border-color`/`background` hover on the row.
- Don't duplicate the hover on the inner action elements too — the row hover already signals interactivity. Only the action that has a *different* effect than "this row relates to something" — e.g. the delete button's destructive hover — keeps its own distinct hover.
- **Exception to the `<button onclick={goto(...)}>` rule above**: when the primary action navigates to a real URL outside the app (e.g. opening an uploaded file, not another Akaun record), use a real `<a href>` instead of a `goto()` button, so native browser behaviors work — right-click context menu, Ctrl/Cmd-click to open in a new tab, middle-click. Wrap everything except the other action(s) in the anchor (see `.attach-link-area` in `AttachmentManager.svelte`); a `<button>` can't nest inside `<a>`, so sibling actions like delete stay outside it as their own click targets. The `goto()`-button pattern is reserved for in-app SPA navigation, where there's no real href to give native semantics to anyway.

**Deep-link pattern (every record is a shareable URL)**

Every record detail (expenses, income, contacts, claims) is reachable at a real path, `/<feature>/[id]`, so a user can copy the URL while a sheet is open and send it to someone else. The Sheet stays the only visual treatment — there is no separate full-page detail view — this is achieved with SvelteKit shallow routing (`pushState`/`history.back()`), not a second route paradigm.

- Each feature has a shared page component (`$lib/components/<feature>/<Feature>Page.svelte`) rendered by **two** thin routes: `/<feature>/+page.svelte` (passes `openId={null}`) and `/<feature>/[id]/+page.svelte` (passes `openId={data.open<Feature>Id}`). Both routes' `+page.server.ts` call one shared loader (`$lib/server/loaders/<feature>.ts`) so actions/load logic live in one place.
- The shared loader redirects to the bare list (`/<feature>`) if `openId` doesn't match a loaded record (deleted, bad id, no access to that specific record).
- In-app, clicking a row calls the page's open-detail function, which sets the local `$state` record **and** calls `pushState(resolve('/(app)/<feature>/[id]', { id: String(id) }), { viaPush: true })` — this updates the URL live without a real navigation, so SSE connections and scroll position are preserved.
- Closing (X / overlay / Escape, all routed through `Sheet.Root`'s `onOpenChange`) calls a `closeDetail()` that checks `page.state.viaPush` (from `$app/state`): if true, `history.back()` (unwinds to the list URL we pushed from, and gives the browser/mobile back button this behavior for free); if false (arrived via a pasted link or page refresh, no useful history entry), `goto(resolve('/<feature>'), { replaceState: true })`.
- On mount, if `openId` was passed in (a real navigation to `/<feature>/[id]`, not an in-app click), the open-detail function is called with `{ push: false }` since the URL is already correct.
- Cross-feature navigation buttons (e.g. an expense's linked-claim card) call `goto(resolve('/(app)/<feature>/[id]', { id: String(targetId) }))` directly — no query strings.
- Reference implementations: `openExpense`/`closeDetail` in `ExpensesPage.svelte`, `openDetail`/`closeDetail` in `ClaimsPage.svelte`. Contacts is a variant — `/contacts/[id]` opens the existing shared edit form directly (`openEdit(c, { push: false })`); only editing an *existing* contact gets a URL, "Add contact" does not. Copy this pattern verbatim for any new feature that needs a detail sheet.
