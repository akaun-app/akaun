<script lang="ts">
	import RecordsPage from '$lib/components/records/RecordsPage.svelte';

	let { data, form } = $props();
</script>

<svelte:head><title>Records - Akaun</title></svelte:head>

<RecordsPage {data} {form} />
