<script lang="ts">
	import { resolve } from '$app/paths';
	import { AlertTriangle, Check, ChevronRight, Files } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { describeControlTotal, describeReading } from './review-card.js';

	/**
	 * A document read as several items, as one card in the import queue
	 * (006 FR-016). It says what the document is, how it was read, where its
	 * items stand and whether they add up, and it opens the group's own page,
	 * where the items are reviewed. The whole card is that link — a real one, so
	 * it can be opened in a new tab — except Skip, which skips every item still
	 * waiting without opening the page. A button cannot sit inside an anchor, so
	 * the anchor's hit area is stretched over the card and Skip is lifted above it.
	 */
	let {
		job,
		onskip,
		busy = false,
		error = null
	}: {
		job: {
			id: string;
			originalFilename: string;
			readAs: string | null;
			readHow: string | null;
			profile?: { name: string } | null;
			extractionNotes: string | null;
			itemCounts: { ready: number; needsAttention: number; confirmed: number; skipped: number } | null;
		};
		onskip?: () => void;
		busy?: boolean;
		error?: string | null;
	} = $props();

	const counts = $derived(job.itemCounts ?? { ready: 0, needsAttention: 0, confirmed: 0, skipped: 0 });
	const total = $derived(counts.ready + counts.needsAttention + counts.confirmed + counts.skipped);
	const control = $derived(describeControlTotal(job.extractionNotes));
	// Skip acts on these only, so with none left it would do nothing.
	const waiting = $derived(counts.ready + counts.needsAttention);
</script>

<div class="review-card group-card related-link">
	<div class="group-icon"><Files size={16} /></div>
	<div class="group-main">
		<a class="group-name group-link row-link" href={resolve('/(app)/import/[id]', { id: job.id })}>{job.originalFilename}</a>
		<div class="group-sub">
			{describeReading(job)} · {total} item{total === 1 ? '' : 's'}
		</div>
		<div class="group-counts">
			<span><b>{counts.ready}</b> ready</span>
			<span class:attention={counts.needsAttention > 0}>
				<b>{counts.needsAttention}</b>
				{counts.needsAttention === 1 ? 'needs' : 'need'} attention
			</span>
			<span><b>{counts.confirmed}</b> confirmed</span>
			<span><b>{counts.skipped}</b> skipped</span>
		</div>
		{#if control}
			<span class="control-chip" class:ok={control.matches}>
				{#if control.matches}<Check size={11} strokeWidth={3} />{:else}<AlertTriangle size={11} />{/if}
				{control.text}
			</span>
		{/if}
		{#if error}
			<div class="group-error">{error}</div>
		{/if}
	</div>
	{#if onskip && waiting > 0}
		<Button
			class="group-skip"
			variant="ghost"
			size="sm"
			disabled={busy}
			title="Skip the {waiting} item{waiting === 1 ? '' : 's'} still waiting"
			onclick={onskip}
		>
			Skip
		</Button>
	{/if}
	<ChevronRight size={14} color="var(--muted-foreground)" aria-hidden="true" />
</div>

<style>
	.group-card {
		position: relative;
		display: flex;
		align-items: center;
		gap: 12px;
	}
	/* The link's hit area is the whole card; Skip is lifted above it. */
	.group-link {
		color: inherit;
		text-decoration: none;
	}
	.group-link::after {
		content: '';
		position: absolute;
		inset: 0;
	}
	.group-link:focus-visible {
		outline: none;
	}
	.group-card:has(.group-link:focus-visible) {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	.group-card :global(.group-skip) {
		position: relative;
		z-index: 1;
	}
	/* A ghost button hovers to var(--accent), which is what the card itself
	   hovers to, so on this card it would show no change. A tint of the text
	   colour reads on top of it in both themes. */
	.group-card :global(.group-skip:hover) {
		background: color-mix(in oklch, var(--foreground) 8%, transparent);
	}
	.group-icon {
		width: 30px;
		height: 30px;
		border-radius: 8px;
		background: var(--accent);
		color: var(--muted-foreground);
		display: grid;
		place-items: center;
		flex-shrink: 0;
		align-self: flex-start;
	}
	.group-main {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 4px;
	}
	.group-name {
		font-size: 13px;
		font-weight: 500;
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.group-sub {
		font-size: 12px;
		color: var(--muted-foreground);
	}
	.group-counts {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 12px;
		font-size: 12px;
		color: var(--muted-foreground);
	}
	.group-counts b {
		color: var(--foreground);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	.group-counts .attention,
	.group-counts .attention b {
		color: var(--amber);
	}
	.control-chip {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 11px;
		font-weight: 500;
		color: var(--amber);
		background: var(--amber-soft);
		padding: 2px 9px;
		border-radius: 999px;
		margin-top: 2px;
	}
	.group-error {
		font-size: 12px;
		color: var(--destructive);
	}
	.control-chip.ok {
		color: var(--green);
		background: var(--green-soft);
	}
</style>
