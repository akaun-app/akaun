<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { ChevronRight, FileText, Printer, Send, Trash2 } from '@lucide/svelte';
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
	import SettlementList from '$lib/components/ledger/SettlementList.svelte';
	import { mainCurrency, mainCurrencySymbol } from '$lib/currency-state.svelte.js';
	import { CURRENCIES, formatCurrencyAmount } from '$lib/currency.js';
	import { formatDate, formatMinor, formatMoney } from '$lib/format.js';
	import { EntityType, InvoiceStatus, Role } from '$lib/enums.js';
	import type { loadInvoiceDetail } from '$lib/server/loaders/invoices.js';

	/**
	 * One invoice, on its own page.
	 *
	 * Its line items are a table, and a table read column by column is the
	 * reason reports were already allowed to be full pages (CLAUDE.md). The
	 * invoice was the other thing in the app shaped like that, and it was in a
	 * 456px drawer.
	 */
	let {
		data,
		form
	}: {
		data: Awaited<ReturnType<typeof loadInvoiceDetail>>;
		form: { error?: string } | null;
	} = $props();

	type Invoice = typeof data.invoice;

	// Writable-derived: a fresh server load replaces it, and saving or sending
	// patches it in place from the response.
	let invoice = $derived<Invoice>(data.invoice);

	let isEditing = $state(false);
	let saving = $state(false);
	let saveError = $state('');
	let issuing = $state(false);
	let issueError = $state('');
	let deleteDialogOpen = $state(false);
	let issueConfirmOpen = $state(false);
	let auditTrailRef = $state<{ refresh: () => Promise<void> } | null>(null);

	// --- Edit fields --------------------------------------------------------
	let editIssueDate = $state('');
	let editDueDate = $state('');
	let editContactId = $state<number | null>(null);
	let editContactName = $state<string | null>(null);
	let editCurrency = $state('');
	let editExchangeRate = $state('1');
	let editNotes = $state('');
	let editTerms = $state('');
	let editReference = $state('');
	let editLines = $state<{ description: string; quantity: number; unitPrice: number }[]>([]);

	const isDraft = $derived(invoice.status === InvoiceStatus.Draft);
	const canEdit = $derived(data.perms.change && invoice.status !== InvoiceStatus.Cancelled);
	/** Only a draft can be sent, and only once — sending it twice would owe it twice. */
	const canIssue = $derived(isDraft && invoice.ledgerRecordId === null);
	/** A sent invoice is cancelled, never deleted — its amount is already in the books. */
	const deleteBlockedReason = $derived(
		invoice.ledgerRecordId === null
			? null
			: 'This invoice has been sent, so it cannot be deleted. Cancel it instead.'
	);

	function getStatusLabel(inv: Invoice): string {
		if (inv.status === InvoiceStatus.Cancelled) return 'Cancelled';
		if (inv.status === InvoiceStatus.Draft) return 'Draft';
		if (inv.paid) return 'Paid';
		if (inv.isOverdue) return 'Overdue';
		return 'Sent';
	}

	function startEdit() {
		editIssueDate = invoice.issueDate;
		editDueDate = invoice.dueDate ?? '';
		editContactId = invoice.contactId;
		editContactName = null;
		editCurrency = invoice.currency;
		editExchangeRate = String(invoice.exchangeRate);
		editNotes = invoice.notes ?? '';
		editTerms = invoice.terms ?? '';
		editReference = invoice.reference ?? '';
		editLines = invoice.lines.map((l) => ({
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
			const res = await fetch(`/api/invoices/${invoice.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					issueDate: editIssueDate,
					dueDate: editDueDate || null,
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
				invoice = await res.json();
				isEditing = false;
				void auditTrailRef?.refresh();
			}
		} catch {
			saveError = 'Network error — try again';
		} finally {
			saving = false;
		}
	}

	// Send the invoice: from here on the customer owes this amount, and any
	// payment they make settles it like any other debt (FR-018a).
	async function issue() {
		issuing = true;
		issueError = '';
		try {
			const res = await fetch(`/api/invoices/${invoice.id}/issue`, { method: 'POST' });
			if (!res.ok) {
				issueError = (await res.json().catch(() => ({}))).error ?? 'Could not send the invoice.';
				return;
			}
			invoice = await fetch(`/api/invoices/${invoice.id}`).then((r) => r.json());
			void auditTrailRef?.refresh();
		} catch {
			issueError = 'Network error — try again';
		} finally {
			issuing = false;
		}
	}
</script>

<svelte:head><title>{invoice.invoiceNumber} - Akaun</title></svelte:head>

<DetailPage
	backHref="/invoices"
	backLabel="Invoices"
	dirty={isEditing}
	{saving}
	saveLabel="Save"
	dirtyNote="Editing this invoice"
	onsave={saveEdit}
	onrevert={() => (isEditing = false)}
>
	{#snippet actions()}
		{#if data.perms.delete}
			<button
				class="sheet-btn sheet-btn-delete"
				disabled={!!deleteBlockedReason}
				title={deleteBlockedReason ?? undefined}
				onclick={() => (deleteDialogOpen = true)}
			>
				<Trash2 size={14} /> Delete
			</button>
		{/if}
		<a
			href={resolve('/api/invoices/[id]/pdf', { id: String(invoice.id) })}
			target="_blank"
			class="sheet-btn print-btn"
		>
			<Printer size={14} /> Print
		</a>
		{#if canIssue}
			<button class="sheet-btn" onclick={() => (issueConfirmOpen = true)} disabled={issuing}>
				<Send size={14} /> {issuing ? 'Sending…' : 'Send'}
			</button>
		{/if}
		{#if canEdit && !isEditing}
			<button class="sheet-btn sheet-btn-primary" onclick={startEdit}>Edit</button>
		{/if}
	{/snippet}

	{#snippet hero()}
		<div class="detail-hero-eyebrow">
			<span>{invoice.invoiceNumber}</span>
			<span>·</span>
			<span>{formatDate(invoice.issueDate)}</span>
		</div>
		<h1 class="detail-hero-title">{invoice.contactName || 'Invoice'}</h1>
		<div class="detail-hero-figure">
			<span class="detail-hero-amount">
				{mainCurrencySymbol()}{formatMoney(invoice.mainAmount)}
			</span>
			<StatusBadge status={getStatusLabel(invoice)} />
			{#if invoice.currency !== mainCurrency()}
				<span class="detail-hero-note">
					{invoice.currency}
					{formatCurrencyAmount(invoice.total, invoice.currency)} · rate {invoice.exchangeRate}
				</span>
			{/if}
		</div>
		{#if issueError || saveError || form?.error}
			<p class="hero-error">{issueError || saveError || form?.error}</p>
		{/if}
	{/snippet}

	{#snippet main()}
		{#if isEditing}
			<section class="detail-card">
				<div class="detail-card-head"><span class="detail-card-title">Invoice</span></div>

				<div class="field-grid field">
					<div>
						<label class="field-label" for="edit-issue-date">Issue date *</label>
						<DatePicker name="editIssueDate" bind:value={editIssueDate} />
					</div>
					<div>
						<label class="field-label" for="edit-due-date">Due date</label>
						<DatePicker name="editDueDate" bind:value={editDueDate} placeholder="No due date" />
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
				<div class="detail-card-head"><span class="detail-card-title">What the customer reads</span></div>
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
				{#if invoice.lines.length === 0}
					<p class="empty-note">This invoice has no line items yet.</p>
				{:else}
					<div class="lines-table">
						<div class="lines-head">
							<span>Description</span>
							<span class="ta-right">Qty</span>
							<span class="ta-right">Unit price</span>
							<span class="ta-right">Total</span>
						</div>
						{#each invoice.lines as line, i (i)}
							<div class="lines-row">
								<span class="line-desc">{line.description}</span>
								<span class="ta-right num">{line.quantity}</span>
								<span class="ta-right num">
									{formatCurrencyAmount(line.unitPrice, invoice.currency)}
								</span>
								<span class="ta-right num strong">
									{formatCurrencyAmount(line.lineTotal, invoice.currency)}
								</span>
							</div>
						{/each}
						<div class="lines-total">
							<span>Total</span>
							<span class="num strong">
								{invoice.currency}
								{formatCurrencyAmount(invoice.total, invoice.currency)}
							</span>
						</div>
					</div>
				{/if}
			</section>

			<section class="detail-card">
				<div class="detail-card-head"><span class="detail-card-title">Details</span></div>
				<div class="detail-list">
					{#if invoice.contactName}
						<div class="detail-row">
							<div class="detail-key">Customer</div>
							<div class="detail-val">{invoice.contactName}</div>
						</div>
					{/if}
					<div class="detail-row">
						<div class="detail-key">Issue date</div>
						<div class="detail-val num">{formatDate(invoice.issueDate)}</div>
					</div>
					{#if invoice.dueDate}
						<div class="detail-row">
							<div class="detail-key">Due date</div>
							<div class="detail-val num" class:overdue={invoice.isOverdue}>
								{formatDate(invoice.dueDate)}
								{#if invoice.isOverdue}<span class="overdue-flag">OVERDUE</span>{/if}
							</div>
						</div>
					{/if}
					{#if invoice.reference}
						<div class="detail-row">
							<div class="detail-key">Reference</div>
							<div class="detail-val num">{invoice.reference}</div>
						</div>
					{/if}
					{#if invoice.currency !== mainCurrency()}
						<div class="detail-row">
							<div class="detail-key">Currency</div>
							<div class="detail-val">{invoice.currency} (rate: {invoice.exchangeRate})</div>
						</div>
					{/if}
					{#if invoice.notes}
						<div class="detail-row">
							<div class="detail-key">Notes</div>
							<div class="detail-val prewrap">{invoice.notes}</div>
						</div>
					{/if}
					{#if invoice.terms}
						<div class="detail-row">
							<div class="detail-key">Terms</div>
							<div class="detail-val prewrap">{invoice.terms}</div>
						</div>
					{/if}
				</div>
			</section>
		{/if}
	{/snippet}

	{#snippet rail()}
		<!-- How much has come in, once the invoice has been sent (D-10) -->
		{#if invoice.ledgerRecordId !== null}
			<section class="detail-card">
				<div class="detail-card-head"><span class="detail-card-title">Settled</span></div>
				<div class="detail-list">
					<div class="detail-row">
						<div class="detail-key">Paid so far</div>
						<div class="detail-val num">{formatMinor(invoice.paidMinor)}</div>
					</div>
					<div class="detail-row">
						<div class="detail-key">Outstanding</div>
						<div class="detail-val num" class:strong={invoice.outstandingMinor > 0}>
							{formatMinor(invoice.outstandingMinor)}
						</div>
					</div>
				</div>
			</section>
		{/if}

		<!-- The payments that settled it (FR-018a) -->
		{#if invoice.settlements.length > 0}
			<section class="detail-card">
				<div class="detail-card-head"><span class="detail-card-title">Payments</span></div>
				<SettlementList links={invoice.settlements} />
			</section>
		{/if}

		{#if invoice.sourceQuotationId}
			<section class="detail-card">
				<div class="detail-card-head"><span class="detail-card-title">Came from</span></div>
				<a
					class="related-link ob-card"
					href={resolve('/(app)/quotations/[id]', { id: String(invoice.sourceQuotationId) })}
				>
					<span class="ob-icon"><FileText size={15} /></span>
					<span class="ob-main">
						<span class="ob-title">Source quotation</span>
						<span class="ob-sub">The quotation this invoice was made from</span>
					</span>
					<ChevronRight size={14} color="var(--muted-foreground)" />
				</a>
			</section>
		{/if}

		<section class="detail-card">
			<div class="detail-card-head"><span class="detail-card-title">History</span></div>
			<AuditTrail bind:this={auditTrailRef} recordType="invoice" recordId={invoice.id} />
		</section>
	{/snippet}
</DetailPage>

<form method="POST" action="?/delete" use:enhance id="invoice-delete-form" hidden>
	<input type="hidden" name="id" value={invoice.id} />
</form>

<ConfirmDialog
	bind:open={deleteDialogOpen}
	title="Delete invoice {invoice.invoiceNumber}?"
	description="This removes the invoice. It is only possible while it has not been sent."
	confirmLabel="Delete"
	danger
	onConfirm={() =>
		(document.getElementById('invoice-delete-form') as HTMLFormElement)?.requestSubmit()}
/>

<ConfirmDialog
	bind:open={issueConfirmOpen}
	title="Send invoice {invoice.invoiceNumber}?"
	description="From here on the customer owes this amount, and it appears in the books. A sent invoice can be cancelled but not deleted."
	confirmLabel="Send"
	onConfirm={issue}
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
	/* The line items, as the table they are. This is what the drawer could not
	   hold: four columns in 456px meant the description was the only one that
	   could be read. */
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
	.overdue {
		color: var(--red);
		font-weight: 600;
	}
	.overdue-flag {
		font-size: 11px;
		margin-left: 4px;
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
