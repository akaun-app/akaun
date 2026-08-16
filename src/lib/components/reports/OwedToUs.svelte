<script lang="ts">
	import { ChevronRight } from '@lucide/svelte';
	import { formatDate, formatMinor } from '$lib/format.js';
	import type { AgeingItem, OutstandingAgeing } from '$lib/server/queries/settlements.js';
	import { openRecord, recordPathFor } from './report-links.js';
	import './reports.css';

	/**
	 * Money owed to the business, grouped by how overdue it is (US6 AC1).
	 *
	 * Only what is still outstanding is shown, so a part-paid invoice appears at
	 * the remainder and never at its full amount (US6 AC3) — the figure comes
	 * from `queries/settlements.ts`, which is the same arithmetic the payment
	 * screen and the invoice list use (FR-012, FR-031).
	 */
	let {
		report,
		isMobile = false
	}: {
		report: OutstandingAgeing;
		isMobile?: boolean;
	} = $props();

	function lateLabel(daysOverdue: number): string {
		if (daysOverdue === 0) return 'Not yet due';
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
			{#if !isMobile}Due {formatDate(item.dueDate ?? item.date)} · {/if}{lateLabel(
				item.daysOverdue
			)}
		</span>
	</span>
{/snippet}

<div class="rep-scroll">
	<div class="rep-result">
		<div>
			<div class="rep-result-label">Money owed to us</div>
			<div class="rep-result-sub">
				Everything customers have not paid yet, as at {formatDate(report.asOf)}
			</div>
		</div>
		<div class="rep-result-val">{formatMinor(report.totalOutstandingMinor)}</div>
	</div>

	{#if report.bands.length === 0}
		<div class="rep-block">
			<p class="rep-empty">Nobody owes the business anything right now.</p>
		</div>
	{/if}

	{#each report.bands as band (band.label)}
		<div class="rep-band">
			<div class="rep-band-head">
				<span class="rep-band-label">{band.label}</span>
				<span class="rep-band-total">{formatMinor(band.totalMinor)}</span>
			</div>

			<div class="claim-exp-list">
				{#each band.items as item (item.movementId)}
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
	{/each}
</div>
