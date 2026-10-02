<script lang="ts">
	import ImportProfileEditor from '$lib/components/settings/ImportProfileEditor.svelte';
	import type { PageData } from './$types.js';

	let { data }: { data: PageData } = $props();
</script>

<ImportProfileEditor
	profile={null}
	starter={data.starter}
	expenseCategories={data.expenseCategories}
	incomeCategories={data.incomeCategories}
	moneyAccounts={data.moneyAccounts}
	otherProfiles={data.otherProfiles}
	canChange={true}
/>
