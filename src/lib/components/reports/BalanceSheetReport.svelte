<script lang="ts">
	import { ChevronRight } from '@lucide/svelte';
	import { formatDate, formatMinor } from '$lib/format.js';
	import type { BalanceSheetReport, BalanceSheetSection } from '$lib/server/ledger/types.js';
	import ReportNotes from './ReportNotes.svelte';
	import { openAccountHistory } from './report-links.js';
	import './reports.css';

	/**
	 * What the business owns, what it owes and what the owners have in it, as at
	 * a date (FR-026).
	 *
	 * The two sides are shown next to each other on a wide screen because the
	 * whole point of the report is that they match; below the mobile breakpoint
	 * they stack, since a column too narrow to read is worse than a longer page
	 * (FR-043).
	 */
	let {
		report,
		isMobile = false
	}: {
		report: BalanceSheetReport;
		isMobile?: boolean;
	} = $props();

	/**
	 * The accumulated result is not an account — no account holds it, it is the
	 * categories' running total brought across — so it is the one line with
	 * nothing to open. `ledger/reports/balance-sheet.ts` marks it with id 0.
	 */
	const NOTHING_TO_OPEN = 0;

	const owedAndOwners = $derived([
		{
			title: 'Liabilities',
			sub: 'What the business owes',
			section: report.owed
		},
		{
			title: 'Equity',
			sub: 'Contributions, less drawings, plus earnings kept in the business',
			section: report.ownersStake
		}
	]);

	function totalOf(section: BalanceSheetSection): string {
		return formatMinor(section.totalMinor);
	}
</script>

<div class="rep-scroll">
	<div class="rep-result">
		<div>
			<div class="rep-result-label">Total assets, as at {formatDate(report.asAt)}</div>
			<div class="rep-result-sub">
				{#if report.balances}
					This is the same figure as liabilities plus equity, which is how you know the books add
					up.
				{:else}
					This does not match liabilities plus equity — the difference is {formatMinor(
						report.differenceMinor
					)}.
				{/if}
			</div>
		</div>
		<div class="rep-result-val" class:bad={!report.balances}>
			{totalOf(report.owned)}
		</div>
	</div>

	<div class="rep-cols" class:one-col={isMobile}>
		<div class="rep-block">
			<div class="rep-block-head">
				<div>
					<div class="rep-block-title">Assets</div>
					<div class="rep-block-sub">Cash, receivables and property the business owns</div>
				</div>
			</div>
			{#if report.owned.lines.length === 0}
				<p class="rep-empty">Nothing at this date.</p>
			{:else}
				<table class="rep-table">
					<tbody>
						{#each report.owned.lines as line (line.accountId)}
							<tr>
								<td>
									<button
										type="button"
										class="rep-open related-link"
										onclick={() => openAccountHistory(line.accountId)}
									>
										<span
											style={`padding-left: ${(line.depth ?? 0) * 1.25}rem`}
											class:font-semibold={line.isSubtotal}>{line.accountName}</span
										>
										<ChevronRight size={13} />
									</button>
								</td>
								<td class="rep-amount">{formatMinor(line.amountMinor)}</td>
							</tr>
						{/each}
						<tr class="rep-total">
							<td>Total</td>
							<td class="rep-amount">{totalOf(report.owned)}</td>
						</tr>
					</tbody>
				</table>
			{/if}
		</div>

		<div class="rep-cols one-col">
			{#each owedAndOwners as group (group.title)}
				<div class="rep-block">
					<div class="rep-block-head">
						<div>
							<div class="rep-block-title">{group.title}</div>
							<div class="rep-block-sub">{group.sub}</div>
						</div>
					</div>
					{#if group.section.lines.length === 0}
						<p class="rep-empty">Nothing at this date.</p>
					{:else}
						<table class="rep-table">
							<tbody>
								{#each group.section.lines as line (line.accountId)}
									<tr>
										<td>
											{#if line.accountId === NOTHING_TO_OPEN}
												<span
													style={`padding-left: ${(line.depth ?? 0) * 1.25}rem`}
													class:font-semibold={line.isSubtotal}>{line.accountName}</span
												>
											{:else}
												<button
													type="button"
													class="rep-open related-link"
													onclick={() => openAccountHistory(line.accountId)}
												>
													<span
														style={`padding-left: ${(line.depth ?? 0) * 1.25}rem`}
														class:font-semibold={line.isSubtotal}>{line.accountName}</span
													>
													<ChevronRight size={13} />
												</button>
											{/if}
										</td>
										<td class="rep-amount">{formatMinor(line.amountMinor)}</td>
									</tr>
								{/each}
								<tr class="rep-total">
									<td>Total</td>
									<td class="rep-amount">{totalOf(group.section)}</td>
								</tr>
							</tbody>
						</table>
					{/if}
				</div>
			{/each}
		</div>
	</div>

	<ReportNotes notes={report.notes} firstIsWarning={!report.balances} />
</div>
