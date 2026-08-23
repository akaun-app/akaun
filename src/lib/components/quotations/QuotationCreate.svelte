<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import DetailPage from '$lib/components/ui/DetailPage.svelte';
	import QuotationForm from './QuotationForm.svelte';
	import type { getQuotation } from '$lib/server/queries/quotations.js';

	/** Writing a quotation, on its own page — see `QuotationForm`. */
	type Quotation = NonNullable<ReturnType<typeof getQuotation>>;

	let formRef = $state<{
		submit: () => Promise<Quotation | null>;
		revert: () => void;
		blockedBy: () => string | null;
	} | null>(null);
	let dirty = $state(false);
	let saving = $state(false);
	let error = $state('');

	async function save() {
		const saved = await formRef?.submit();
		if (!saved) return;
		void goto(resolve('/(app)/quotations/[id]', { id: String(saved.id) }));
	}
</script>

<svelte:head><title>New quotation - Akaun</title></svelte:head>

<DetailPage
	backHref="/quotations"
	backLabel="Quotations"
	{dirty}
	{saving}
	saveLabel="Create quotation"
	onsave={save}
	onrevert={() => formRef?.revert()}
	dirtyNote={formRef?.blockedBy() ?? 'New quotation'}
>
	{#snippet hero()}
		<div class="detail-hero-eyebrow"><span>New</span></div>
		<h1 class="detail-hero-title">New quotation</h1>
		{#if error}<p class="hero-error">{error}</p>{/if}
	{/snippet}

	{#snippet main()}
		<QuotationForm bind:this={formRef} bind:dirty bind:saving bind:error quotation={null} />
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
