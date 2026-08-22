<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { ChevronRight, FileText, Printer, Receipt, Trash2 } from '@lucide/svelte';
	import DetailPage from '$lib/components/ui/DetailPage.svelte';
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import AuditTrail from '$lib/components/ui/AuditTrail.svelte';
	import ContactSelect from '$lib/components/ui/ContactSelect.svelte';
	import LineItemEditor from '$lib/components/ui/LineItemEditor.svelte';
	import DatePicker from '$lib/components/ui/date-picker/DatePicker.svelte';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { mainCurrency, mainCurrencySymbol } from '$lib/currency-state.svelte.js';
	import { CURRENCIES, formatCurrencyAmount } from '$lib/currency.js';
	import { formatDate, formatMoney } from '$lib/format.js';
	import {
		EntityType,
		QuotationStatus,
		QuotationStatusLabels,
		Role
	} from '$lib/enums.js';
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
	let saving = $state(false);
	let saveError = $state('');
	let converting = $state(false);
	let convertError = $state('');
	let deleteDialogOpen = $state(false);
	let auditTrailRef = $state<{ refresh: () => Promise<void> } | null>(null);

	let editIssueDate = $state('');
	let editExpiryDate = $state('');
	let editContactId = $state<number | null>(null);
	let editContactName = $state<string | null>(null);
	let editCurrency = $state('');
	let editExchangeRate = $state('1');
	let editNotes = $state('');
	let editTerms = $state('');
	let editReference = $state('');
	let editLines = $state<{ description: string; quantity: number; unitPrice: number }[]>([]);

	/** Editing is allowed unless converted — the invoice is the record now. */
	const canEdit = $derived(data.perms.change && quotation.status !== QuotationStatus.Converted);
	const isConverted = $derived(quotation.status === QuotationStatus.Converted);

	function getStatusLabel(q: Quotation): string {
		if (q.isExpired) return 'Expired';
		return QuotationStatusLabels[q.status];
	}

	function startEdit() {
		editIssueDate = quotation.issueDate;
		editExpiryDate = quotation.expiryDate ?? '';
		editContactId = quotation.contactId;
		editContactName = null;
		editCurrency = quotation.currency;
		editExchangeRate = String(quotation.exchangeRate);
		editNotes = quotation.notes ?? '';
		editTerms = quotation.terms ?? '';
		editReference = quotation.reference ?? '';
		editLines = quotation.lines.map((l) => ({
			description: l.description,
			quantity: l.quantity,
			unitPrice: l.unitPrice
		}));
		saveError = '';
		isEditing = true;
	}

	async function saveEdit() {
		saving = true;
		saveError = '';
		try {
			// If the user typed a new contact name, create the contact first.
			let resolvedContactId = editContactId;
			if (!resolvedContactId && editContactName) {
				const cr = await fetch('/api/contacts', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						entityType: EntityType.Business,
						legalName: editContactName,
						roles: [Role.Customer]
					})
				});
				if (!cr.ok) {
					saveError = 'Failed to create contact — try again';
					saving = false;
					return;
				}
				resolvedContactId = (await cr.json()).id;
			}
			const res = await fetch(`/api/quotations/${quotation.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					issueDate: editIssueDate,
					expiryDate: editExpiryDate || null,
					contactId: resolvedContactId,
					currency: editCurrency,
					exchangeRate: parseFloat(editExchangeRate) || 1,
					notes: editNotes || null,
					terms: editTerms || null,
					reference: editReference || null,
					lines: editLines
				})
			});
			if (!res.ok) {
				const err = await res.json();
				saveError = err.error ?? 'Save failed';
			} else {
				quotation = await res.json();
				isEditing = false;
				void auditTrailRef?.refresh();
			}
		} catch {
			saveError = 'Network error — try again';
		} finally {
			saving = false;
		}
	}

	async function convertToInvoice() {
		converting = true;
		convertError = '';
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
	dirty={isEditing}
	{saving}
	saveLabel="Save"
	dirtyNote="Editing this quotation"
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
		{#if quotation.status === QuotationStatus.Accepted}
			<button class="sheet-btn" onclick={convertToInvoice} disabled={converting}>
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
			<StatusBadge status={getStatusLabel(quotation)} />
			{#if quotation.currency !== mainCurrency()}
				<span class="detail-hero-note">
					{quotation.currency}
					{formatCurrencyAmount(quotation.total, quotation.currency)} · rate {quotation.exchangeRate}
				</span>
			{/if}
		</div>
		{#if saveError || convertError || form?.error}
			<p class="hero-error">{saveError || convertError || form?.error}</p>
		{/if}
	{/snippet}

	{#snippet main()}
		{#if isEditing}
			<section class="detail-card">
				<div class="detail-card-head"><span class="detail-card-title">Quotation</span></div>

				<div class="field-grid field">
					<div>
						<label class="field-label" for="edit-issue-date">Issue date *</label>
						<DatePicker name="editIssueDate" bind:value={editIssueDate} />
					</div>
					<div>
						<label class="field-label" for="edit-expiry-date">Expiry date</label>
						<DatePicker name="editExpiryDate" bind:value={editExpiryDate} placeholder="No expiry" />
					</div>
				</div>

				<div class="field">
					<label class="field-label" for="edit-customer">Customer</label>
					<ContactSelect
						role={Role.Customer}
						bind:value={editContactId}
						bind:newName={editContactName}
						placeholder="Select customer…"
					/>
				</div>

				<div class="field-grid field">
					<div>
						<label class="field-label" for="editCurrency">Currency</label>
						<Select.Root type="single" bind:value={editCurrency}>
							<Select.Trigger id="editCurrency" class="w-full">{editCurrency}</Select.Trigger>
							<Select.Content>
								{#each CURRENCIES as c (c.code)}
									<Select.Item value={c.code} label={`${c.code} — ${c.name}`} />
								{/each}
							</Select.Content>
						</Select.Root>
					</div>
					{#if editCurrency !== mainCurrency()}
						<div>
							<label class="field-label" for="editRate">
								Rate (1 {editCurrency} = ? {mainCurrency()})
							</label>
							<Input
								id="editRate"
								type="text"
								inputmode="decimal"
								placeholder="1.0"
								bind:value={editExchangeRate}
							/>
						</div>
					{/if}
				</div>

				<div class="field" style="margin-bottom:0;">
					<label class="field-label" for="editReference">Reference</label>
					<Input
						id="editReference"
						type="text"
						placeholder="Optional reference…"
						bind:value={editReference}
					/>
				</div>
			</section>

			<section class="detail-card">
				<div class="detail-card-head"><span class="detail-card-title">Line items *</span></div>
				<LineItemEditor bind:lines={editLines} currency={editCurrency} />
			</section>

			<section class="detail-card">
				<div class="detail-card-head">
					<span class="detail-card-title">What the customer reads</span>
				</div>
				<div class="field">
					<label class="field-label" for="editNotes">Notes</label>
					<Textarea
						id="editNotes"
						placeholder="Optional notes for the customer…"
						class="leading-relaxed"
						bind:value={editNotes}
					/>
				</div>
				<div class="field" style="margin-bottom:0;">
					<label class="field-label" for="editTerms">Terms &amp; conditions</label>
					<Textarea
						id="editTerms"
						placeholder="Optional terms…"
						class="leading-relaxed"
						bind:value={editTerms}
					/>
				</div>
			</section>
		{:else}
			<section class="detail-card">
				<div class="detail-card-head"><span class="detail-card-title">Line items</span></div>
				{#if quotation.lines.length === 0}
					<p class="empty-note">This quotation has no line items yet.</p>
				{:else}
					<div class="lines-table">
						<div class="lines-head">
							<span>Description</span>
							<span class="ta-right">Qty</span>
							<span class="ta-right">Unit price</span>
							<span class="ta-right">Total</span>
						</div>
						{#each quotation.lines as line, i (i)}
							<div class="lines-row">
								<span class="line-desc">{line.description}</span>
								<span class="ta-right num">{line.quantity}</span>
								<span class="ta-right num">
									{formatCurrencyAmount(line.unitPrice, quotation.currency)}
								</span>
								<span class="ta-right num strong">
									{formatCurrencyAmount(line.lineTotal, quotation.currency)}
								</span>
							</div>
						{/each}
						<div class="lines-total">
							<span>Total</span>
							<span class="num strong">
								{quotation.currency}
								{formatCurrencyAmount(quotation.total, quotation.currency)}
							</span>
						</div>
					</div>
				{/if}
			</section>

			<section class="detail-card">
				<div class="detail-card-head"><span class="detail-card-title">Details</span></div>
				<div class="detail-list">
					{#if quotation.contactName}
						<div class="detail-row">
							<div class="detail-key">Customer</div>
							<div class="detail-val">{quotation.contactName}</div>
						</div>
					{/if}
					<div class="detail-row">
						<div class="detail-key">Issue date</div>
						<div class="detail-val num">{formatDate(quotation.issueDate)}</div>
					</div>
					{#if quotation.expiryDate}
						<div class="detail-row">
							<div class="detail-key">Expiry date</div>
							<div class="detail-val num">{formatDate(quotation.expiryDate)}</div>
						</div>
					{/if}
					{#if quotation.reference}
						<div class="detail-row">
							<div class="detail-key">Reference</div>
							<div class="detail-val num">{quotation.reference}</div>
						</div>
					{/if}
					{#if quotation.currency !== mainCurrency()}
						<div class="detail-row">
							<div class="detail-key">Currency</div>
							<div class="detail-val">{quotation.currency} (rate: {quotation.exchangeRate})</div>
						</div>
					{/if}
					{#if quotation.notes}
						<div class="detail-row">
							<div class="detail-key">Notes</div>
							<div class="detail-val prewrap">{quotation.notes}</div>
						</div>
					{/if}
					{#if quotation.terms}
						<div class="detail-row">
							<div class="detail-key">Terms</div>
							<div class="detail-val prewrap">{quotation.terms}</div>
						</div>
					{/if}
				</div>
			</section>
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
	.empty-note {
		font-size: 12.5px;
		color: var(--muted-foreground);
		margin: 0;
	}
	.lines-table {
		display: flex;
		flex-direction: column;
	}
	.lines-head,
	.lines-row,
	.lines-total {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 70px 120px 130px;
		gap: 12px;
		align-items: baseline;
	}
	.lines-head {
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--muted-foreground);
		padding-bottom: 8px;
		border-bottom: 1px solid var(--border);
	}
	.lines-row {
		padding: 10px 0;
		border-bottom: 1px solid var(--border);
		font-size: 13.5px;
	}
	.line-desc {
		min-width: 0;
	}
	.lines-total {
		grid-template-columns: minmax(0, 1fr) auto;
		padding-top: 12px;
		font-size: 13.5px;
		font-weight: 600;
	}
	.ta-right {
		text-align: right;
	}
	.strong {
		font-weight: 600;
	}
	.prewrap {
		white-space: pre-wrap;
	}

	@media (max-width: 767px) {
		.lines-head {
			display: none;
		}
		.lines-row {
			grid-template-columns: minmax(0, 1fr) auto;
			gap: 2px 12px;
		}
		.line-desc {
			grid-column: 1 / -1;
			font-weight: 500;
		}
	}
</style>
