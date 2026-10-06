<script lang="ts">
	import * as Select from '$lib/components/ui/select/index.js';

	/**
	 * One choice of an import profile's table layout or row rules (006 FR-053,
	 * FR-054): a column, named by one of the layout's headings, or a fixed
	 * option such as a date format. With `noneLabel` the choice may be left
	 * empty, and the list starts with that.
	 *
	 * A value that is not among the options any more (a heading removed since
	 * it was chosen) is still shown, so the user sees what is saved; the shared
	 * check names the problem.
	 */
	let {
		options,
		value,
		noneLabel = null,
		placeholder = 'Choose',
		ariaLabel,
		disabled = false,
		onchange
	}: {
		options: { value: string; label: string }[];
		value: string;
		noneLabel?: string | null;
		placeholder?: string;
		ariaLabel: string;
		disabled?: boolean;
		onchange: (value: string) => void;
	} = $props();

	// The select holds text; this stands for "none".
	const NONE = '\u0000none';

	const shown = $derived(options.find((option) => option.value === value)?.label ?? value);
</script>

<Select.Root
	type="single"
	value={value === '' ? (noneLabel === null ? '' : NONE) : value}
	onValueChange={(next) => onchange(next === NONE ? '' : next)}
	{disabled}
>
	<Select.Trigger class="rinput w-full" aria-label={ariaLabel}>
		{#if value === ''}
			<span class:pf-placeholder={noneLabel === null}>{noneLabel ?? placeholder}</span>
		{:else}
			{shown}
		{/if}
	</Select.Trigger>
	<Select.Content>
		{#if noneLabel !== null}
			<Select.Item value={NONE} label={noneLabel} />
		{/if}
		{#each options as option (option.value)}
			<Select.Item value={option.value} label={option.label} />
		{/each}
	</Select.Content>
</Select.Root>

<style>
	.pf-placeholder {
		color: var(--muted-foreground);
	}
</style>
