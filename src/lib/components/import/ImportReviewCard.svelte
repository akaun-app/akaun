<script lang="ts">
	import { Upload, Receipt, Check, AlertTriangle, ExternalLink } from '@lucide/svelte';
	import DatePicker from '$lib/components/ui/date-picker/DatePicker.svelte';
	import ContactSelect from '$lib/components/ui/ContactSelect.svelte';
	import ImportSourceAccountSelect from '$lib/components/import/ImportSourceAccountSelect.svelte';
	import ImportCategoryAccountSelect from '$lib/components/import/ImportCategoryAccountSelect.svelte';
	import AmountInput from '$lib/components/ui/AmountInput.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Role } from '$lib/enums.js';
	import { mainCurrency } from '$lib/currency-state.svelte.js';
	import { CURRENCIES, currencySymbol } from '$lib/currency.js';
	import {
		dupMessage,
		dupReasonsLabel,
		editedValue,
		formatMoney,
		reviewConverted,
		reviewCurrency,
		reviewIsForeign,
		reviewRateMissing,
		reviewRateText,
		sideIsIncome,
		targetChoices,
		type ReviewEdits,
		type ReviewOptions,
		type ReviewRow
	} from './review-card.js';

	/**
	 * The card where a person checks one proposed record before it is imported:
	 * a receipt on the import queue, or one item of a document read as several
	 * items, opened in place on the group's page (006 FR-017).
	 *
	 * The card holds no record of its own. The screen that shows it keeps the
	 * fields, the corrections and the two accounts, and is told of every change
	 * through the callbacks below. That is what lets one card serve both: a
	 * receipt keeps its corrections in the browser until it is confirmed, while
	 * an item saves each one on the server as it is made (`oncommit`).
	 */
	let {
		row,
		edits,
		sourceAccountId,
		targetAccountId,
		options,
		heading,
		headingHref,
		error = null,
		note = null,
		readonly = false,
		busy = false,
		onedit,
		oncommit,
		oncontact,
		oncurrency,
		onsource,
		ontarget,
		onconfirm,
		onskip
	}: {
		row: ReviewRow;
		edits: ReviewEdits;
		sourceAccountId: number | null;
		targetAccountId: number | null;
		options: ReviewOptions;
		/** The card's title: a receipt's file name, or what an item is. */
		heading: string;
		/** Opens the source file when given. */
		headingHref?: string;
		/** Why the last confirm was refused. */
		error?: string | null;
		/** Said in the footer in place of the count of edited fields. */
		note?: string | null;
		/** Shows the fields without letting them change, and no actions. */
		readonly?: boolean;
		/** A confirm or skip is on its way. */
		busy?: boolean;
		/** A field changed. Called on every keystroke. */
		onedit: (key: string, value: string | number) => void;
		/** The reviewer finished with a field (it lost focus, or a value was picked). */
		oncommit?: (key: string) => void;
		oncontact: (v: { value: number | null; newName: string | null }) => void;
		oncurrency: (code: string) => void;
		onsource: (value: number) => void;
		ontarget: (raw: string) => void;
		onconfirm: () => void;
		onskip: () => void;
	} = $props();

	// Raw in-progress text for the amount being typed into. Formatting (2
	// decimals) is only applied on blur, so reformatting mid-keystroke doesn't
	// fight the user's cursor/input.
	let amountDraft = $state<string | null>(null);

	const main = $derived(mainCurrency());
	const isIncome = $derived(sideIsIncome(row, options, sourceAccountId));
	const dup = $derived(!!row.duplicateOf);
	const currency = $derived(reviewCurrency(row, edits, main));
	const foreign = $derived(reviewIsForeign(row, edits, main));
	const rateText = $derived(reviewRateText(row, edits, main));
	const converted = $derived(reviewConverted(row, edits, main));
	const rateMissing = $derived(reviewRateMissing(row, edits, main));
	const accountMissing = $derived(sourceAccountId == null || targetAccountId == null);
	const numEdits = $derived(Object.keys(edits).filter((k) => k !== 'document_type').length);

	function value(key: string): string | number {
		return editedValue(row, edits, key, main);
	}

	function isEdited(key: string): boolean {
		return key in edits;
	}

	// While the user is typing, show their raw text instead of the reformatted
	// amount — otherwise every keystroke gets rounded to 2dp and stomps the
	// cursor mid-edit.
	function amountDisplay(): string {
		return amountDraft ?? formatMoney(value('amount') as number);
	}

	function onAmountInput(e: Event) {
		const raw = (e.target as HTMLInputElement).value;
		amountDraft = raw;
		const v = parseFloat(raw.replace(/,/g, ''));
		if (!isNaN(v)) onedit('amount', v);
	}

	function onAmountBlur() {
		amountDraft = null;
		oncommit?.('amount');
	}
