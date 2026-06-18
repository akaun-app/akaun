<script lang="ts">
	let {
		label,
		value,
		cur,
		sub,
		tone
	}: {
		label: string;
		/** Pre-formatted value (e.g. `formatMoney(...)`). */
		value: string;
		/** Optional currency/unit prefix, e.g. `RM` or `+RM`. */
		cur?: string;
		sub?: string;
		tone?: 'red' | 'amber' | 'green';
	} = $props();
</script>

<div
	class="stat-card"
	class:tone-red={tone === 'red'}
	class:tone-amber={tone === 'amber'}
	class:tone-green={tone === 'green'}
>
	<div class="stat-label">{label}</div>
	<div class="stat-value">{#if cur}<span class="stat-cur">{cur}</span>{/if}{value}</div>
	{#if sub}<div class="stat-sub">{sub}</div>{/if}
</div>
