<script lang="ts">
	import { goto } from '$app/navigation';
	import {
		TrendingUp,
		Wallet,
		ArrowUpRight,
		FileText,
		TrendingDown
	} from '@lucide/svelte';
	import BarChart from '$lib/components/charts/BarChart.svelte';
	import DonutChart from '$lib/components/charts/DonutChart.svelte';
	import TrendBars from '$lib/components/charts/TrendBars.svelte';
	import { formatMoney, formatMoneyRM, formatDateShort } from '$lib/format.js';
	import type { PageData } from './$types.js';

	let { data }: { data: PageData } = $props();

	const PERIODS = [
		{ id: '2m', label: 'Last 2 months' },
		{ id: 'mtd', label: 'This month' },
		{ id: 'ytd', label: 'Year to date' }
	];

	let period = $state(data.period ?? '2m');

	$effect(() => {
		const p = period;
		if (p !== data.period) {
			goto(`/dashboard?period=${p}`, { replaceState: true, keepFocus: true });
		}
	});

	const periodLabel = $derived(PERIODS.find((p) => p.id === period)?.label ?? '');
</script>

<div class="screen">
	<header class="topbar">
		<div class="topbar-left">
			<h1 class="page-title">Dashboard</h1>
			<p class="page-sub">Welcome back, {data.user?.username}</p>
		</div>
		<div class="topbar-right">
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
				<BarChart data={data.cashFlow} />
			</div>

			<div class="panel">
				<div class="panel-head">
					<div>
						<div class="panel-title">Spending by category</div>
						<div class="panel-sub">{periodLabel}</div>
					</div>
				</div>
				{#if data.categoryData.length > 0}
					<DonutChart data={data.categoryData} />
				{:else}
					<div class="empty" style="padding:20px;">
						<div class="empty-title">No expense data</div>
					</div>
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
				<TrendBars data={data.trendData} />
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
						<div style="padding:20px; text-align:center; color:var(--muted-foreground); font-size:13px;">
							No activity yet
						</div>
					{/if}
				</div>
			</div>
		</div>
	</div>
</div>