</script>

<div class="review-card" class:is-dup={dup}>
	<!-- Header -->
	<div class="review-head">
		{#if headingHref}
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- the caller resolves the file URL; it opens outside the app in a new tab. -->
			<a href={headingHref} target="_blank" rel="noopener" class="review-file" aria-label="Open {heading}">
				<Receipt size={15} />
				{heading}
				<ExternalLink size={11} color="var(--muted-foreground)" />
			</a>
		{:else}
			<span class="review-file">
				<Receipt size={15} />
				{heading}
			</span>
		{/if}
		<div class="review-head-right">
			{#if dup}
				<span class="dup-badge">
					<AlertTriangle size={11} /> Duplicate · {row.duplicateConfidence}% · {dupReasonsLabel(row)}
				</span>
			{/if}
		</div>
	</div>

	<div class="review-detected">
		<Upload size={12} />
		AI classified this as {isIncome ? 'income' : 'an expense'} — change the category or edit any field before importing
	</div>

	<!-- Fields grid. A fieldset only so that a read-only card disables every
	     control inside it at once; it draws nothing of its own. -->
	<fieldset class="review-fieldset" disabled={readonly}>
		<div class="review-grid">
			<!-- Description -->
			<div class="rfield">
				<span class="rfield-label">
					Description
					{#if isEdited('item_name')}<span class="edited-tag">edited</span>{/if}
				</span>
				<input
					class="form-input rinput"
					value={value('item_name')}
					oninput={(e) => onedit('item_name', (e.target as HTMLInputElement).value)}
					onchange={() => oncommit?.('item_name')}
				/>
			</div>

			<!-- Contact (role follows the chosen category) -->
			<div class="rfield">
				<span class="rfield-label">
					Contact
					{#if isEdited('contactId') || isEdited('newContactName')}<span class="edited-tag">edited</span>{/if}
				</span>
				<ContactSelect
					role={isIncome ? Role.Customer : Role.Supplier}
					initialLabel={row.supplier}
					suggestions={row.matchCandidates}
					disabled={readonly}
					onChange={oncontact}
				/>
			</div>

			<!-- Amount (main currency; read-only & converted when foreign) -->
			<div class="rfield">
				<span class="rfield-label">
					Amount{foreign ? ` (${main})` : ''}
					{#if !foreign && isEdited('amount')}<span class="edited-tag">edited</span>{/if}
				</span>
				{#if foreign}
					<AmountInput wrapperClass="sm" readonly value={converted != null ? formatMoney(converted) : ''} />
				{:else}
					<AmountInput wrapperClass="sm" value={amountDisplay()} oninput={onAmountInput} onblur={onAmountBlur} />
				{/if}
			</div>

			<!-- Currency + exchange rate (auto-shown when a foreign currency is detected) -->
			<div class="rfield">
				<span class="rfield-label">Currency</span>
				<Select.Root type="single" value={currency} onValueChange={(v) => oncurrency(v)} disabled={readonly}>
					<Select.Trigger class="rinput w-full">{currency}</Select.Trigger>
					<Select.Content>
						{#each CURRENCIES as c (c.code)}
							<Select.Item value={c.code} label={`${c.code} — ${c.name}`} />
						{/each}
					</Select.Content>
				</Select.Root>
			</div>
			{#if foreign}
				<div class="rfield">
					<span class="rfield-label">
						Amount ({currency})
						{#if isEdited('amount')}<span class="edited-tag">edited</span>{/if}
					</span>
					<AmountInput
						wrapperClass="sm"
						prefix={currencySymbol(currency)}
						value={amountDisplay()}
						oninput={onAmountInput}
						onblur={onAmountBlur}
					/>
				</div>
				<div class="rfield">
					<span class="rfield-label">Rate (1 {currency} = ? {main})</span>
					<input
						class="form-input rinput"
						inputmode="decimal"
						placeholder="0.0000"
						value={rateText}
						oninput={(e) => onedit('exchangeRate', (e.target as HTMLInputElement).value)}
						onchange={() => oncommit?.('exchangeRate')}
					/>
					{#if converted == null}
						<span class="foreign-note">Enter the rate manually to convert to {main}.</span>
					{/if}
				</div>
			{/if}

			<!-- Source establishes direction; Target is then narrowed by policy. -->
			<div class="rfield">
				<span class="rfield-label">Source account</span>
				<ImportSourceAccountSelect
					accounts={options.allAccounts}
					payableAccountId={options.payableAccountId}
					value={sourceAccountId}
					incomeFirst={isIncome}
					onChange={onsource}
				/>
			</div>

			<div class="rfield">
				<span class="rfield-label">
					Target account
					{#if isEdited('category')}<span class="edited-tag">edited</span>{/if}
				</span>
				<ImportCategoryAccountSelect
					accounts={targetChoices(options, sourceAccountId)}
					value={targetAccountId}
					onChange={ontarget}
				/>
			</div>

			<!-- Date -->
			<div class="rfield">
				<span class="rfield-label">
					Date
					{#if isEdited('date')}<span class="edited-tag">edited</span>{/if}
				</span>
				<DatePicker
					value={value('date') as string}
					onchange={(v) => {
						onedit('date', v);
						oncommit?.('date');
					}}
				/>
			</div>

			<!-- Reference -->
			<div class="rfield">
				<span class="rfield-label">
					Reference
					{#if isEdited('reference')}<span class="edited-tag">edited</span>{/if}
				</span>
				<input
					class="form-input rinput"
					placeholder="—"
					value={value('reference')}
					oninput={(e) => onedit('reference', (e.target as HTMLInputElement).value)}
					onchange={() => oncommit?.('reference')}
				/>
			</div>
		</div>
	</fieldset>

	{#if dup}
		<div class="dup-note">
			{dupMessage(row)} Import only if this is a separate transaction.
		</div>
	{/if}

	{#if !readonly}
		<div class="review-actions">
			<span class="merge-note">
				{#if error}
					{error}
				{:else if accountMissing}
					Choose both the source and target account before importing it.
				{:else if !isIncome && sourceAccountId === options.payableAccountId}
					Marked as paid personally — owed to the contact above until reimbursed.
				{:else if note}
					{note}
				{:else if numEdits > 0}
					{numEdits} field{numEdits > 1 ? 's' : ''} edited — only these override the AI values
				{:else}
					Importing AI values as-is
				{/if}
			</span>
			<div class="review-actions-btns">
				<Button variant="ghost" size="sm" disabled={busy} onclick={onskip}>Skip</Button>
				<Button size="sm" disabled={busy || rateMissing || accountMissing} onclick={onconfirm}>
					<Check size={15} />
					{dup ? 'Import anyway' : 'Confirm & import'}
				</Button>
			</div>
		</div>
	{/if}
</div>

<style>
	/* A fieldset draws a border, padding and a minimum width by default. This one
	   only groups the fields so a read-only card can disable them together. */
	.review-fieldset {
		border: 0;
		padding: 0;
		margin: 0;
		min-width: 0;
	}

	/* AccountSelect brings its own .field markup — line it up with the review grid's
	   own fields so the account reads as one more field, not a transplant. */
	.review-grid :global(.field) {
		display: flex;
		flex-direction: column;
		gap: 5px;
		margin-bottom: 0;
	}
	.review-grid :global(.field-label) {
		font-size: 11.5px;
		color: var(--muted-foreground);
		font-weight: 500;
		margin-bottom: 0;
	}
	.review-grid :global(.account-select) {
		height: 34px;
	}
</style>
