<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import DetailPage from '$lib/components/ui/DetailPage.svelte';
	import InvoiceForm from './InvoiceForm.svelte';
	import type { getInvoice } from '$lib/server/queries/invoices.js';

	/** Writing an invoice, on its own page — see `InvoiceForm`. */
	type Invoice = NonNullable<ReturnType<typeof getInvoice>>;

	let formRef = $state<{
		submit: () => Promise<Invoice | null>;
		revert: () => void;
		blockedBy: () => string | null;
	} | null>(null);
	let dirty = $state(false);
	let saving = $state(false);
	let error = $state('');

	async function save() {
		const saved = await formRef?.submit();
		if (!saved) return;
		void goto(resolve('/(app)/invoices/[id]', { id: String(saved.id) }));
	}
</script>

<svelte:head><title>New invoice - Akaun</title></svelte:head>

<DetailPage
	backHref="/invoices"
	backLabel="Invoices"
	{dirty}
	{saving}
	saveLabel="Create invoice"
	onsave={save}
	onrevert={() => formRef?.revert()}
	dirtyNote={formRef?.blockedBy() ?? 'New invoice'}
>
	{#snippet hero()}
		<div class="detail-hero-eyebrow"><span>New</span></div>
		<h1 class="detail-hero-title">New invoice</h1>
		{#if error}<p class="hero-error">{error}</p>{/if}
	{/snippet}

	{#snippet main()}
		<InvoiceForm bind:this={formRef} bind:dirty bind:saving bind:error invoice={null} />
	{/snippet}
</DetailPage>

<style>
	.hero-error {
		background: var(--red-soft);
		color: var(--red);
		border-radius: 8px;
		padding: 8px 12px;
		font-size: 13px;
		margin: 8px 0 0;
	}
</style>
