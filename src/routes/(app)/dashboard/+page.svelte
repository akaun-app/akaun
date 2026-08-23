<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { onMount, onDestroy } from 'svelte';
	import {
		TrendingUp,
		Wallet,
		ArrowUpRight,
		TrendingDown,
		Landmark,
		Scale,
		ChevronDown,
		TriangleAlert
	} from '@lucide/svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { formatMinor, formatMoney, formatDateShort } from '$lib/format.js';
	import { mainCurrencySymbol } from '$lib/currency-state.svelte.js';
	import { periodOptions } from '$lib/dashboard-periods.js';
	import {
		balanceSheetHref,
		cashFlowHref,
		profitLossHref
	} from '$lib/components/reports/report-links.js';
	import type { PageData } from './$types.js';

	/**
	 * Three indicators, each a direct read of the same report function Reports
	 * itself calls (005 FR-013, FR-014) — no charts, no separately-computed
	 * figure. Following an indicator lands on the matching Reports statement
	 * already showing the same figure (FR-015).
	 */
	let { data }: { data: PageData } = $props();

	const PERIODS = periodOptions();

	// svelte-ignore state_referenced_locally
	let period = $state(data.period ?? 'm');
	let mobilePeriodOpen = $state(false);

	$effect(() => {
		const p = period;
		if (p !== data.period) {
			goto(`/dashboard?period=${p}`, { replaceState: true, keepFocus: true });
		}
	});

	const periodLabel = $derived(PERIODS.find((p) => p.id === period)?.label ?? '');

	const netProfitHref = $derived(profitLossHref(data.netProfit.dateFrom, data.netProfit.dateTo));
	const positionHref = $derived(balanceSheetHref(data.position.asAt));
	const cashFlowIndicatorHref = $derived(cashFlowHref(data.cashFlow.dateFrom, data.cashFlow.dateTo));

	// SSE — push-to-refresh: server signals when any financial data changes
	let _es: EventSource | null = null;
	let _debounce: ReturnType<typeof setTimeout> | null = null;

	onMount(() => {
		_es = new EventSource('/api/dashboard/stream');
		_es.onmessage = () => {
			if (_debounce) clearTimeout(_debounce);
			_debounce = setTimeout(() => invalidateAll(), 500);
		};
	});
	onDestroy(() => {
		_es?.close();
		if (_debounce) clearTimeout(_debounce);
	});
</script>

<svelte:head>
	<title>Dashboard - Akaun</title>
</svelte:head>

<svelte:window onclick={() => (mobilePeriodOpen = false)} />

<div class="screen">
	<header class="topbar">
		<div class="topbar-left">
			<h1 class="page-title">Dashboard</h1>
			<p class="page-sub">Welcome back, {data.user?.username}</p>
		</div>
		<div class="topbar-right">
			<!-- Desktop: full segmented control -->
			<div class="seg">
				{#each PERIODS as p}
					<button
						class="seg-btn"
						class:active={period === p.id}
						onclick={() => (period = p.id)}
					>
						{p.label}
					</button>
				{/each}
			</div>
			<!-- Mobile: compact period dropdown -->
			<div class="mobile-period-wrap" role="none">
				<button
					class="mobile-period-toggle"
					onclick={(e) => { e.stopPropagation(); mobilePeriodOpen = !mobilePeriodOpen; }}
				>
					{periodLabel} <ChevronDown size={13} />
				</button>
				{#if mobilePeriodOpen}
					<div class="mobile-period-menu" role="none" onclick={(e) => e.stopPropagation()}>
						{#each PERIODS as p}
							<button
								class="mobile-period-item"
								class:active={period === p.id}
								onclick={() => { period = p.id; mobilePeriodOpen = false; }}
							>
								{p.label}
							</button>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	</header>

	<div class="dash-scroll">
		<!-- The three indicators: net profit, financial position, cash flow. -->
		<div class="kpi-grid">
			<a class="kpi" class:tone-green={data.netProfit.amountMinor >= 0} class:tone-red={data.netProfit.amountMinor < 0} href={netProfitHref}>
				<div class="kpi-top">
					<span class="kpi-icon">
						{#if data.netProfit.amountMinor >= 0}
							<ArrowUpRight size={16} />
						{:else}
							<TrendingDown size={16} />
						{/if}
					</span>
					<span class="kpi-label">Net profit</span>
				</div>
				<div class="kpi-value">
					{formatMinor(Math.abs(data.netProfit.amountMinor))}
					{#if data.netProfit.amountMinor < 0}<span style="font-size:14px; color:var(--red)"> loss</span>{/if}
				</div>
				<div class="kpi-sub">Revenue less expenses · {periodLabel}</div>
			</a>

			<a class="kpi tone-primary" href={positionHref}>
				<div class="kpi-top">
					<span class="kpi-icon"><Scale size={16} /></span>
					<span class="kpi-label">Financial position</span>
				</div>
				<div class="kpi-value">
					{formatMinor(data.position.assetsTotalMinor)}
				</div>
				<div class="kpi-sub">
					{#if data.position.balances}
						Assets. Liabilities {formatMinor(data.position.liabilitiesTotalMinor)} · equity {formatMinor(
							data.position.equityTotalMinor
						)}
					{:else}
						<span class="kpi-warn"><TriangleAlert size={12} /> The books do not balance — check Reports</span>
					{/if}
				</div>
			</a>

			<a class="kpi" class:tone-green={data.cashFlow.netChangeMinor >= 0} class:tone-red={data.cashFlow.netChangeMinor < 0} href={cashFlowIndicatorHref}>
				<div class="kpi-top">
					<span class="kpi-icon"><Landmark size={16} /></span>
					<span class="kpi-label">Cash flow</span>
				</div>
				<div class="kpi-value">
					{formatMinor(data.cashFlow.netChangeMinor)}
				</div>
				<div class="kpi-sub">
					Net change in cash · {periodLabel}
					{#if data.cashFlow.needsReviewMinor !== 0}
						· {formatMinor(data.cashFlow.needsReviewMinor)} needs review
					{/if}
				</div>
			</a>
		</div>

		<div class="panel-row">
			<div class="panel">
				<div class="panel-head">
					<div class="panel-title">Recent activity</div>
					<a href="/records" class="link-btn" style="font-size:12.5px;">View all</a>
				</div>
				<div class="activity">
					{#each data.recent as item}
						<div class="activity-row">
							<div class="activity-icon {item.kind}">
								{#if item.kind === 'income'}
									<TrendingUp size={14} />
								{:else}
									<Wallet size={14} />
								{/if}
							</div>
							<div class="activity-meta">
								<div class="activity-name">{item.name || '—'}</div>
								<div class="activity-sub">{item.sub || ''} · {formatDateShort(item.date)}</div>
							</div>
							<div class="activity-amt {item.kind}">
								{item.kind === 'income' ? '+' : '−'}{mainCurrencySymbol()} {formatMoney(item.amount)}
							</div>
						</div>
					{/each}
					{#if data.recent.length === 0}
						<EmptyState title="No activity yet" sub="Recent transactions will appear here." style="padding:20px;" />
					{/if}
				</div>
			</div>
		</div>
	</div>
</div>
