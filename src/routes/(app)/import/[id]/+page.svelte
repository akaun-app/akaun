<script lang="ts">
	import ImportGroupDetail from '$lib/components/import/ImportGroupDetail.svelte';
	import type { PageData } from './$types.js';

	let { data }: { data: PageData } = $props();
</script>

<ImportGroupDetail {data} />
