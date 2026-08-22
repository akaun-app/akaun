<script lang="ts">
	import { untrack } from 'svelte';
	import { Download } from '@lucide/svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import DatePicker from '$lib/components/ui/date-picker/DatePicker.svelte';
	import { useIsMobile } from '$lib/hooks/useIsMobile.svelte.js';
	import type { ReportsPageData, ReportView } from '$lib/server/loaders/reports.js';
	import BalanceSheetReport from './BalanceSheetReport.svelte';
	import OwedToUs from './OwedToUs.svelte';
	import PartnerStatementReport from './PartnerStatementReport.svelte';
	import ProfitLossReport from './ProfitLossReport.svelte';
	import WeOwe from './WeOwe.svelte';
	import './reports.css';

	/**
	 * The reports screen, shared by `/reports` and `/reports/[view]`.
	 *
	 * Full pages rather than drawers: a report is a table read across and sent
	 * to an accountant, not a record's fields (plan.md Complexity Tracking).
	 * Every view is its own URL and carries its dates in the query string, so a
	 * user can copy what they are looking at and send it to someone else — the
	 * same promise every record detail makes.
	 */
	let { data }: { data: ReportsPageData } = $props();

	const screen = useIsMobile();
	const isMobile = $derived(screen.current);

	const TABS: { view: ReportView; label: string }[] = [
		{ view: 'profit-loss', label: 'Profit & Loss' },
		{ view: 'balance-sheet', label: 'Balance Sheet' },
		{ view: 'partners', label: "Partners' Equity" },
		{ view: 'owed-to-us', label: 'Receivables' },
		{ view: 'we-owe', label: 'Payables' }
	];

	const DESCRIPTIONS: Record<ReportView, string> = {
		'profit-loss': 'Revenue and expenses for the period',
		'balance-sheet': 'Assets, liabilities and equity as at a date',
		partners: "Each partner's contributions, share of profit and drawings",
		'owed-to-us': 'What customers still owe, and how overdue each one is',
		'we-owe': 'What the business still has to pay, and when it falls due'
	};

	/** The dates a link has to carry so the report a reader opens is the one you saw. */
	function periodQuery(): string {
		const p = data.period;
		return new URLSearchParams({ from: p.dateFrom, to: p.dateTo, asAt: p.asAt }).toString();
	}

	function hrefFor(view: ReportView): string {
		return `${resolve('/(app)/reports/[view]', { view })}?${periodQuery()}`;
	}

	/** The same report as a file for an accountant (FR-029). */
	const csv = $derived.by(() => {
		const p = data.period;
		const period = `dateFrom=${p.dateFrom}&dateTo=${p.dateTo}`;
		switch (data.view) {
			case 'profit-loss':
				return { endpoint: 'profit-loss', query: period };
			case 'balance-sheet':
				return { endpoint: 'balance-sheet', query: `asAt=${p.asAt}` };
			case 'partners':
				return { endpoint: 'partner-statement', query: period };
			default:
				// The who-owes-what views are a way of reading what is already on the
				// records screens, not a report an accountant is sent.
				return null;
		}
	});

	const showsPeriod = $derived(data.view === 'profit-loss' || data.view === 'partners');
	const showsAsAt = $derived(data.view === 'balance-sheet');

	// The dates live in the URL, so the pickers need somewhere writable of their
	// own: seeded from the loaded period, and put back in step whenever the
	// loader hands back a different one — it settles a range typed backwards.
	let dateFrom = $state<string | undefined>(untrack(() => data.period.dateFrom));
	let dateTo = $state<string | undefined>(untrack(() => data.period.dateTo));
	let asAt = $state<string | undefined>(untrack(() => data.period.asAt));

	$effect(() => {
		dateFrom = data.period.dateFrom;
		dateTo = data.period.dateTo;
		asAt = data.period.asAt;
	});

	function applyDates() {
		// A picker only ever hands back a date, so the fallbacks are here to
		// satisfy the type, not because a cleared picker is a case to handle.
		const query = new URLSearchParams({
			from: dateFrom ?? data.period.dateFrom,
			to: dateTo ?? data.period.dateTo,
			asAt: asAt ?? data.period.asAt
		}).toString();
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- route is resolved; only the period is appended.
		goto(`${resolve('/(app)/reports/[view]', { view: data.view })}?${query}`, {
			replaceState: true,
			noScroll: true,
			keepFocus: true
		});
	}
</script>

<div class="screen">
	<header class="topbar">
		<div class="topbar-left">
			<h1 class="page-title">Reports</h1>
			<p class="page-sub">{DESCRIPTIONS[data.view]}</p>
		</div>
		<div class="topbar-right">
			{#if csv}
				<!-- eslint-disable svelte/no-navigation-without-resolve -- an API download, not a page route. -->
				<a class="rep-export" href="/api/reports/{csv.endpoint}?{csv.query}&format=csv" download>
					<Download size={14} />
					Export
				</a>
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
			{/if}
		</div>
	</header>

	<div class="rep-toolbar" class:one-col={isMobile}>
		<!-- eslint-disable svelte/no-navigation-without-resolve -- hrefFor resolves the route; only the period is appended. -->
		<nav class="rep-tabs" aria-label="Which report">
			{#each TABS as tab (tab.view)}
				<a
					class="rep-tab"
					class:active={tab.view === data.view}
					href={hrefFor(tab.view)}
					aria-current={tab.view === data.view ? 'page' : undefined}
				>
					{tab.label}
				</a>
			{/each}
		</nav>
		<!-- eslint-enable svelte/no-navigation-without-resolve -->

		<span class="rep-toolbar-spacer"></span>

		{#if showsPeriod}
			<span class="rep-date-field">
				From
				<DatePicker bind:value={dateFrom} placeholder="Start" onchange={applyDates} />
			</span>
			<span class="rep-date-field">
				To
				<DatePicker bind:value={dateTo} placeholder="End" onchange={applyDates} />
			</span>
		{:else if showsAsAt}
			<span class="rep-date-field">
				As at
				<DatePicker bind:value={asAt} placeholder="Today" onchange={applyDates} />
			</span>
		{/if}
	</div>

	{#if data.view === 'profit-loss'}
		<ProfitLossReport report={data.report} {isMobile} />
	{:else if data.view === 'balance-sheet'}
		<BalanceSheetReport report={data.report} {isMobile} />
	{:else if data.view === 'partners'}
		<PartnerStatementReport report={data.report} {isMobile} />
	{:else if data.view === 'owed-to-us'}
		<OwedToUs report={data.report} {isMobile} />
	{:else if data.view === 'we-owe'}
		<WeOwe report={data.report} />
	{/if}
</div>
