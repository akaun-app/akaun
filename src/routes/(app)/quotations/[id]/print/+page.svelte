<script lang="ts">
	import type { PageData } from './$types.js';
	import { onMount } from 'svelte';

	let { data }: { data: PageData } = $props();
	const quotation = $derived(data.quotation);
	const settings = $derived(data.settings);

	function fmt(n: number): string {
		return new Intl.NumberFormat('en-MY', {
			minimumFractionDigits: 2,
			maximumFractionDigits: 2
		}).format(n);
	}

	onMount(() => window.print());

	function formatDate(iso: string): string {
		if (!iso) return '';
		const [y, m, d] = iso.split('-');
		const months = [
			'January', 'February', 'March', 'April', 'May', 'June',
			'July', 'August', 'September', 'October', 'November', 'December'
		];
		return `${parseInt(d)} ${months[parseInt(m) - 1]} ${y}`;
	}
</script>

<svelte:head>
	<title>{quotation.quotationNumber} - Quotation</title>
</svelte:head>

<div class="page">
	<button class="no-print print-btn" onclick={() => window.print()}>Print</button>

	<header class="doc-header">
		<div class="brand">
			{#if settings.companyName}
				<div class="brand-name">{settings.companyName}</div>
				{#if settings.companyAddress}
					<div class="brand-address">{settings.companyAddress}</div>
				{/if}
				{#if settings.companyRegistrationNo}
					<div class="brand-regno">Reg. No: {settings.companyRegistrationNo}</div>
				{/if}
			{:else}
				<div class="brand-name">Akaun</div>
			{/if}
		</div>
		<div class="doc-meta">
			<div class="doc-type">QUOTATION</div>
			<div class="doc-number">{quotation.quotationNumber}</div>
		</div>
	</header>

	<div class="doc-info">
		<div class="doc-info-col">
			{#if quotation.contactName}
				<div class="info-section">
					<div class="info-label">Bill To</div>
					<div class="info-value">{quotation.contactName}</div>
				</div>
			{/if}
		</div>
		<div class="doc-info-col doc-info-right">
			<div class="info-section">
				<div class="info-label">Issue Date</div>
				<div class="info-value">{formatDate(quotation.issueDate)}</div>
			</div>
			{#if quotation.expiryDate}
				<div class="info-section">
					<div class="info-label">Valid Until</div>
					<div class="info-value">{formatDate(quotation.expiryDate)}</div>
				</div>
			{/if}
			{#if quotation.reference}
				<div class="info-section">
					<div class="info-label">Reference</div>
					<div class="info-value">{quotation.reference}</div>
				</div>
			{/if}
			<div class="info-section">
				<div class="info-label">Currency</div>
				<div class="info-value">{quotation.currency}</div>
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
			{#each quotation.lines as line}
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
				<td class="col-total">{fmt(quotation.subtotal)}</td>
			</tr>
			<tr class="tax-row">
				<td colspan="3" class="subtotal-label">Tax</td>
				<td class="col-total">{fmt(quotation.taxAmount)}</td>
			</tr>
			<tr class="total-row">
				<td colspan="3" class="total-label">Total ({quotation.currency})</td>
				<td class="col-total total-val">{fmt(quotation.total)}</td>
			</tr>
		</tfoot>
	</table>

	{#if quotation.notes}
		<div class="doc-section">
			<div class="section-label">Notes</div>
			<div class="section-text">{quotation.notes}</div>
		</div>
	{/if}

	{#if quotation.terms}
		<div class="doc-section">
			<div class="section-label">Terms &amp; Conditions</div>
			<div class="section-text">{quotation.terms}</div>
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

	.brand-name {
		font-size: 28px;
		font-weight: 700;
		letter-spacing: -0.03em;
		color: #111;
	}

	.brand-address {
		font-size: 13px;
		color: #555;
		margin-top: 4px;
		line-height: 1.4;
		white-space: pre-line;
	}

	.brand-regno {
		font-size: 12px;
		color: #777;
		margin-top: 4px;
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
