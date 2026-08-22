<script lang="ts">
	import AccountDetail from '$lib/components/accounts/AccountDetail.svelte';
	import type { PageData, ActionData } from './$types.js';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<AccountDetail {data} {form} />
