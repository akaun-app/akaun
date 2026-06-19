<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils.js';

	let {
		value = $bindable<string | number | undefined>(undefined),
		ref = $bindable<HTMLInputElement | null>(null),
		prefix = 'RM',
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
</script>

<div class={cn('amount-input', wrapperClass)} style={wrapperStyle}>
	<span class="amount-prefix">{prefix}</span>
	<input
		bind:this={ref}
		class={cn('amount-field', className)}
		inputmode="decimal"
		bind:value
		{...restProps}
	/>
</div>
