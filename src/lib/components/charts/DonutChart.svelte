<script lang="ts">
	import { onMount } from 'svelte';
	import { Chart, DoughnutController, ArcElement, Tooltip, Legend } from 'chart.js';

	Chart.register(DoughnutController, ArcElement, Tooltip, Legend);

	const COLORS = [
		'oklch(0.646 0.187 41.6)',
		'oklch(0.62 0.16 58)',
		'oklch(0.6 0.13 156)',
		'oklch(0.55 0.12 250)',
		'oklch(0.55 0.16 300)',
		'oklch(0.87 0.005 286.3)'
	];

	let { data }: { data: { label: string; value: number }[] } = $props();

	let canvas: HTMLCanvasElement;
	let chart: Chart | null = null;

	const fmt = new Intl.NumberFormat('en-MY', {
		minimumFractionDigits: 0,
		maximumFractionDigits: 0
	});

	function buildConfig(d: typeof data) {
		return {
			type: 'doughnut' as const,
			data: {
				labels: d.map((r) => r.label),
				datasets: [
					{
						data: d.map((r) => r.value),
						backgroundColor: COLORS.slice(0, d.length),
						borderWidth: 0,
						hoverOffset: 4
					}
				]
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				cutout: '68%',
				plugins: {
					legend: { display: false },
					tooltip: {
						callbacks: {
							label: (ctx: { label: string; parsed: number }) =>
								` ${ctx.label}: RM ${fmt.format(ctx.parsed)}`
						}
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
		(chart.data.datasets[0] as { backgroundColor: string[] }).backgroundColor = COLORS.slice(
			0,
			d.length
		);
		chart.update();
	});

	const total = $derived(data.reduce((s, r) => s + r.value, 0));
</script>

<div style="display:flex; align-items:center; gap:16px; flex-wrap:wrap; flex:1; min-height:180px;">
	<div style="position:relative; flex-shrink:0; width:140px; height:140px;">
		<canvas bind:this={canvas}></canvas>
		<div
			style="position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; pointer-events:none;"
		>
			<div class="num" style="font-size:14px; font-weight:600;">RM {fmt.format(total)}</div>
			<div style="font-size:10px; color:var(--muted-foreground); margin-top:1px;">total</div>
		</div>
	</div>
	<div style="flex:1; min-width:100px; display:flex; flex-direction:column; gap:7px;">
		{#each data as item, i}
			<div style="display:flex; align-items:center; gap:8px; font-size:12.5px;">
				<span
					style="width:9px; height:9px; border-radius:3px; flex-shrink:0; background:{COLORS[i] ?? COLORS[COLORS.length - 1]};"
				></span>
				<span style="flex:1; color:var(--foreground); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;"
					>{item.label}</span
				>
				<span class="num" style="color:var(--muted-foreground);">RM {fmt.format(item.value)}</span>
			</div>
		{/each}
		{#if data.length === 0}
			<div style="color:var(--muted-foreground); font-size:13px;">No data</div>
		{/if}
	</div>
</div>
