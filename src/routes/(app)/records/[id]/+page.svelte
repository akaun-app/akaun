<script lang="ts">
	import RecordDetail from '$lib/components/records/RecordDetail.svelte';
	import type { PageData } from './$types.js';

	let { data }: { data: PageData } = $props();
</script>

<RecordDetail {data} />
