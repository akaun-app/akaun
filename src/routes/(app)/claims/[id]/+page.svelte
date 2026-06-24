<script lang="ts">
	import ClaimsPage from '$lib/components/claims/ClaimsPage.svelte';
	import type { PageData } from './$types.js';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>Claims - Akaun</title>
</svelte:head>

<ClaimsPage {data} openId={data.openClaimId} />
