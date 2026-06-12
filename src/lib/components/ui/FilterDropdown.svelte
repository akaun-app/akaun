<script lang="ts">
	import { ChevronDown } from '@lucide/svelte';
	import type { Snippet } from 'svelte';

	let {
		label,
		icon,
		active = false,
		count = 0,
		align = 'left',
		children
	}: {
		label: string;
		icon?: Snippet;
		active?: boolean;
		count?: number;
		align?: 'left' | 'right';
		children: Snippet;
	} = $props();

	let open = $state(false);
	let wrapper = $state<HTMLDivElement | undefined>(undefined);

	function onWindowClick(e: MouseEvent) {
		if (wrapper && !wrapper.contains(e.target as Node)) open = false;
	}
</script>

<svelte:window onclick={onWindowClick} />

<div bind:this={wrapper} style="position:relative;">
	<button
		class="status-tab"
		class:active
		style="background:transparent; border:1px solid {active ? 'var(--primary)' : 'var(--border)'}; color:{active ? 'var(--primary)' : 'var(--muted-foreground)'}; padding:5px 11px;"
		onclick={(e) => { e.stopPropagation(); open = !open; }}
	>
		{#if icon}{@render icon()}{/if}
		{label}
		{#if count > 0}
			<span class="filter-count">{count}</span>
		{:else}
			<ChevronDown size={13} />
		{/if}
	</button>
	{#if open}
		<div
			style="position:absolute; top:calc(100% + 6px); {align === 'right' ? 'right:0' : 'left:0'}; background:var(--popover); border:1px solid var(--border); border-radius:10px; box-shadow:var(--shadow-lg); z-index:50; min-width:200px;"
			onclick={(e) => e.stopPropagation()}
			role="presentation"
		>
			{@render children()}
		</div>
	{/if}
</div>
