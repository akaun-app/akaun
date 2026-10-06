<script lang="ts">
	import { Plus } from '@lucide/svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import { Input } from '$lib/components/ui/input/index.js';
	import ProfileColumnSelect from './ProfileColumnSelect.svelte';
	import { readsFromTable, type ProfileForm } from '$lib/import-profile-form.js';
	import {
		applySorting,
		columnRole,
		sectionForValue,
		sortColumnFor,
		sortingOf,
		type SampleInspection
	} from '$lib/import-profile-sample.js';

	/**
	 * Which of the table's rows each section takes, said the way the user
	 * thinks of it (006 FR-054): pick a column, such as "Transaction Type", and
	 * send each of its values to a section, or leave it out. It writes the
	 * sections' row rules (`applySorting`), so a profile saved from here is the
	 * same as one whose conditions were built by hand.
	 *
	 * Rules of another shape (two conditions, "is not", "contains") are left as
	 * they are: each section shows its own under More.
	 */
	let {
		form = $bindable(),
		splitting = $bindable(false),
		sample,
		headings,
		canChange,
		oncustomclear
	}: {
		form: ProfileForm;
		/** True once the user splits the rows by a column, before any value is given out. */
		splitting?: boolean;
		sample: SampleInspection | null;
		headings: string[];
		canChange: boolean;
		/** Clears every table section's rules, to sort by a column instead. */
		oncustomclear: () => void;
	} = $props();

	const NEW = '\u0000new';

	// Split: the user asked, or a value already has a section, or there is more
	// than one table section.
	const split = $derived(
		splitting || (sortingOf(form)?.assignments.size ?? 0) > 0 || form.sections.filter((s) => readsFromTable(form, s)).length > 1
	);

	/** Back to one section for every row: the sorting is cleared. */
	function oneSectionForAll() {
		splitting = false;
		picked = '';
		added = [];
		applySorting(form, { column: '', assignments: new SvelteMap() });
	}

	const sorting = $derived(sortingOf(form));
	const tableSections = $derived(form.sections.filter((section) => readsFromTable(form, section)));

	// The column: the one the rules use, else the user's pick, else the guess.
	let picked = $state('');
	const column = $derived(
		sorting?.column ||
			picked ||
			(sample && form.layout ? (sortColumnFor(sample, form.layout) ?? '') : '')
	);
	const sampleValues = $derived(
		sample?.columns.find((c) => c.heading === column)?.distinct ?? null
	);

	// Values typed in by hand, for a column the sample does not list (or with
	// no sample loaded), kept until they are given a section.
	let added = $state<string[]>([]);
	let draft = $state('');

	const values = $derived.by(() => {
		const out: { value: string; count: number | null }[] = (sampleValues ?? []).map((v) => ({
			value: v.value,
			count: v.count
		}));
		for (const value of [...(sorting?.assignments.keys() ?? []), ...added]) {
			if (!out.some((v) => v.value === value)) {
				out.push({ value, count: sample && sampleValues ? 0 : null });
			}
		}
		return out;
	});

	const sectionOptions = $derived([
		...tableSections.map((section, index) => ({
			value: section.uid,
			label: section.name.trim() || `Section ${form.sections.indexOf(section) + 1 || index + 1}`
		})),
		{ value: NEW, label: 'New section' }
	]);

	const columnOptions = $derived(
		headings
			.filter((heading) => heading === column || columnRole(form.layout!, heading) === 'none')
			.map((heading) => ({ value: heading, label: heading }))
	);

	function assign(value: string, target: string) {
		if (!sorting) return;
		const assignments = new SvelteMap(sorting.assignments);
		if (target === '') {
			assignments.delete(value);
		} else if (target === NEW) {
			const section = sectionForValue(value);
			form.sections = [...form.sections, section];
			assignments.set(value, section.uid);
		} else {
			assignments.set(value, target);
		}
		applySorting(form, { column, assignments });
		added = added.filter((entry) => entry !== value);
	}

	function chooseColumn(next: string) {
		picked = next;
		added = [];
		// The values belong to the old column, so nothing is assigned now.
		applySorting(form, { column: next, assignments: new SvelteMap() });
	}

	function addValue() {
		const value = draft.trim();
		if (!value) return;
		if (!values.some((v) => v.value === value)) added = [...added, value];
		draft = '';
	}

	// A table section given no value takes every row of the table.
	// Said once any value is given out: before that, every section does.
	const takesAll = $derived(
		sorting && column && sorting.assignments.size > 0
			? tableSections.filter((section) => ![...sorting.assignments.values()].includes(section.uid))
			: []
	);
	const leftOut = $derived(
		sorting ? values.filter((v) => !sorting.assignments.has(v.value) && (v.count ?? 1) > 0) : []
	);
