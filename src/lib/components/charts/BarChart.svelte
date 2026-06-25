<script lang="ts">
	import { onMount } from 'svelte';
	import {
		Chart,
		BarController,
		BarElement,
		CategoryScale,
		LinearScale,
		Tooltip,
		Legend
	} from 'chart.js';

	import { mainCurrencySymbol } from '$lib/currency-state.svelte.js';

	Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend);

	let { data }: { data: { label: string; income: number; expense: number }[] } = $props();

	let canvas: HTMLCanvasElement;
	let chart: Chart | null = null;

	function buildConfig(d: typeof data) {
		return {
			type: 'bar' as const,
			data: {
				labels: d.map((r) => r.label),
				datasets: [
					{
						label: 'Income',
						data: d.map((r) => r.income),
						backgroundColor: 'oklch(0.646 0.187 41.6)',
						borderRadius: 4,
						borderSkipped: false
					},
					{
						label: 'Expense',
						data: d.map((r) => r.expense),
						backgroundColor: 'oklch(0.87 0.005 286.3)',
						borderRadius: 4,
						borderSkipped: false
					}
				]
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				plugins: { legend: { display: false }, tooltip: { mode: 'index' as const } },
				scales: {
					x: {
						grid: { display: false },
						ticks: { font: { family: '"Geist Mono", monospace', size: 11 } },
						border: { display: false }
					},
					y: {
						grid: { color: 'oklch(0.75 0.004 286.3 / 0.25)', drawTicks: false },
						ticks: {
							maxTicksLimit: 4,
							font: { family: '"Geist Mono", monospace', size: 11 },
							callback: (v: number | string) =>
								mainCurrencySymbol() + ' ' + (typeof v === 'number' ? v.toLocaleString() : v)
						},
						border: { display: false }
					}
				}
			}
		};
	}

	onMount(() => {
		chart = new Chart(canvas, buildConfig(data));
		return () => chart?.destroy();
	});

	$effect(() => {
		if (!chart) return;
		const d = data;
		chart.data.labels = d.map((r) => r.label);
		chart.data.datasets[0].data = d.map((r) => r.income);
		chart.data.datasets[1].data = d.map((r) => r.expense);
		chart.update();
	});
</script>

<div class="chart-canvas-wrap">
	<canvas bind:this={canvas}></canvas>
</div>
