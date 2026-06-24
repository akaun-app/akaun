<script lang="ts">
	import ExpensesPage from '$lib/components/expenses/ExpensesPage.svelte';
	import type { PageData, ActionData } from './$types.js';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head>
	<title>Expenses - Akaun</title>
</svelte:head>

<ExpensesPage {data} {form} openId={data.openExpenseId} />
