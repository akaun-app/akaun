<script lang="ts">
	import * as Select from '$lib/components/ui/select/index.js';

	/**
	 * A category for an import profile: a section's fixed category, or the one
	 * a line type is pinned to (006 FR-031, FR-034). Leaving it empty is a real
	 * choice, named by `noneLabel` ("None" or "Auto"), so the list starts with
	 * it. The profile's accounts use it too (FR-058), with their own
	 * `missingLabel`.
	 *
	 * The groups are the categories the section's kind can take; the server
	 * checks the same lists when the profile is saved.
	 */
	type Choice = { id: number; code: string; name: string };

	let {
		groups,
		value,
		noneLabel,
		ariaLabel,
		disabled = false,
		missingLabel = 'Category no longer available',
		onchange
	}: {
		groups: { label: string; choices: Choice[] }[];
		value: number | null;
		noneLabel: string;
		ariaLabel: string;
		disabled?: boolean;
		/** What the select shows for a saved choice that is no longer offered. */
		missingLabel?: string;
		onchange: (value: number | null) => void;
	} = $props();

	// The select holds text; this stands for "no category".
	const NONE = 'none';

	const selected = $derived(
		value == null ? null : (groups.flatMap((group) => group.choices).find((choice) => choice.id === value) ?? null)
	);

	function label(choice: Choice): string {
		return `${choice.code} · ${choice.name}`;
	}

	function pick(next: string) {
		if (next === NONE || !next) onchange(null);
		else onchange(Number(next));
	}
</script>

<Select.Root type="single" value={value == null ? NONE : String(value)} onValueChange={pick} {disabled}>
	<Select.Trigger class="rinput w-full" aria-label={ariaLabel}>
		{#if value == null}
			{noneLabel}
		{:else if selected}
			{label(selected)}
		{:else}
			<!-- Saved before the category was archived or its kind changed. Saving
			     names the problem; the reading passes it over meanwhile. -->
			{missingLabel}
		{/if}
	</Select.Trigger>
	<Select.Content>
		<Select.Item value={NONE} label={noneLabel} />
		{#each groups as group (group.label)}
			{#if group.choices.length > 0}
				<Select.Group>
					<Select.GroupHeading>{group.label}</Select.GroupHeading>
					{#each group.choices as choice (choice.id)}
						<Select.Item value={String(choice.id)} label={label(choice)} />
					{/each}
				</Select.Group>
			{/if}
		{/each}
	</Select.Content>
</Select.Root>
