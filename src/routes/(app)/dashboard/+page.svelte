<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { onMount, onDestroy } from 'svelte';
	import {
		TrendingUp,
		Wallet,
		ArrowUpRight,
		FileText,
		TrendingDown,
		ChevronDown
	} from '@lucide/svelte';
	import LazyChart from '$lib/components/ui/LazyChart.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { formatMoney, formatMoneyRM, formatDateShort } from '$lib/format.js';
	import type { PageData } from './$types.js';

	let { data }: { data: PageData } = $props();

	const PERIODS = [
		{ id: '2m', label: 'Last 2 months' },
		{ id: 'mtd', label: 'This month' },
		{ id: 'ytd', label: 'Year to date' }
	];

	// svelte-ignore state_referenced_locally
	let period = $state(data.period ?? '2m');
	let mobilePeriodOpen = $state(false);

	$effect(() => {
		const p = period;
		if (p !== data.period) {
			goto(`/dashboard?period=${p}`, { replaceState: true, keepFocus: true });
		}
	});

	const periodLabel = $derived(PERIODS.find((p) => p.id === period)?.label ?? '');

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
		<!-- KPI Cards -->
		<div class="kpi-grid">
			<div class="kpi tone-green">
				<div class="kpi-top">
					<span class="kpi-icon"><TrendingUp size={16} /></span>
					<span class="kpi-label">Income</span>
				</div>
				<div class="kpi-value"><span class="kpi-cur">RM</span>{formatMoney(data.incTotal)}</div>
				<div class="kpi-sub">{data.incCount} records · {periodLabel}</div>
			</div>
			<div class="kpi">
				<div class="kpi-top">
					<span class="kpi-icon"><Wallet size={16} /></span>
					<span class="kpi-label">Expenses</span>
				</div>
				<div class="kpi-value"><span class="kpi-cur">RM</span>{formatMoney(data.expTotal)}</div>
				<div class="kpi-sub">{data.expCount} records · {periodLabel}</div>
			</div>
			<div class="kpi" class:tone-primary={data.net >= 0} class:tone-red={data.net < 0}>
				<div class="kpi-top">
					<span class="kpi-icon">
						{#if data.net >= 0}
							<ArrowUpRight size={16} />
						{:else}
							<TrendingDown size={16} />
						{/if}
					</span>
					<span class="kpi-label">Net</span>
				</div>
				<div class="kpi-value">
					<span class="kpi-cur">RM</span>{formatMoney(Math.abs(data.net))}
					{#if data.net < 0}<span style="font-size:14px; color:var(--red)"> deficit</span>{/if}
				</div>
				<div class="kpi-sub">Income − expenses</div>
			</div>
			<div class="kpi tone-red">
				<div class="kpi-top">
					<span class="kpi-icon"><FileText size={16} /></span>
					<span class="kpi-label">Outstanding</span>
				</div>
				<div class="kpi-value"><span class="kpi-cur">RM</span>{formatMoney(data.outstanding)}</div>
				<div class="kpi-sub">Unpaid · all time</div>
			</div>
		</div>

		<!-- Charts row 1 -->
		<div class="panel-row">
			<div class="panel">
				<div class="panel-head">
					<div>
						<div class="panel-title">Cash flow</div>
						<div class="panel-sub">Income vs expenses · last 6 months</div>
					</div>
					<div class="chart-legend">
						<span class="lg"
							><span class="lg-dot" style="background:oklch(0.646 0.187 41.6);"></span> Income</span
						>
						<span class="lg"
							><span class="lg-dot" style="background:oklch(0.87 0.005 286.3);"></span> Expense</span
						>
					</div>
				</div>
				<LazyChart load={() => import('$lib/components/charts/BarChart.svelte')} data={data.cashFlow} />
			</div>

			<div class="panel">
				<div class="panel-head">
					<div>
						<div class="panel-title">Spending by category</div>
						<div class="panel-sub">{periodLabel}</div>
					</div>
				</div>
				{#if data.categoryData.length > 0}
					<LazyChart load={() => import('$lib/components/charts/DonutChart.svelte')} data={data.categoryData} />
				{:else}
					<EmptyState title="No expense data yet" sub="Add expenses to see your spending breakdown." style="padding:20px;" />
				{/if}
			</div>
		</div>

		<!-- Charts row 2 -->
		<div class="panel-row">
			<div class="panel">
				<div class="panel-head">
					<div>
						<div class="panel-title">Net trend</div>
						<div class="panel-sub">Monthly surplus / deficit · last 6 months</div>
					</div>
				</div>
				<LazyChart load={() => import('$lib/components/charts/TrendBars.svelte')} data={data.trendData} />
			</div>

			<div class="panel">
				<div class="panel-head">
					<div class="panel-title">Recent activity</div>
					<a href="/expenses" class="link-btn" style="font-size:12.5px;">View all</a>
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
								{item.kind === 'income' ? '+' : '−'}RM {formatMoney(item.amount)}
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
