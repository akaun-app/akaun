<script lang="ts">
	import ContactDetail from '$lib/components/contacts/ContactDetail.svelte';
	import type { PageData, ActionData } from './$types.js';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<ContactDetail {data} {form} />
