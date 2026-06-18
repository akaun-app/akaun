<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		icon,
		title,
		sub,
		action,
		style
	}: {
		/** Optional icon, rendered inside the rounded badge. */
		icon?: Snippet;
		title: string;
		sub?: string;
		/** Optional call-to-action (e.g. a "Clear filters" button), rendered below the text. */
		action?: Snippet;
		/** Optional inline style override, e.g. for compact padding (`padding:20px;`). */
		style?: string;
	} = $props();
</script>

<div class="empty" {style}>
	{#if icon}<div class="empty-icon">{@render icon()}</div>{/if}
	<div class="empty-title">{title}</div>
	{#if sub}<div class="empty-sub">{sub}</div>{/if}
	{#if action}{@render action()}{/if}
</div>

<style>
	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 8px;
		padding: 56px 20px;
		text-align: center;
	}
	.empty-icon {
		width: 46px;
		height: 46px;
		border-radius: 12px;
		background: var(--accent);
		display: grid;
		place-items: center;
		color: var(--muted-foreground);
	}
	.empty-title {
		font-weight: 500;
	}
	.empty-sub {
		font-size: 13px;
		color: var(--muted-foreground);
	}
</style>
