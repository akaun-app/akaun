<script lang="ts">
	import AccountHistory from '$lib/components/reports/AccountHistory.svelte';
	import type { PageData } from './$types.js';

	let { data }: { data: PageData } = $props();

	// The shared loader has already redirected to `/accounts` if this id names no
	// account, so by the time this renders there is one.
	const accountId = $derived(data.openAccountId ?? 0);
	const accountName = $derived(data.accounts.find((a) => a.id === accountId)?.name ?? '');
</script>

<svelte:head>
	<title>{accountName || 'Account'} - Akaun</title>
</svelte:head>

<AccountHistory {accountId} {accountName} />
