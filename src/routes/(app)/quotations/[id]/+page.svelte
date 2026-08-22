<script lang="ts">
	import QuotationDetail from '$lib/components/quotations/QuotationDetail.svelte';
	import type { PageData, ActionData } from './$types.js';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<QuotationDetail {data} {form} />
