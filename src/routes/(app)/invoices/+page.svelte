<script lang="ts">
	import InvoicesPage from '$lib/components/invoices/InvoicesPage.svelte';
	import type { PageData } from './$types.js';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>Invoices - Akaun</title></svelte:head>

<InvoicesPage {data} />
