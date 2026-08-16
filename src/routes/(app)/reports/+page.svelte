<script lang="ts">
	import ReportsPage from '$lib/components/reports/ReportsPage.svelte';
	import type { PageData } from './$types.js';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>Reports - Akaun</title>
</svelte:head>

<ReportsPage {data} />
