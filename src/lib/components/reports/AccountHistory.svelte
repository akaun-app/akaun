<script lang="ts">
	import { ArrowLeft, Download } from '@lucide/svelte';
	import { resolve } from '$app/paths';
	import DatePicker from '$lib/components/ui/date-picker/DatePicker.svelte';
	import { useIsMobile } from '$lib/hooks/useIsMobile.svelte.js';
	import { formatDate, formatMinor } from '$lib/format.js';
	import { displaySignFor } from '$lib/components/accounts/display-sign.js';
	import { roleLabel } from '$lib/components/accounts/account-roles.js';
	import type { AccountHistoryReport } from '$lib/server/ledger/types.js';
	import ReportNotes from './ReportNotes.svelte';
	import './reports.css';

	/**
	 * Every movement on one account, with a running balance (FR-028).
	 *
	 * A full page rather than a drawer: this is a table read across and exported,
	 * not a record's fields (plan.md Complexity Tracking). It fetches its own
	 * report so the account list behind it does not have to carry every
	 * movement, and so changing the dates does not reload the page.
	 */
	let {
		accountId,
		accountName = ''
	}: {
		accountId: number;
		/** Known from the account list, so the heading is right before the fetch lands. */
		accountName?: string;
	} = $props();

	const screen = useIsMobile();
	const isMobile = $derived(screen.current);

	/**
	 * How many movements one view holds. There is deliberately no "next page":
	 * the running balance down the right-hand side is only meaningful from the
	 * first movement onwards, so a second page would restate every balance from
	 * the wrong starting point. An account with more than this says so and asks
	 * for narrower dates instead.
	 */
	const MOST_SHOWN = 1000;

	let dateFrom = $state<string | undefined>(undefined);
	let dateTo = $state<string | undefined>(undefined);
	let report = $state<AccountHistoryReport | null>(null);
	let loading = $state(true);
	let error = $state('');

	function queryFor(id: number, from?: string, to?: string): string {
		return new URLSearchParams({
			accountId: String(id),
			...(from ? { dateFrom: from } : {}),
			...(to ? { dateTo: to } : {}),
			limit: String(MOST_SHOWN)
		}).toString();
	}

	// The account and the dates are the whole request, so re-reading them is
	// exactly when a new one is due. Nothing the fetch writes back is read here,
	// so this cannot re-trigger itself.
	$effect(() => {
		const query = queryFor(accountId, dateFrom, dateTo);
		loading = true;
		error = '';

		fetch(`/api/reports/account-history?${query}`)
			.then(async (res) => {
				if (res.status === 403) throw new Error('You do not have permission to see reports.');
				if (!res.ok) throw new Error('That account history could not be loaded.');
				report = (await res.json()) as AccountHistoryReport;
			})
			.catch((e: Error) => {
				report = null;
				error = e.message;
			})
			.finally(() => {
				loading = false;
			});
	});

	/**
	 * Which way round this account reads. Under the one sign convention money we
	 * owe and money earned accumulate negative, and a reader expects "we owe
	 * 1,200", not "-1,200" — the same flip the chart of accounts applies.
	 */
	const sign = $derived(report ? displaySignFor(report.account.role) : 1);

	const csvQuery = $derived(`${queryFor(accountId, dateFrom, dateTo)}&format=csv`);

	/** Said out loud rather than left implied, the way a report's notes are (FR-030). */
	const truncationNotes = $derived(
		report && report.entries.length < report.total
			? [
					`This shows the first ${report.entries.length} of ${report.total} movements on this ` +
						`account. Narrow the dates to see the rest — the running balance is only right ` +
						`when it starts from the first movement.`
				]
			: []
	);

	function showAmount(minor: number): string {
		return formatMinor(minor * sign);
	}
</script>

<div class="screen">
	<header class="topbar">
		<div class="topbar-left">
			<h1 class="page-title">{report?.account.name || accountName || 'Account'}</h1>
			<p class="page-sub">
				{#if report}
					{roleLabel(report.account.role)} · balance {showAmount(report.closingBalanceMinor)} ·
					{report.total} movement{report.total === 1 ? '' : 's'}
				{:else}
					Every movement on this account
				{/if}
			</p>
		</div>
		<div class="topbar-right">
			<a class="rep-export" href={resolve('/accounts')}>
				<ArrowLeft size={14} />
				All accounts
			</a>
		</div>
	</header>

	<div class="rep-toolbar" class:one-col={isMobile}>
		<span class="rep-date-field">
			From
			<DatePicker bind:value={dateFrom} placeholder="the beginning" />
		</span>
		<span class="rep-date-field">
			To
			<DatePicker bind:value={dateTo} placeholder="today" />
		</span>
		<span class="rep-toolbar-spacer"></span>
		<!-- eslint-disable svelte/no-navigation-without-resolve -- an API download, not a page route. -->
		<a class="rep-export" href="/api/reports/account-history?{csvQuery}" download>
			<Download size={14} />
			Export
		</a>
		<!-- eslint-enable svelte/no-navigation-without-resolve -->
	</div>

	<div class="rep-scroll">
		{#if error}
			<div class="rep-block"><p class="rep-empty">{error}</p></div>
		{:else if loading && !report}
			<div class="rep-block"><p class="rep-empty">Loading…</p></div>
		{:else if report}
			<div class="rep-block">
				{#if isMobile}
					<table class="rep-table">
						<tbody>
							<tr class="rep-total">
								<td>Balance brought forward</td>
								<td class="rep-amount">{showAmount(report.openingBalanceMinor)}</td>
							</tr>
							{#each report.entries as entry (entry.movementId)}
								<tr>
									<td>
										<div>{entry.description}</div>
										<div class="rep-block-sub">
											{formatDate(entry.date)}{entry.contactName ? ` · ${entry.contactName}` : ''}
										</div>
									</td>
									<td class="rep-amount">
										<div>{showAmount(entry.amountMinor)}</div>
										<div class="rep-block-sub">{showAmount(entry.runningBalanceMinor)}</div>
									</td>
								</tr>
							{/each}
							<tr class="rep-total">
								<td>Balance carried forward</td>
								<td class="rep-amount">{showAmount(report.closingBalanceMinor)}</td>
							</tr>
						</tbody>
					</table>
				{:else}
					<table class="rep-table">
						<thead>
							<tr>
								<th>Date</th>
								<th>Reference</th>
								<th>Description</th>
								<th>Who</th>
								<th class="rep-amount">Amount</th>
								<th class="rep-amount">Running balance</th>
							</tr>
						</thead>
						<tbody>
							<tr class="rep-total">
								<td colspan="5">Balance brought forward</td>
								<td class="rep-amount">{showAmount(report.openingBalanceMinor)}</td>
							</tr>
							{#each report.entries as entry (entry.movementId)}
								<tr>
									<td>{formatDate(entry.date)}</td>
									<td>{entry.recordNumber ?? ''}</td>
									<td>{entry.description}</td>
									<td>{entry.contactName ?? ''}</td>
									<td class="rep-amount">{showAmount(entry.amountMinor)}</td>
									<td class="rep-amount">{showAmount(entry.runningBalanceMinor)}</td>
								</tr>
							{/each}
							<tr class="rep-total">
								<td colspan="5">Balance carried forward</td>
								<td class="rep-amount">{showAmount(report.closingBalanceMinor)}</td>
							</tr>
						</tbody>
					</table>
				{/if}

				{#if report.entries.length === 0}
					<p class="rep-empty">Nothing has gone through this account in this period.</p>
				{/if}
			</div>

			<ReportNotes notes={[...truncationNotes, ...report.notes]} />
		{/if}
	</div>
</div>
