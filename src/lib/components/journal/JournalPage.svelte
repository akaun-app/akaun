<script lang="ts">
	import { onMount } from 'svelte';
	import { goto, pushState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { BookOpen, ChevronRight, Plus } from '@lucide/svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { useIsMobile } from '$lib/hooks/useIsMobile.svelte.js';
	import { createResourceStream, mergeById } from '$lib/sse.js';
	import { formatDate, formatMinor } from '$lib/format.js';
	import JournalSheet from './JournalSheet.svelte';
	import type { RecordView } from '$lib/server/ledger/types.js';
	import type { loadJournalPage } from '$lib/server/loaders/journal.js';

	/**
	 * The direct-entry screen: records whose two — or more — sides were typed in
	 * by hand rather than worked out from an everyday screen.
	 *
	 * It belongs to no user story and no seeded group has the permission for it
	 * (FR-040), so anyone reading this page has been given it deliberately. It is
	 * still not an accountant's console: a side says "money in" or "money out" of
	 * an account, and the running difference is shown in the words the save would
	 * refuse with, so the balance rule is watched rather than discovered.
	 *
	 * As well as writing, it reads: every entry made this way is listed, because
	 * a hand-made entry is exactly the kind anyone later will want to find.
	 */
	type PageData = ReturnType<typeof loadJournalPage>;

	let { data, openId }: { data: PageData; openId: number | null } = $props();

	const screen = useIsMobile();
	const isMobile = $derived(screen.current);

	// SSR supplies the list; the stream carries incremental updates only, with no
	// snapshot on connect (contracts/events.md). Nothing is added optimistically
	// from a save — the event is the sole driver, which is what removes the race
	// between the fetch response and the event arriving on the same connection.
	// Writable `$derived`, so a fresh server load replaces the list and an
	// incoming event can still merge into it.
	let records = $derived(data.records);

	/** Everything that moved through entries made by hand. */
	const totalMinor = $derived(records.reduce((sum, r) => sum + r.amountMinor, 0));

	// --- Sheet --------------------------------------------------------------
	let sheetOpen = $state(false);
	let viewing = $state<RecordView | null>(null);

	function openCreate() {
		viewing = null;
		sheetOpen = true;
	}

	function openDetail(record: RecordView, { push = true } = {}) {
		viewing = record;
		sheetOpen = true;
		if (push) {
			pushState(resolve('/(app)/journal/[id]', { id: String(record.id) }), { viaPush: true });
		}
	}

	function closeDetail() {
		const wasExisting = viewing !== null;
		sheetOpen = false;
		viewing = null;
		if (!wasExisting) return;
		if (page.state.viaPush) {
			history.back();
		} else {
			goto(resolve('/journal'), { replaceState: true, noScroll: true });
		}
	}

	onMount(() => {
		if (openId) {
			const found = records.find((r) => r.id === openId);
			if (found) openDetail(found, { push: false });
		}
	});

	// --- Live updates -------------------------------------------------------
	type JournalStreamMsg =
		| { type: 'record-update'; record: RecordView }
		| { type: 'record-deleted'; id: number };

	createResourceStream<JournalStreamMsg>('/api/journal/stream', (msg) => {
		if (msg.type === 'record-update') {
			records = mergeById(records, [msg.record]);
		} else if (msg.type === 'record-deleted') {
			records = records.filter((r) => r.id !== msg.id);
			// The drawer is showing something that no longer exists.
			if (viewing?.id === msg.id) closeDetail();
		}
	});
</script>

<div class="screen">
	<header class="topbar">
		<div class="topbar-left">
			<h1 class="page-title">Journal</h1>
			<p class="page-sub">
				{records.length}
				{records.length === 1 ? 'entry' : 'entries'} typed in by hand · {formatMinor(totalMinor)}
				moved
			</p>
		</div>
		<div class="topbar-right">
			{#if data.perms.add}
				<button type="button" class="sheet-btn sheet-btn-primary" onclick={openCreate}>
					<Plus size={14} /> New entry
				</button>
			{/if}
		</div>
	</header>

	<div class="content">
		<div class="content-inner">
			{#if records.length === 0}
				<EmptyState
					title="Nothing entered by hand yet"
					sub="Here you name both sides of a record yourself — where the money came from, and where it went. Everything else is better recorded from its own screen."
				>
					{#snippet icon()}<BookOpen size={20} />{/snippet}
					{#snippet action()}
						{#if data.perms.add}
							<button class="link-btn" onclick={openCreate}>Make the first entry</button>
						{/if}
					{/snippet}
				</EmptyState>
			{:else}
				<div class="table-card">
					{#each records as record (record.id)}
						<button
							type="button"
							class="jrn-row related-link"
							class:stacked={isMobile}
							onclick={() => openDetail(record)}
						>
							<span class="jrn-date">{formatDate(record.date)}</span>
							<span class="jrn-main">
								<span class="jrn-desc">{record.description || 'No description'}</span>
								<span class="jrn-sub">
									{record.movements.length} sides
									{#if record.contactName}· {record.contactName}{/if}
								</span>
							</span>
							<span class="jrn-amount">{formatMinor(record.amountMinor)}</span>
							<ChevronRight size={14} color="var(--muted-foreground)" />
						</button>
					{/each}
				</div>

				{#if data.total > records.length}
					<p class="more-note">
						Showing the {records.length} most recent of {data.total}.
					</p>
				{/if}
			{/if}
		</div>
	</div>
</div>

<JournalSheet
	bind:open={sheetOpen}
	record={viewing}
	accounts={data.accounts}
	contacts={data.contacts}
	canAdd={data.perms.add}
	canDelete={data.perms.delete}
	onclose={closeDetail}
	onsaved={closeDetail}
	ondeleted={closeDetail}
/>

<style>
	.jrn-row {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
		padding: 12px 14px;
		background: var(--card);
		border: none;
		border-bottom: 1px solid var(--border);
		font-family: inherit;
		text-align: left;
	}
	.jrn-row:last-child {
		border-bottom: none;
	}
	.jrn-date {
		width: 92px;
		flex: 0 0 auto;
		font-size: 12.5px;
		color: var(--muted-foreground);
		font-variant-numeric: tabular-nums;
	}
	.jrn-main {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
		flex: 1;
	}
	.jrn-desc {
		font-size: 13.5px;
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.jrn-sub {
		font-size: 11.5px;
		color: var(--muted-foreground);
	}
	.jrn-amount {
		font-size: 13.5px;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.more-note {
		font-size: 12px;
		color: var(--muted-foreground);
		margin: 12px 0 0;
	}

	/* One column below the mobile breakpoint (FR-043): the date drops under the
	   description rather than squeezing it. */
	.jrn-row.stacked {
		flex-wrap: wrap;
	}
	.jrn-row.stacked .jrn-date {
		order: 2;
		width: auto;
		flex-basis: 100%;
	}
</style>
