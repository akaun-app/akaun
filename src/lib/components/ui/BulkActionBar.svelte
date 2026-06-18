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
		/** Pre-formatted total, e.g. `RM 1,234.00`. */
		total: string;
		onclear: () => void;
		actions: Snippet;
	} = $props();
</script>

<div class="bulkbar" class:show>
	<div class="bulkbar-inner">
		<button class="bulk-close" onclick={onclear} aria-label="Clear selection"><X size={16} /></button>
		<span class="bulk-count"><b>{count}</b> selected</span>
		<span class="bulk-total">· <span class="num">{total}</span></span>
		<div class="bulk-actions">
			{@render actions()}
		</div>
	</div>
</div>
