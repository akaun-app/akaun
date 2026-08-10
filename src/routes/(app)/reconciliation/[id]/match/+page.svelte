<script lang="ts">
	import MatchWorkspace from '$lib/components/reconciliation/MatchWorkspace.svelte';
	import type { PageData } from './$types.js';
	let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>Match reconciliation - Akaun</title></svelte:head>
<MatchWorkspace {data} />
