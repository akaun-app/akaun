<script lang="ts">
	import AccountsPage from '$lib/components/accounts/AccountsPage.svelte';
	import type { PageData, ActionData } from './$types.js';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head>
	<title>Accounts - Akaun</title>
</svelte:head>

<AccountsPage {data} {form} openId={data.openAccountId} />
