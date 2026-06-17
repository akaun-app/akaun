import { onMount, onDestroy } from 'svelte';

/**
 * Opens an EventSource for the lifetime of the component and routes each parsed
 * message to `onMessage`. Encapsulates the onMount-open / onDestroy-close
 * lifecycle every streaming list page repeats.
 *
 * Per the SSE-only architecture (see CLAUDE.md), the connection is opened in
 * `onMount` and closed in `onDestroy` — never in `$effect`, which would tear it
 * down on reactive dependency changes. Call this once at component init.
 */
export function createResourceStream<T>(url: string, onMessage: (data: T) => void): void {
	let es: EventSource | null = null;
	onMount(() => {
		es = new EventSource(url);
		es.onmessage = (e) => onMessage(JSON.parse(e.data) as T);
	});
	onDestroy(() => es?.close());
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