</script>

<section class="detail-card">
	{#if sorting && !split}
		<div class="rs-one">
			<p class="field-hint" style="margin:0;">All rows go to one section. Set its kind and category below.</p>
			{#if canChange}
				<button type="button" class="sheet-btn" onclick={() => (splitting = true)}>Split rows by a column</button>
			{/if}
		</div>
	{:else if !sorting}
		<p class="field-hint" style="margin-top:0;">
			Each section has its own row rules. The rules are in More, in each section.
		</p>
		{#if canChange}
			<button type="button" class="sheet-btn" onclick={oncustomclear}>Use one column for all sections</button>
		{/if}
	{:else}
		<div class="rs-split-head">
			<span class="field-hint" style="margin:0;">Each value of the column goes to a section, or is ignored.</span>
			{#if canChange && tableSections.length <= 1}
				<button type="button" class="detail-card-action" onclick={oneSectionForAll}>Use one section for all rows</button>
			{/if}
		</div>
		<div class="rs-column">
			<span class="field-label">Column</span>
			<ProfileColumnSelect
				options={columnOptions}
				value={column}
				placeholder="Select a column"
				ariaLabel="Column for the sections"
				disabled={!canChange}
				onchange={chooseColumn}
			/>
		</div>

		{#if column}
			{#if values.length}
				<ul class="rs-values">
					{#each values as entry (entry.value)}
						{@const target = sorting.assignments.get(entry.value) ?? ''}
						<li class:rs-out={target === ''}>
							<span class="rs-value">
								<span class="rs-value-text">{entry.value}</span>
								{#if entry.count !== null}
									<span class="rs-count">{entry.count.toLocaleString('en-US')} row{entry.count === 1 ? '' : 's'}</span>
								{/if}
							</span>
							<ProfileColumnSelect
								options={sectionOptions}
								value={target}
								noneLabel="Ignore"
								ariaLabel="Section for {entry.value}"
								disabled={!canChange}
								onchange={(next) => assign(entry.value, next)}
							/>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="field-hint">
					{sample ? `“${column}” has too many different values. Select a different column.` : 'Load a sample to see the values. Or, add the values here.'}
				</p>
			{/if}
			{#if canChange && !sampleValues}
				<div class="rs-add">
					<Input
						bind:value={draft}
						placeholder="A value of “{column}”"
						aria-label="A value of {column}"
						class="w-full"
						onkeydown={(event: KeyboardEvent) => {
							if (event.key === 'Enter') {
								event.preventDefault();
								addValue();
							}
						}}
					/>
					<button type="button" class="sheet-btn" disabled={!draft.trim()} onclick={addValue}><Plus size={14} /> Add</button>
				</div>
			{/if}
			{#if leftOut.length}
				<p class="field-hint">The app ignores the rows set to “Ignore”. The import shows how many.</p>
			{/if}
			{#each takesAll as section (section.uid)}
				<p class="rs-warn">
					“{section.name.trim() || 'A section'}” has no value. It gets all rows of the table. Give it a value, or remove the section.
				</p>
			{/each}
		{/if}
	{/if}
</section>

<style>
	.rs-one,
	.rs-split-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 8px 12px;
	}
	.rs-split-head {
		margin-bottom: 10px;
	}
	.rs-column {
		display: flex;
		flex-direction: column;
		gap: 4px;
		max-width: 320px;
	}
	.rs-values {
		list-style: none;
		margin: 12px 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
	}
	.rs-values li {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 220px);
		align-items: center;
		gap: 12px;
		padding: 6px 0;
		border-top: 1px solid var(--border);
	}
	.rs-values li:first-child {
		border-top: 0;
	}
	.rs-value {
		display: flex;
		align-items: baseline;
		gap: 8px;
		min-width: 0;
	}
	.rs-value-text {
		font-size: 13px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.rs-count {
		font-size: 11.5px;
		color: var(--muted-foreground);
		white-space: nowrap;
	}
	.rs-out .rs-value-text {
		color: var(--muted-foreground);
	}
	.rs-add {
		display: flex;
		gap: 8px;
		margin-top: 10px;
		max-width: 420px;
	}
	.rs-warn {
		margin: 8px 0 0;
		font-size: 12px;
		color: var(--red);
	}
	@media (max-width: 560px) {
		.rs-values li {
			grid-template-columns: minmax(0, 1fr);
			gap: 4px;
		}
	}
</style>
