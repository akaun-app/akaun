<script lang="ts">
	import InvoiceDetail from '$lib/components/invoices/InvoiceDetail.svelte';
	import type { PageData, ActionData } from './$types.js';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<InvoiceDetail {data} {form} />
