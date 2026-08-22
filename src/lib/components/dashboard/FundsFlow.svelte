<script lang="ts">
	import { AlertTriangle } from '@lucide/svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { formatMoney } from '$lib/format.js';
	import { mainCurrencySymbol } from '$lib/currency-state.svelte.js';
	import type { FundsFlowReport } from '$lib/server/ledger/reports/funds-flow.js';

	// Type-only import of a `$lib/server` module is allowed: it is erased at
	// build time, so nothing server-side reaches the browser. The figures
	// themselves arrive through the loader.
	let { report, periodLabel }: { report: FundsFlowReport; periodLabel: string } = $props();

	/**
	 * Positive is a source of funds and negative is a use — the sign the report
	 * already carries. Nothing here re-decides it; see the note on
	 * `FundsFlowLine`.
	 */
	const money = (minor: number) =>
		`${minor < 0 ? '−' : '+'}${mainCurrencySymbol()} ${formatMoney(Math.abs(minor) / 100)}`;

	// The longest bar is the largest single line, so the groups stay comparable
	// with each other rather than each being scaled to its own widest row.
	const widest = $derived(
		Math.max(
			1,
			...report.activities.flatMap((a) => a.lines.map((l) => Math.abs(l.amountMinor)))
		)
	);
</script>

<div class="panel">
	<div class="panel-head">
		<div>
			<div class="panel-title">Sources &amp; uses of funds</div>
			<div class="panel-sub">Operating · investing · financing · {periodLabel}</div>
		</div>
	</div>

	{#if !report.ties}
		<div class="ff-warn">
			<AlertTriangle size={14} />
			<span>{report.notes[0]}</span>
		</div>
	{/if}

	{#if report.activities.length === 0}
		<EmptyState
			title="Nothing moved this period"
			sub="Records that change what the business holds will appear here."
			style="padding:20px;"
		/>
	{:else}
		<div class="ff-body">
			{#each report.activities as activity (activity.key)}
				<div class="ff-group">
					<div class="ff-group-head">
						<span class="ff-group-name">{activity.label}</span>
						<span class="ff-amt" class:neg={activity.totalMinor < 0}>
							{money(activity.totalMinor)}
						</span>
					</div>
					{#each activity.lines as line (line.key)}
						<div class="ff-line">
							<span class="ff-line-name">{line.label}</span>
							<span class="ff-bar-wrap">
								<span
									class="ff-bar"
									class:neg={line.amountMinor < 0}
									style="width:{(Math.abs(line.amountMinor) / widest) * 100}%"
								></span>
							</span>
							<span class="ff-amt" class:neg={line.amountMinor < 0}>{money(line.amountMinor)}</span>
						</div>
					{/each}
				</div>
			{/each}
		</div>

		<div class="ff-foot">
			<div class="ff-foot-cell">
				<span class="ff-foot-label">Opening</span>
				<span class="ff-foot-value"
					>{mainCurrencySymbol()} {formatMoney(report.openingMinor / 100)}</span
				>
			</div>
			<div class="ff-foot-cell">
				<span class="ff-foot-label">Net movement</span>
				<span class="ff-foot-value" class:neg={report.netMinor < 0}>{money(report.netMinor)}</span>
			</div>
			<div class="ff-foot-cell">
				<span class="ff-foot-label">Closing</span>
				<span class="ff-foot-value"
					>{mainCurrencySymbol()} {formatMoney(report.closingMinor / 100)}</span
				>
			</div>
		</div>
	{/if}

	<p class="ff-note">
		Funds here means current assets — cash, bank and what customers owe. Equipment is left out on
		purpose: it is owned, not spent. A cost put on account reaches this statement when it is paid,
		so operating expenses need not match the profit and loss.
	</p>
</div>

<style>
	.ff-body {
		display: flex;
		flex-direction: column;
		gap: 16px;
		padding: 4px 0 2px;
	}
	.ff-group {
		display: flex;
		flex-direction: column;
		gap: 5px;
	}
	.ff-group-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 10px;
		padding-bottom: 4px;
		border-bottom: 1px solid var(--border);
	}
	.ff-group-name {
		font-size: 12px;
		font-weight: 600;
		letter-spacing: 0.03em;
		text-transform: uppercase;
		color: var(--muted-foreground);
	}
	.ff-line {
		display: grid;
		grid-template-columns: minmax(120px, 1.1fr) minmax(40px, 2fr) auto;
		align-items: center;
		gap: 12px;
	}
	.ff-line-name {
		font-size: 13px;
		color: var(--foreground);
	}
	.ff-bar-wrap {
		height: 6px;
		border-radius: 3px;
		background: var(--accent);
		overflow: hidden;
	}
	.ff-bar {
		display: block;
		height: 100%;
		border-radius: 3px;
		background: var(--green);
	}
	.ff-bar.neg {
		background: var(--red);
	}
	.ff-amt {
		font-family: 'Geist Mono', monospace;
		font-size: 12.5px;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		color: var(--green);
	}
	.ff-amt.neg {
		color: var(--red);
	}
	.ff-group-head .ff-amt {
		font-size: 13px;
		font-weight: 600;
	}

	.ff-foot {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 12px;
		margin-top: 14px;
		padding-top: 12px;
		border-top: 1px solid var(--border);
	}
	.ff-foot-cell {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.ff-foot-label {
		font-size: 11.5px;
		color: var(--muted-foreground);
	}
	.ff-foot-value {
		font-family: 'Geist Mono', monospace;
		font-size: 14px;
		font-variant-numeric: tabular-nums;
		font-weight: 600;
	}
	.ff-foot-value.neg {
		color: var(--red);
	}

	.ff-warn {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		margin-bottom: 12px;
		padding: 9px 11px;
		border: 1px solid var(--red);
		border-radius: 8px;
		font-size: 12.5px;
		line-height: 1.45;
		background: var(--red-soft);
		color: var(--red);
	}
	.ff-note {
		margin: 12px 0 0;
		font-size: 11.5px;
		line-height: 1.5;
		color: var(--muted-foreground);
	}

	@media (max-width: 640px) {
		.ff-line {
			grid-template-columns: 1fr auto;
		}
		.ff-bar-wrap {
			display: none;
		}
	}
</style>
