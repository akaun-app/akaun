<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import {
		Check,
		ChevronRight,
		FileText,
		Printer,
		Receipt,
		RotateCcw,
		Send,
		Trash2,
		Undo2,
		X
	} from '@lucide/svelte';
	import DetailPage from '$lib/components/ui/DetailPage.svelte';
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import AuditTrail from '$lib/components/ui/AuditTrail.svelte';
	import SalesDocForm from '$lib/components/sales/SalesDocForm.svelte';
	import SalesDocLines from '$lib/components/sales/SalesDocLines.svelte';
	import { mainCurrency, mainCurrencySymbol } from '$lib/currency-state.svelte.js';
	import { formatCurrencyAmount } from '$lib/currency.js';
	import { formatDate, formatMoney } from '$lib/format.js';
	import { QuotationStatus } from '$lib/enums.js';
	import { canConvert, quotationStatusKey } from '$lib/sales/status.js';
	import type { loadQuotationDetail } from '$lib/server/loaders/quotations.js';

	/** One quotation, on its own page — its line items are a table. */
	let {
		data,
		form
	}: {
		data: Awaited<ReturnType<typeof loadQuotationDetail>>;
		form: { error?: string } | null;
	} = $props();

	type Quotation = typeof data.quotation;

	let quotation = $derived<Quotation>(data.quotation);

	let isEditing = $state(false);
	let formRef = $state<{
		submit: () => Promise<Quotation | null>;
		revert: () => void;
		blockedBy: () => string | null;
	} | null>(null);
	let formDirty = $state(false);
	let saving = $state(false);
	let saveError = $state('');
	let converting = $state(false);
	let convertError = $state('');
	let statusSaving = $state(false);
	let statusError = $state('');
	let deleteDialogOpen = $state(false);
	let auditTrailRef = $state<{ refresh: () => Promise<void> } | null>(null);

	// Only actually dirty while the form is mounted: leaving edit mode discards
	// whatever the form held, the same way closing the drawer this replaced did.
	const dirty = $derived(isEditing && formDirty);

	/** Editing is allowed unless converted — the invoice is the record now. */
	const canEdit = $derived(data.perms.change && quotation.status !== QuotationStatus.Converted);
	const isConverted = $derived(quotation.status === QuotationStatus.Converted);

	type StatusName = 'draft' | 'sent' | 'accepted' | 'declined';
	type StatusMove = { to: StatusName; label: string; icon: typeof Send };

	/**
	 * The status moves each status offers. The server allows any move but into or
	 * out of Converted (`canSetQuotationStatus`); these are the ones worth a
	 * button. Expired is worked out from the date, so it offers what Draft or Sent
	 * does.
	 */
	const statusMoves = $derived.by((): StatusMove[] => {
		switch (quotation.status) {
			case QuotationStatus.Draft:
				return [
					{ to: 'sent', label: 'Mark as sent', icon: Send },
					{ to: 'accepted', label: 'Mark accepted', icon: Check }
				];
			case QuotationStatus.Sent:
				return [
					{ to: 'accepted', label: 'Mark accepted', icon: Check },
					{ to: 'declined', label: 'Mark declined', icon: X }
				];
			case QuotationStatus.Accepted:
				return [{ to: 'sent', label: 'Undo acceptance', icon: Undo2 }];
			case QuotationStatus.Declined:
				return [{ to: 'sent', label: 'Reopen', icon: RotateCcw }];
			default:
				return [];
		}
	});

	function startEdit() {
		saveError = '';
		isEditing = true;
	}

	async function saveEdit() {
		const saved = await formRef?.submit();
		if (saved) {
			quotation = saved;
			isEditing = false;
			void auditTrailRef?.refresh();
		}
	}

	async function setStatus(to: StatusName) {
		statusSaving = true;
		statusError = '';
		convertError = '';
		try {
			const res = await fetch(`/api/quotations/${quotation.id}/status`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ status: to })
			});
			if (!res.ok) {
				statusError =
					(await res.json().catch(() => ({}))).error ?? 'Could not change the status.';
				return;
			}
			quotation = await res.json();
			void auditTrailRef?.refresh();
		} catch {
			statusError = 'Network error — try again';
		} finally {
			statusSaving = false;
		}
	}

	async function convertToInvoice() {
		converting = true;
		convertError = '';
		statusError = '';
		const res = await fetch(`/api/quotations/${quotation.id}/convert`, { method: 'POST' });
		converting = false;
		if (!res.ok) {
			convertError = (await res.json().catch(() => ({}))).error ?? 'Could not convert this.';
			return;
		}
		const json = await res.json();
		void goto(resolve('/(app)/invoices/[id]', { id: String(json.invoice.id) }));
	}
</script>

