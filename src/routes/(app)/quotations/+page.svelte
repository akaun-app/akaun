<script lang="ts">
	import QuotationsPage from '$lib/components/quotations/QuotationsPage.svelte';
	import type { PageData } from './$types.js';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>Quotations - Akaun</title></svelte:head>

<QuotationsPage {data} />
