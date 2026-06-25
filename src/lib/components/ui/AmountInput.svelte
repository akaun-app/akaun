<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils.js';
	import { mainCurrencySymbol } from '$lib/currency-state.svelte.js';

	let {
		value = $bindable<string | number | undefined>(undefined),
		ref = $bindable<HTMLInputElement | null>(null),
		prefix = undefined,
		wrapperClass,
		wrapperStyle,
		class: className,
		...restProps
	}: HTMLInputAttributes & {
		ref?: HTMLInputElement | null;
		prefix?: string;
		wrapperClass?: string;
		wrapperStyle?: string;
	} = $props();

	// Default to the active main-currency symbol; an explicit `prefix` (e.g. a foreign
	// currency symbol on the foreign-currency row) overrides it.
	const shownPrefix = $derived(prefix ?? mainCurrencySymbol());
</script>

<div class={cn('amount-input', wrapperClass)} style={wrapperStyle}>
	<span class="amount-prefix">{shownPrefix}</span>
	<input
		bind:this={ref}
		class={cn('amount-field', className)}
		inputmode="decimal"
		bind:value
		{...restProps}
	/>
</div>
