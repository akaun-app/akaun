import { onMount } from 'svelte';

/**
 * Shared EventSource registry.
 *
 * Every streaming list page opens its stream in `onMount` and closes it in
 * `onDestroy`. Without sharing, navigating away and straight back — or having
 * the same stream open in two places — tears the connection down and
 * reconnects from scratch, which on mobile shows up as a lag before live
 * updates resume. Instead we keep one `EventSource` per URL, fan its messages
 * out to all subscribers, and hold the connection open for a short grace period
 * after the last subscriber leaves so quick back-navigation reuses it.
 *
 * Per the SSE-only architecture (see CLAUDE.md), the subscription is still tied
 * to `onMount` (browser-only) — never to `$effect`, which would resubscribe on
 * reactive dependency changes.
 */

type Subscriber = (data: unknown) => void;

type Entry = {
	es: EventSource;
	subscribers: Set<Subscriber>;
	idleTimer: ReturnType<typeof setTimeout> | null;
};

const registry = new Map<string, Entry>();

// How long to keep an idle (subscriber-less) connection open before closing it,
// so navigating away and back reuses the live stream instead of reconnecting.
const GRACE_MS = 45_000;

function subscribe(url: string, onMessage: Subscriber): () => void {
	let entry = registry.get(url);
	if (!entry) {
		const created: Entry = {
			es: new EventSource(url),
			subscribers: new Set(),
			idleTimer: null
		};
		created.es.onmessage = (e) => {
			let data: unknown;
			try {
				data = JSON.parse(e.data);
			} catch {
				return; // ignore non-JSON frames (e.g. heartbeats)
			}
			for (const fn of created.subscribers) fn(data);
		};
		created.es.onerror = () => {
			// CONNECTING (readyState 0): a transient drop; the browser is already
			// auto-reconnecting and the next event re-syncs — leave it alone.
			// CLOSED (2): fatal (e.g. session expired → 401/403); the browser will
			// NOT retry. Evict the dead connection so the next subscribe opens a
			// fresh one instead of every future subscriber reusing a dead socket.
			if (created.es.readyState !== EventSource.CLOSED) return;
			created.es.close();
			if (created.idleTimer) clearTimeout(created.idleTimer);
			// Guard against deleting a newer entry that replaced this one.
			if (registry.get(url) === created) registry.delete(url);
		};
		registry.set(url, created);
		entry = created;
	}

	// Reclaim a connection that was waiting out its grace period.
	if (entry.idleTimer) {
		clearTimeout(entry.idleTimer);
		entry.idleTimer = null;
	}
	entry.subscribers.add(onMessage);

	return () => {
		const current = registry.get(url);
		if (!current) return;
		current.subscribers.delete(onMessage);
		if (current.subscribers.size === 0 && current.idleTimer === null) {
			current.idleTimer = setTimeout(() => {
				current.es.close();
				registry.delete(url);
			}, GRACE_MS);
		}
	};
}

/**
 * Subscribe to an SSE stream for the lifetime of the component and route each
 * parsed message to `onMessage`. Connections are shared by URL across
 * components and navigations (see registry above). Call this once at component
 * init; the returned cleanup runs automatically on destroy.
 */
export function createResourceStream<T>(url: string, onMessage: (data: T) => void): void {
	onMount(() => subscribe(url, onMessage as Subscriber));
}

/**
 * Merge incoming records into a local list by `id`: update existing items in
 * place and prepend brand-new ones (so rows created in another tab appear at
 * the top). The SSE merge shared by the income / expenses / claims / contacts
 * lists.
 */
export function mergeById<T extends { id: number }>(current: T[], incoming: T[]): T[] {
	const byId = new Map(incoming.map((item) => [item.id, item]));
	const existingIds = new Set(current.map((item) => item.id));
	const updated = current.map((local) => byId.get(local.id) ?? local);
	const brandNew = incoming.filter((item) => !existingIds.has(item.id));
	return brandNew.length > 0 ? [...brandNew, ...updated] : updated;
}
