<script lang="ts">
	import { ChevronRight } from '@lucide/svelte';
	import { formatDate, formatMinor } from '$lib/format.js';
	import type { ProfitLossReport } from '$lib/server/ledger/types.js';
	import ReportNotes from './ReportNotes.svelte';
	import { openAccountHistory } from './report-links.js';
	import './reports.css';

	/**
	 * What came in, what went out, and what is left, over a date range (FR-025).
	 *
	 * Every figure arrives already worked out and already the right way round —
	 * `ledger/reports/profit-loss.ts` applies the sign rule, so nothing here
	 * negates anything. A line is one category account's total, so clicking it
	 * opens that account's own history and the two can be checked against each
	 * other (FR-031).
	 */
	let {
		report,
		isMobile = false
	}: {
		report: ProfitLossReport;
		isMobile?: boolean;
	} = $props();

	const sections = $derived([
		{
			title: 'Money coming in',
			sub: 'What the business earned, by where it came from',
			lines: report.income,
			totalLabel: 'Total money coming in',
			totalMinor: report.totalIncomeMinor
		},
		{
			title: 'Money going out',
			sub: 'What the business spent, by what it was spent on',
			lines: report.expenses,
			totalLabel: 'Total money going out',
			totalMinor: report.totalExpensesMinor
		}
	]);
</script>

<div class="rep-scroll">
	<div class="rep-result">
		<div>
			<div class="rep-result-label">What is left</div>
			<div class="rep-result-sub">
				Money coming in less money going out, {formatDate(report.dateFrom)} to {formatDate(
					report.dateTo
				)}
			</div>
		</div>
		<div class="rep-result-val" class:good={report.resultMinor > 0} class:bad={report.resultMinor < 0}>
			{formatMinor(report.resultMinor)}
		</div>
	</div>

	<div class="rep-cols" class:one-col={isMobile}>
		{#each sections as section (section.title)}
			<div class="rep-block">
				<div class="rep-block-head">
					<div>
						<div class="rep-block-title">{section.title}</div>
						<div class="rep-block-sub">{section.sub}</div>
					</div>
				</div>

				{#if section.lines.length === 0}
					<p class="rep-empty">Nothing in this period.</p>
				{:else}
					<table class="rep-table">
						<tbody>
							{#each section.lines as line (line.accountId)}
								<tr>
									<td>
										<button
											type="button"
											class="rep-open related-link"
											onclick={() => openAccountHistory(line.accountId)}
										>
											<span>{line.accountName}</span>
											<ChevronRight size={13} />
										</button>
									</td>
									<td class="rep-amount">{formatMinor(line.amountMinor)}</td>
								</tr>
							{/each}
							<tr class="rep-total">
								<td>{section.totalLabel}</td>
								<td class="rep-amount">{formatMinor(section.totalMinor)}</td>
							</tr>
						</tbody>
					</table>
				{/if}
			</div>
		{/each}
	</div>

	<ReportNotes notes={report.notes} />
</div>