<svelte:head><title>{quotation.quotationNumber} - Akaun</title></svelte:head>

<DetailPage
	backHref="/quotations"
	backLabel="Quotations"
	{dirty}
	{saving}
	saveLabel="Save"
	dirtyNote={formRef?.blockedBy() ?? 'Editing this quotation'}
	onsave={saveEdit}
	onrevert={() => (isEditing = false)}
>
	{#snippet actions()}
		{#if data.perms.delete}
			<button
				class="sheet-btn sheet-btn-delete"
				disabled={isConverted}
				title={isConverted ? 'Converted quotations cannot be deleted' : undefined}
				onclick={() => (deleteDialogOpen = true)}
			>
				<Trash2 size={14} /> Delete
			</button>
		{/if}
		<a
			href={resolve('/api/quotations/[id]/pdf', { id: String(quotation.id) })}
			target="_blank"
			class="sheet-btn print-btn"
		>
			<Printer size={14} /> Print
		</a>
		{#if data.perms.change && !isEditing}
			{#each statusMoves as move (move.to)}
				<button
					class="sheet-btn"
					onclick={() => setStatus(move.to)}
					disabled={statusSaving || converting}
				>
					<move.icon size={14} /> {move.label}
				</button>
			{/each}
		{/if}
		{#if data.perms.convert && canConvert(quotation) && !isEditing}
			<button
				class="sheet-btn"
				onclick={convertToInvoice}
				disabled={converting || statusSaving}
			>
				<FileText size={14} /> {converting ? 'Converting…' : 'Convert'}
			</button>
		{/if}
		{#if canEdit && !isEditing}
			<button class="sheet-btn sheet-btn-primary" onclick={startEdit}>Edit</button>
		{/if}
	{/snippet}

	{#snippet hero()}
		<div class="detail-hero-eyebrow">
			<span>{quotation.quotationNumber}</span>
			<span>·</span>
			<span>{formatDate(quotation.issueDate)}</span>
		</div>
		<h1 class="detail-hero-title">{quotation.contactName || 'Quotation'}</h1>
		<div class="detail-hero-figure">
			<span class="detail-hero-amount">
				{mainCurrencySymbol()}{formatMoney(quotation.mainAmount)}
			</span>
			<StatusBadge status={quotationStatusKey(quotation)} />
			{#if quotation.currency !== mainCurrency()}
				<span class="detail-hero-note">
					{quotation.currency}
					{formatCurrencyAmount(quotation.total, quotation.currency)} · rate {quotation.exchangeRate}
				</span>
			{/if}
		</div>
		{#if saveError || statusError || convertError || form?.error}
			<p class="hero-error">{saveError || statusError || convertError || form?.error}</p>
		{/if}
	{/snippet}

	{#snippet main()}
		{#if isEditing}
			<SalesDocForm
				bind:this={formRef}
				bind:dirty={formDirty}
				bind:saving
				bind:error={saveError}
				kind="quotation"
				doc={quotation}
			/>
		{:else}
			<SalesDocLines kind="quotation" doc={quotation} />
		{/if}
	{/snippet}

	{#snippet rail()}
		{#if quotation.convertedInvoiceId}
			<section class="detail-card">
				<div class="detail-card-head"><span class="detail-card-title">Became</span></div>
				<a
					class="related-link ob-card"
					href={resolve('/(app)/invoices/[id]', { id: String(quotation.convertedInvoiceId) })}
				>
					<span class="ob-icon"><Receipt size={15} /></span>
					<span class="ob-main">
						<span class="ob-title">Invoice</span>
						<span class="ob-sub">Converted from this quotation</span>
					</span>
					<ChevronRight size={14} color="var(--muted-foreground)" />
				</a>
			</section>
		{/if}

		<section class="detail-card">
			<div class="detail-card-head"><span class="detail-card-title">History</span></div>
			<AuditTrail bind:this={auditTrailRef} recordType="quotation" recordId={quotation.id} />
		</section>
	{/snippet}
</DetailPage>

<form method="POST" action="?/delete" use:enhance id="quotation-delete-form" hidden>
	<input type="hidden" name="id" value={quotation.id} />
</form>

<ConfirmDialog
	bind:open={deleteDialogOpen}
	title="Delete quotation {quotation.quotationNumber}?"
	description="This permanently deletes the quotation. It cannot be undone."
	confirmLabel="Delete"
	danger
	onConfirm={() =>
		(document.getElementById('quotation-delete-form') as HTMLFormElement)?.requestSubmit()}
/>

<style>
	.hero-error {
		background: var(--red-soft);
		color: var(--red);
		border-radius: 8px;
		padding: 8px 12px;
		font-size: 13px;
		margin: 8px 0 0;
	}
	.print-btn {
		text-decoration: none;
	}
</style>
