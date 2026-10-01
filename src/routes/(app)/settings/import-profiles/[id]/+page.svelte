<script lang="ts">
	import ImportProfileEditor from '$lib/components/settings/ImportProfileEditor.svelte';
	import type { PageData } from './$types.js';

	let { data }: { data: PageData } = $props();
</script>

<ImportProfileEditor
	profile={data.profile}
	starter={null}
	expenseCategories={data.expenseCategories}
	incomeCategories={data.incomeCategories}
	canChange={data.perms.change}
/>
