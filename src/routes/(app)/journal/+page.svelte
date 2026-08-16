<script lang="ts">
	import JournalPage from '$lib/components/journal/JournalPage.svelte';
	import type { PageData } from './$types.js';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>Journal - Akaun</title>
</svelte:head>

<JournalPage {data} openId={null} />
