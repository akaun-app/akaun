<script lang="ts">
	import RecordCreate from '$lib/components/records/RecordCreate.svelte';
	import type { PageData } from './$types.js';

	let { data }: { data: PageData } = $props();
</script>

<RecordCreate {data} />
