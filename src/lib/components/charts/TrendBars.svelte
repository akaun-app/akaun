<script lang="ts">
	import { onMount } from 'svelte';
	import { Chart, BarController, BarElement, CategoryScale, LinearScale, Tooltip } from 'chart.js';

	Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip);

	let { data }: { data: { label: string; value: number }[] } = $props();

	let canvas: HTMLCanvasElement;
	let chart: Chart | null = null;

	function colors(d: typeof data) {
		return d.map((r) => (r.value >= 0 ? 'oklch(0.6 0.13 156)' : 'oklch(0.585 0.205 27.3)'));
	}

	function buildConfig(d: typeof data) {
		return {
			type: 'bar' as const,
			data: {
				labels: d.map((r) => r.label),
				datasets: [
					{
						data: d.map((r) => r.value),
						backgroundColor: colors(d),
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
						grid: { color: 'oklch(0.92 0.004 286.3)' },
						ticks: {
							font: { family: '"Geist Mono", monospace', size: 11 },
							callback: (v: number | string) =>
								'RM ' + (typeof v === 'number' ? v.toLocaleString() : v)
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
		chart.data.datasets[0].data = d.map((r) => r.value);
		(chart.data.datasets[0] as { backgroundColor: string[] }).backgroundColor = colors(d);
		chart.update();
	});
</script>

<div class="chart-canvas-wrap">
	<canvas bind:this={canvas}></canvas>
</div>
