<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import DetailPage from '$lib/components/ui/DetailPage.svelte';
	import PaymentForm from '$lib/components/ledger/PaymentForm.svelte';
	import type { loadPaymentNew } from '$lib/server/loaders/records.js';
	import type { RecordView } from '$lib/server/ledger/types.js';

	/** Recording a payment or a receipt, on its own page — see `PaymentForm`. */
	let { data }: { data: Awaited<ReturnType<typeof loadPaymentNew>> } = $props();

	let formRef = $state<{
		submit: () => Promise<RecordView | null>;
		revert: () => void;
		blockedBy: () => string | null;
	} | null>(null);
	let dirty = $state(false);
	let saving = $state(false);
	let error = $state('');

	const title = $derived(data.direction === 'we-pay' ? 'Record a payment' : 'Record a receipt');

	async function save() {
		const saved = await formRef?.submit();
		if (!saved) return;
		void goto(resolve('/(app)/records/[id]', { id: String(saved.id) }));
	}
</script>

<svelte:head><title>{title} - Akaun</title></svelte:head>

<DetailPage
	backHref="/records"
	backLabel="Records"
	{dirty}
	{saving}
	saveLabel="Save"
	onsave={save}
	onrevert={() => formRef?.revert()}
	dirtyNote={formRef?.blockedBy() ?? 'Unsaved changes'}
>
	{#snippet hero()}
		<div class="detail-hero-eyebrow"><span>New</span></div>
		<h1 class="detail-hero-title">{title}</h1>
		{#if error}<p class="hero-error">{error}</p>{/if}
	{/snippet}

	{#snippet main()}
		<PaymentForm
			bind:this={formRef}
			bind:dirty
			bind:saving
			bind:error
			direction={data.direction}
			accounts={data.accounts}
			contacts={data.contacts}
			defaultAccountId={data.defaultAccountId}
			contactId={data.contactId}
		/>
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
