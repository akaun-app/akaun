<script lang="ts">
	import ContactsPage from '$lib/components/contacts/ContactsPage.svelte';
	import type { PageData, ActionData } from './$types.js';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head>
	<title>Contacts - Akaun</title>
</svelte:head>

<ContactsPage {data} {form} openId={null} />
