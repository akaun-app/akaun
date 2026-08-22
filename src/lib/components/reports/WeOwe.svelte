<script lang="ts">
	import { ChevronRight } from '@lucide/svelte';
	import { formatDate, formatMinor } from '$lib/format.js';
	import type { AgeingItem, OutstandingAgeing } from '$lib/server/queries/settlements.js';
	import { openRecord, recordPathFor } from './report-links.js';
	import './reports.css';

	/**
	 * Money the business owes, in the order it falls due (US6 AC2).
	 *
	 * Ordered by due date rather than grouped by age, because the question this
	 * screen answers is "what do I have to pay next?" — the age groups are still
	 * shown as a summary along the top, so how far behind the business is stays
	 * visible. Only what is still outstanding is counted (US6 AC3).
	 */
	let { report }: { report: OutstandingAgeing } = $props();

	const dueSoonestFirst = $derived(
		[...report.items].sort((a, b) => (a.dueDate ?? a.date).localeCompare(b.dueDate ?? b.date))
	);

	function lateLabel(daysOverdue: number): string {
		if (daysOverdue === 0) return '';
		if (daysOverdue === 1) return '1 day late';
		return `${daysOverdue} days late`;
	}
</script>

{#snippet rowBody(item: AgeingItem)}
	<span class="claim-exp-main">
		<span class="claim-exp-name">{item.contactName ?? 'Someone'}</span>
		<span class="claim-exp-sub">
			{item.recordNumber ? `${item.recordNumber} · ` : ''}{item.description}
		</span>
	</span>
	<span class="rep-row-right">
		<span class="claim-exp-amt">{formatMinor(item.outstandingMinor)}</span>
		<span class="rep-row-due" class:late={item.daysOverdue > 0}>
			Due {formatDate(item.dueDate ?? item.date)}{item.daysOverdue > 0
				? ` · ${lateLabel(item.daysOverdue)}`
				: ''}
		</span>
	</span>
{/snippet}

<div class="rep-scroll">
	<div class="rep-result">
		<div>
			<div class="rep-result-label">Accounts payable</div>
			<div class="rep-result-sub">
				Everything the business still has to pay, as at {formatDate(report.asOf)}
			</div>
		</div>
		<div class="rep-result-val">{formatMinor(report.totalOutstandingMinor)}</div>
	</div>

	{#if report.bands.length > 0}
		<div class="rep-block">
			<div class="rep-block-head">
				<div>
					<div class="rep-block-title">Ageing</div>
					<div class="rep-block-sub">Outstanding by days overdue</div>
				</div>
			</div>
			<table class="rep-table">
				<tbody>
					{#each report.bands as band (band.label)}
						<tr>
							<td>{band.label}</td>
							<td class="rep-amount">{formatMinor(band.totalMinor)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}

	{#if dueSoonestFirst.length === 0}
		<div class="rep-block">
			<p class="rep-empty">The business does not owe anyone anything right now.</p>
		</div>
	{:else}
		<div class="rep-band">
			<div class="rep-band-head">
				<span class="rep-band-label">Due soonest first</span>
				<span class="rep-band-total">{formatMinor(report.totalOutstandingMinor)}</span>
			</div>

			<div class="claim-exp-list">
				{#each dueSoonestFirst as item (item.movementId)}
					{@const path = recordPathFor(item)}
					{#if path}
						<button type="button" class="claim-exp related-link" onclick={() => openRecord(item)}>
							{@render rowBody(item)}
							<span class="claim-exp-chevron">
								<ChevronRight size={14} color="var(--muted-foreground)" />
							</span>
						</button>
					{:else}
						<!-- A payment, transfer or journal entry has no screen of its own,
						     so the row stays a row rather than pretending to be a link. -->
						<div class="claim-exp">{@render rowBody(item)}</div>
					{/if}
				{/each}
			</div>
		</div>
	{/if}
</div>
