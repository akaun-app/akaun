<script lang="ts">
	import type { Snippet } from 'svelte';
	import { X } from '@lucide/svelte';

	let {
		show,
		count,
		total,
		onclear,
		actions
	}: {
		show: boolean;
		count: number;
		/** Pre-formatted total, e.g. `RM 1,234.00`. Omit when there's no natural sum to show. */
		total?: string;
		onclear: () => void;
		actions: Snippet;
	} = $props();
</script>

<div class="bulkbar" class:show>
	<div class="bulkbar-inner">
		<button class="bulk-close" onclick={onclear} aria-label="Clear selection"><X size={16} /></button>
		<span class="bulk-count"><b>{count}</b> selected</span>
		{#if total}<span class="bulk-total">· <span class="num">{total}</span></span>{/if}
		<div class="bulk-actions">
			{@render actions()}
		</div>
	</div>
</div>
