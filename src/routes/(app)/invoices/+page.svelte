<script lang="ts">
	import InvoicesPage from '$lib/components/invoices/InvoicesPage.svelte';
	import type { PageData, ActionData } from './$types.js';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head><title>Invoices - Akaun</title></svelte:head>

<InvoicesPage {data} {form} openId={null} />
