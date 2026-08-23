<script lang="ts">
	import PaymentCreate from '$lib/components/records/PaymentCreate.svelte';
	import type { PageData } from './$types.js';

	let { data }: { data: PageData } = $props();
</script>

<PaymentCreate {data} />
