<script lang="ts" generics="T">
	// Defers a chart component (and the chart.js bundle it pulls in) until after
	// the dashboard shell has painted. The dashboard is the PWA start_url, so
	// keeping chart.js off the first-paint path noticeably speeds up cold start.
	// A skeleton occupies the exact chart area (.chart-canvas-wrap) so there's no
	// layout shift when the real chart swaps in.
	import type { Component } from 'svelte';
	import { onMount } from 'svelte';

	let {
		load,
		data
	}: {
		load: () => Promise<{ default: Component<{ data: T }> }>;
		data: T;
	} = $props();

	let Chart = $state<Component<{ data: T }> | null>(null);

	onMount(async () => {
		Chart = (await load()).default;
	});
</script>

{#if Chart}
	<Chart {data} />
{:else}
	<div class="chart-canvas-wrap"><div class="chart-skeleton" aria-hidden="true"></div></div>
{/if}

<style>
	.chart-skeleton {
		position: absolute;
		inset: 0;
		border-radius: var(--radius-md);
		background: linear-gradient(90deg, var(--accent) 25%, var(--muted) 37%, var(--accent) 63%);
		background-size: 400% 100%;
		animation: chart-shimmer 1.4s ease infinite;
	}
	@keyframes chart-shimmer {
		0% {
			background-position: 100% 0;
		}
		100% {
			background-position: 0 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.chart-skeleton {
			animation: none;
		}
	}
</style>
