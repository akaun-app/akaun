<script lang="ts">
	import type { PageData } from './$types.js';
	import { onMount } from 'svelte';

	let { data }: { data: PageData } = $props();
	const invoice = $derived(data.invoice);
	const settings = $derived(data.settings);

	function fmt(n: number): string {
		return new Intl.NumberFormat('en-MY', {
			minimumFractionDigits: 2,
			maximumFractionDigits: 2
		}).format(n);
	}

	function formatDate(iso: string): string {
		if (!iso) return '';
		const [y, m, d] = iso.split('-');
		const months = [
			'January', 'February', 'March', 'April', 'May', 'June',
			'July', 'August', 'September', 'October', 'November', 'December'
		];
		return `${parseInt(d)} ${months[parseInt(m) - 1]} ${y}`;
	}

	const today = new Date().toISOString().slice(0, 10);
	const isOverdue = $derived(
		!!invoice.dueDate && invoice.dueDate < today && invoice.isOverdue
	);

	onMount(() => window.print());
</script>

<svelte:head>
	<title>{invoice.invoiceNumber} - Invoice</title>
</svelte:head>

<div class="page">
	<button class="no-print print-btn" onclick={() => window.print()}>Print</button>

	<header class="doc-header">
		<div class="company-block">
			{#if settings.companyName}
				<div class="company-name">{settings.companyName}</div>
			{:else}
				<div class="company-name">Akaun</div>
			{/if}
			{#if settings.companyAddress}
				<div class="company-detail">{settings.companyAddress}</div>
			{/if}
			{#if settings.companyRegistrationNo}
				<div class="company-detail">Reg No: {settings.companyRegistrationNo}</div>
			{/if}
		</div>
		<div class="doc-meta">
			<div class="doc-type">INVOICE</div>
			<div class="doc-number">{invoice.invoiceNumber}</div>
		</div>
	</header>

	<div class="doc-info">
		<div class="doc-info-col">
			{#if invoice.contactName}
				<div class="info-section">
					<div class="info-label">Bill To</div>
					<div class="info-value">{invoice.contactName}</div>
				</div>
			{/if}
		</div>
		<div class="doc-info-col doc-info-right">
			<div class="info-section">
				<div class="info-label">Issue Date</div>
				<div class="info-value">{formatDate(invoice.issueDate)}</div>
			</div>
			{#if invoice.dueDate}
				<div class="info-section">
					<div class="info-label">Due Date</div>
					<div class="info-value" class:overdue={isOverdue}>
						{formatDate(invoice.dueDate)}
						{#if isOverdue}<span class="overdue-tag">OVERDUE</span>{/if}
					</div>
				</div>
			{/if}
			{#if invoice.reference}
				<div class="info-section">
					<div class="info-label">Reference</div>
					<div class="info-value">{invoice.reference}</div>
				</div>
			{/if}
			<div class="info-section">
				<div class="info-label">Currency</div>
				<div class="info-value">{invoice.currency}</div>
			</div>
		</div>
	</div>

	<table class="lines-table">
		<thead>
			<tr>
				<th class="col-desc">Description</th>
				<th class="col-qty">Qty</th>
				<th class="col-price">Unit Price</th>
				<th class="col-total">Total</th>
			</tr>
		</thead>
		<tbody>
			{#each invoice.lines as line (line.id)}
				<tr>
					<td class="col-desc">{line.description}</td>
					<td class="col-qty">{line.quantity}</td>
					<td class="col-price">{fmt(line.unitPrice)}</td>
					<td class="col-total">{fmt(line.lineTotal)}</td>
				</tr>
			{/each}
		</tbody>
		<tfoot>
			<tr class="subtotal-row">
				<td colspan="3" class="subtotal-label">Subtotal</td>
				<td class="col-total">{fmt(invoice.subtotal)}</td>
			</tr>
			<tr class="tax-row">
				<td colspan="3" class="subtotal-label">Tax</td>
				<td class="col-total">{fmt(invoice.taxAmount)}</td>
			</tr>
			<tr class="total-row">
				<td colspan="3" class="total-label">Total ({invoice.currency})</td>
				<td class="col-total total-val">{fmt(invoice.total)}</td>
			</tr>
		</tfoot>
	</table>

	{#if invoice.amountPaid > 0}
		<div class="doc-section paid-section">
			<div class="section-label">Payment</div>
			<div class="section-text">
				Amount Paid: {invoice.currency} {fmt(invoice.amountPaid)}
			</div>
		</div>
	{/if}

	{#if invoice.notes}
		<div class="doc-section">
			<div class="section-label">Notes</div>
			<div class="section-text">{invoice.notes}</div>
		</div>
	{/if}

	{#if invoice.terms}
		<div class="doc-section">
			<div class="section-label">Terms &amp; Conditions</div>
			<div class="section-text">{invoice.terms}</div>
		</div>
	{/if}
</div>

<style>
	@media print {
		@page { size: A4; margin: 20mm; }
		.no-print { display: none !important; }
	}

	*, *::before, *::after { box-sizing: border-box; }

	:global(body) {
		font-family: system-ui, -apple-system, sans-serif;
		color: #1a1a1a;
		background: #fff;
		margin: 0;
		padding: 0;
	}

	.page {
		max-width: 800px;
		margin: 0 auto;
		padding: 48px 40px;
		background: #fff;
	}

	.print-btn {
		display: block;
		margin-bottom: 24px;
		padding: 8px 20px;
		background: #111;
		color: #fff;
		border: none;
		border-radius: 6px;
		font-family: inherit;
		font-size: 14px;
		cursor: pointer;
	}

	.doc-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		margin-bottom: 40px;
		padding-bottom: 24px;
		border-bottom: 2px solid #111;
	}

	.company-block {
		flex: 1;
	}

	.company-name {
		font-size: 22px;
		font-weight: 700;
		letter-spacing: -0.02em;
		color: #111;
		margin-bottom: 4px;
	}

	.company-detail {
		font-size: 13px;
		color: #555;
		line-height: 1.5;
		white-space: pre-line;
	}

	.doc-type {
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: #666;
		text-align: right;
	}

	.doc-number {
		font-size: 22px;
		font-weight: 600;
		color: #111;
		text-align: right;
		margin-top: 4px;
	}

	.doc-info {
		display: flex;
		justify-content: space-between;
		gap: 40px;
		margin-bottom: 40px;
	}

	.doc-info-col { flex: 1; }
	.doc-info-right { text-align: right; flex: 0 0 auto; }

	.info-section { margin-bottom: 16px; }

	.info-label {
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #888;
		margin-bottom: 4px;
	}

	.info-value {
		font-size: 14px;
		color: #111;
		line-height: 1.5;
	}

	.info-value.overdue {
		color: #c0392b;
		font-weight: 600;
	}

	.overdue-tag {
		display: inline-block;
		margin-left: 6px;
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.06em;
		background: #fde8e8;
		color: #c0392b;
		padding: 1px 5px;
		border-radius: 3px;
	}

	.lines-table {
		width: 100%;
		border-collapse: collapse;
		margin-bottom: 8px;
	}

	.lines-table thead th {
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #888;
		padding: 8px 12px;
		border-bottom: 1px solid #e5e5e5;
		text-align: left;
	}

	.lines-table tbody td {
		font-size: 14px;
		padding: 12px 12px;
		border-bottom: 1px solid #f0f0f0;
		color: #1a1a1a;
		vertical-align: top;
	}

	.col-qty { text-align: center; width: 60px; }
	.col-price { text-align: right; width: 120px; }
	.col-total { text-align: right; width: 120px; }

	.lines-table tfoot td {
		padding: 10px 12px;
		font-size: 14px;
	}

	.subtotal-row td { border-top: 1px solid #e5e5e5; color: #666; }
	.subtotal-label { text-align: right; }

	.tax-row td { color: #666; }

	.total-row td { border-top: 2px solid #111; }
	.total-label { text-align: right; font-weight: 600; }

	.total-val {
		font-size: 18px;
		font-weight: 700;
		color: #111;
	}

	.doc-section {
		margin-top: 32px;
		padding-top: 24px;
		border-top: 1px solid #e5e5e5;
	}

	.paid-section {
		background: #f0fdf4;
		border: 1px solid #bbf7d0;
		border-radius: 6px;
		padding: 12px 16px;
		margin-top: 24px;
	}

	.paid-section .section-label {
		color: #166534;
	}

	.paid-section .section-text {
		color: #166534;
		font-weight: 600;
	}

	.section-label {
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #888;
		margin-bottom: 8px;
	}

	.section-text {
		font-size: 13px;
		color: #333;
		line-height: 1.6;
		white-space: pre-wrap;
	}
</style>
