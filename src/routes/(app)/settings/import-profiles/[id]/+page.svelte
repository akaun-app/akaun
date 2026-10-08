<script lang="ts">
	import ImportProfileEditor from '$lib/components/settings/ImportProfileEditor.svelte';
	import type { PageData } from './$types.js';

	let { data }: { data: PageData } = $props();
</script>

<ImportProfileEditor
	profile={data.profile}
	expenseCategories={data.expenseCategories}
	incomeCategories={data.incomeCategories}
	moneyAccounts={data.moneyAccounts}
	otherProfiles={data.otherProfiles}
	canChange={data.perms.change}
/>
