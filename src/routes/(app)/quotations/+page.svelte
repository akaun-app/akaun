<script lang="ts">
	import QuotationsPage from '$lib/components/quotations/QuotationsPage.svelte';
	import type { PageData, ActionData } from './$types.js';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head><title>Quotations - Akaun</title></svelte:head>

<QuotationsPage {data} {form} openId={null} />
