<script lang="ts">
	import { Trash2 } from '@lucide/svelte';

	type LineItem = { description: string; quantity: number; unitPrice: number };

	let {
		lines = $bindable([{ description: '', quantity: 1, unitPrice: 0 }]),
		disabled = false,
		currency = 'MYR'
	}: {
		lines?: LineItem[];
		disabled?: boolean;
		currency?: string;
	} = $props();

	function addLine() {
		lines = [...lines, { description: '', quantity: 1, unitPrice: 0 }];
	}

	function removeLine(i: number) {
		if (lines.length <= 1) return;
		lines = lines.filter((_, idx) => idx !== i);
	}

	const subtotal = $derived(lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0));

	function fmt(n: number): string {
		return new Intl.NumberFormat('en-MY', {
			minimumFractionDigits: 2,
			maximumFractionDigits: 2
		}).format(n);
	}
</script>

<div class="line-item-editor">
	<div class="lie-header">
		<span class="field-label lie-col-desc">Description</span>
		<span class="field-label lie-col-qty">Qty</span>
		<span class="field-label lie-col-price">Unit Price</span>
		<span class="field-label lie-col-total">Total</span>
		<span class="lie-col-remove"></span>
	</div>

	{#each lines as line, i}
		<div class="lie-row">
			<input
				type="text"
				class="form-input lie-col-desc"
				bind:value={line.description}
				placeholder="Item description"
				{disabled}
			/>
			<input
				type="number"
				class="form-input lie-col-qty"
				bind:value={line.quantity}
				min="0"
				step="1"
				{disabled}
			/>
			<input
				type="number"
				class="form-input lie-col-price"
				bind:value={line.unitPrice}
				min="0"
				step="0.01"
				{disabled}
			/>
			<span class="lie-col-total lie-total-cell">
				{fmt(line.quantity * line.unitPrice)}
			</span>
			<button
				type="button"
				class="lie-remove-btn"
				onclick={() => removeLine(i)}
				disabled={disabled || lines.length <= 1}
				title="Remove line"
				aria-label="Remove line"
			>
				<Trash2 size={14} />
			</button>
		</div>
	{/each}

	<div class="lie-footer">
		<button type="button" class="lie-add-btn" onclick={addLine} {disabled}>
			+ Add line
		</button>
		<div class="lie-subtotal">
			<span class="lie-subtotal-label">Subtotal:</span>
			<span class="lie-subtotal-value">{currency} {fmt(subtotal)}</span>
		</div>
	</div>
</div>

<style>
	.line-item-editor {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.lie-header,
	.lie-row {
		display: grid;
		grid-template-columns: 1fr 80px 110px 100px 32px;
		gap: 6px;
		align-items: center;
	}

	.lie-header {
		margin-bottom: 2px;
	}

	.lie-total-cell {
		font-size: 13px;
		color: var(--foreground);
		text-align: right;
		padding-right: 4px;
	}

	.lie-remove-btn {
		display: grid;
		place-items: center;
		width: 28px;
		height: 28px;
		border: none;
		background: none;
		color: var(--muted-foreground);
		cursor: pointer;
		border-radius: 6px;
		transition: background 0.15s, color 0.15s;
	}

	.lie-remove-btn:hover:not(:disabled) {
		background: var(--red-soft);
		color: var(--red);
	}

	.lie-remove-btn:disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}

	.lie-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-top: 6px;
	}

	.lie-add-btn {
		border: none;
		background: none;
		color: var(--primary);
		font-family: inherit;
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
		padding: 4px 0;
	}

	.lie-add-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.lie-subtotal {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 13px;
	}

	.lie-subtotal-label {
		color: var(--muted-foreground);
	}

	.lie-subtotal-value {
		font-weight: 600;
		color: var(--foreground);
	}
</style>
