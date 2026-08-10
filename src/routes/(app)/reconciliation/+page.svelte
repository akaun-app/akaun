<script lang="ts">
	import ReconciliationPage from '$lib/components/reconciliation/ReconciliationPage.svelte';
	import type { PageData } from './$types.js';
	let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>Reconciliation - Akaun</title></svelte:head>
<ReconciliationPage {data} openSessionId={null} />
