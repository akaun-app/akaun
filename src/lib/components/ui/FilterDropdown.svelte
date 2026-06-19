<script lang="ts">
	import { ChevronDown } from '@lucide/svelte';
	import type { Snippet } from 'svelte';
	import { cn, focusRingClass, focusRingOpenClass } from '$lib/utils.js';

	let {
		label,
		icon,
		active = false,
		align = 'left',
		children
	}: {
		label: string;
		icon?: Snippet;
		active?: boolean;
		align?: 'left' | 'right';
		children: Snippet;
	} = $props();

	let open = $state(false);
	let wrapper = $state<HTMLDivElement | undefined>(undefined);

	function onWindowClick(e: MouseEvent) {
		const target = e.target as Element;
		if (!wrapper || wrapper.contains(target)) return;
		// Don't close when click lands inside a portal popover (e.g. DatePicker calendar)
		if (target.closest?.('[data-slot="popover-content"]')) return;
		open = false;
	}

	function onOtherFilterOpen(e: Event) {
		if ((e as CustomEvent).detail !== wrapper) open = false;
	}

	function toggle(e: MouseEvent) {
		e.stopPropagation();
		if (!open) {
			window.dispatchEvent(new CustomEvent('filter-dropdown-open', { detail: wrapper }));
		}
		open = !open;
	}
</script>

<svelte:window onclick={onWindowClick} onfilter-dropdown-open={onOtherFilterOpen} />

<div bind:this={wrapper} style="position:relative;">
	<button
		class={cn('status-tab outline-none transition-[color,box-shadow]', focusRingClass, focusRingOpenClass)}
		data-state={open ? 'open' : 'closed'}
		class:active
		style="background:transparent; border:1px solid {open ? 'var(--ring)' : active ? 'var(--primary)' : 'var(--border)'}; color:{active ? 'var(--primary)' : 'var(--muted-foreground)'}; padding:5px 11px;"
		onclick={toggle}
	>
		{#if icon}{@render icon()}{/if}
		{label}
		<ChevronDown size={13} />
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
