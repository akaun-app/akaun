<script lang="ts">
	import IncomePage from '$lib/components/income/IncomePage.svelte';
	import type { PageData, ActionData } from './$types.js';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head>
	<title>Income - Akaun</title>
</svelte:head>

<IncomePage {data} {form} openId={data.openIncomeId} />
