<script lang="ts">
	import { Info, TriangleAlert } from '@lucide/svelte';
	import './reports.css';

	/**
	 * What a report cannot tell you, printed under it (FR-030).
	 *
	 * The sentences come from the report itself, never from this component — a
	 * screen inventing its own wording for a limitation is how two screens end
	 * up describing the same gap differently.
	 */
	let {
		notes = [],
		firstIsWarning = false
	}: {
		notes?: string[];
		/** The balance sheet puts a "these figures do not add up" sentence first. */
		firstIsWarning?: boolean;
	} = $props();
</script>

{#if notes.length > 0}
	<div class="rep-notes">
		<!-- Keyed by position: the notes are replaced as a whole set whenever the
		     report is, and are never reordered in place. -->
		{#each notes as note, i (i)}
			{@const warn = firstIsWarning && i === 0}
			<p class="rep-note" class:warn>
				{#if warn}
					<TriangleAlert size={14} />
				{:else}
					<Info size={14} />
				{/if}
				<span>{note}</span>
			</p>
		{/each}
	</div>
{/if}
