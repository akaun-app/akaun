<script lang="ts">
	import ContactSelect from '$lib/components/ui/ContactSelect.svelte';
	import LineItemEditor from '$lib/components/ui/LineItemEditor.svelte';
	import DatePicker from '$lib/components/ui/date-picker/DatePicker.svelte';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { mainCurrency } from '$lib/currency-state.svelte.js';
	import { CURRENCIES } from '$lib/currency.js';
	import { EntityType, Role } from '$lib/enums.js';
	import type { getInvoice } from '$lib/server/queries/invoices.js';

	/**
	 * The fields that describe an invoice — nothing else.
	 *
	 * One definition, two frames: the create page at `/invoices/new`, and the
	 * editor on `/invoices/[id]`. The two used to be separate, field-for-field
	 * duplicate implementations — the same risk `RecordForm` exists to avoid for
	 * records, applied here for the same reason.
	 */
	type Invoice = NonNullable<ReturnType<typeof getInvoice>>;
	type LineInput = { description: string; quantity: number; unitPrice: number };

	let {
		invoice = null,
		// Write-only out-parameters: the frame around this form reads them to
		// decide whether to show a save bar and what to put on it.
		// eslint-disable-next-line no-useless-assignment
		dirty = $bindable(false),
		// eslint-disable-next-line no-useless-assignment
		saving = $bindable(false),
		// The hosting page shows this near the hero, not this form itself.
		// eslint-disable-next-line no-useless-assignment
		error = $bindable('')
	}: {
		invoice?: Invoice | null;
		dirty?: boolean;
		saving?: boolean;
		error?: string;
	} = $props();

	const isNew = $derived(invoice === null);
	const todayISO = () => new Date().toISOString().slice(0, 10);

	let issueDate = $state('');
	let dueDate = $state('');
	let contactId = $state<number | null>(null);
	let contactName = $state<string | null>(null);
	let currency = $state('');
	let exchangeRate = $state('1');
	let notes = $state('');
	let terms = $state('');
	let reference = $state('');
	let lines = $state<LineInput[]>([]);
	let rateFetching = $state(false);
	let rateError = $state('');

	let snapshot = $state('');
	function fingerprint(): string {
		return JSON.stringify([
			issueDate,
			dueDate,
			contactId,
			contactName,
			currency,
			exchangeRate,
			notes,
			terms,
			reference,
			lines
		]);
	}
	function seed(source: Invoice | null) {
		issueDate = source?.issueDate ?? todayISO();
		dueDate = source?.dueDate ?? '';
		contactId = source?.contactId ?? null;
		contactName = null;
		currency = source?.currency ?? mainCurrency();
		exchangeRate = source ? String(source.exchangeRate) : '1';
		notes = source?.notes ?? '';
		terms = source?.terms ?? '';
		reference = source?.reference ?? '';
		lines = source
			? source.lines.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice }))
			: [{ description: '', quantity: 1, unitPrice: 0 }];
		rateError = '';
		error = '';
		snapshot = fingerprint();
	}
	// Re-seeds if a different invoice ever arrives without a remount (keyed on
	// id, not the object, the same guard `RecordForm` uses).
	let seededId = $state<number | null | undefined>(undefined);
	$effect(() => {
		const id = invoice?.id ?? null;
		if (id === seededId) return;
		seededId = id;
		seed(invoice);
	});

	$effect(() => {
		dirty = snapshot !== '' && fingerprint() !== snapshot;
	});

	export function revert(): void {
		seed(invoice);
	}

	/**
	 * Looked up only while creating. An existing invoice keeps the rate it was
	 * written at — editing never re-fetches it behind the user's back.
	 */
	$effect(() => {
		if (!isNew) return;
		const cur = currency;
		const d = issueDate;
		if (cur === mainCurrency() || !d) {
			exchangeRate = '1';
			rateError = '';
			return;
		}
		rateFetching = true;
		rateError = '';
		const timer = setTimeout(async () => {
			try {
				const res = await fetch(`/api/exchange-rate?from=${cur}&to=${mainCurrency()}&date=${d}`);
				const json = await res.json();
				if (json.rate != null) exchangeRate = String(json.rate);
				else rateError = 'No rate found — enter manually';
			} catch {
				rateError = 'Could not fetch rate — enter manually';
			} finally {
				rateFetching = false;
			}
		}, 400);
		return () => clearTimeout(timer);
	});

	export function blockedBy(): string | null {
		if (!contactId && !contactName) return 'Choose a customer.';
		if (!lines.some((l) => l.description.trim())) return 'Add at least one line item.';
		return null;
	}

	export async function submit(): Promise<Invoice | null> {
		const reason = blockedBy();
		if (reason) {
			error = reason;
			return null;
		}
		saving = true;
		error = '';
		try {
			let resolvedContactId = contactId;
			if (!resolvedContactId && contactName) {
				const cr = await fetch('/api/contacts', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ entityType: EntityType.Business, legalName: contactName, roles: [Role.Customer] })
				});
				if (!cr.ok) {
					error = 'Failed to create contact — try again';
					return null;
				}
				resolvedContactId = (await cr.json()).id;
			}
			const res = await fetch(isNew ? '/api/invoices' : `/api/invoices/${invoice!.id}`, {
				method: isNew ? 'POST' : 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					issueDate,
					dueDate: dueDate || null,
					contactId: resolvedContactId,
					currency,
					exchangeRate: parseFloat(exchangeRate) || 1,
					notes: notes || null,
					terms: terms || null,
					reference: reference || null,
					lines
				})
			});
			if (!res.ok) {
				const body = await res.json().catch(() => null);
				error = body?.error ?? (isNew ? 'Failed to create invoice' : 'Save failed');
				return null;
			}
			const saved = await res.json();
			snapshot = fingerprint();
			return saved;
		} catch {
			error = 'Network error — try again';
			return null;
		} finally {
			saving = false;
		}
	}
</script>

<section class="detail-card">
	<div class="detail-card-head"><span class="detail-card-title">Invoice</span></div>

	<div class="field-grid field">
		<div>
			<label class="field-label" for="inv-issue-date">Issue date *</label>
			<DatePicker name="issueDate" bind:value={issueDate} />
		</div>
		<div>
			<label class="field-label" for="inv-due-date">Due date</label>
			<DatePicker name="dueDate" bind:value={dueDate} placeholder="No due date" />
		</div>
	</div>

	<div class="field">
		<label class="field-label" for="inv-customer">Customer</label>
		<ContactSelect
			role={Role.Customer}
			bind:value={contactId}
			bind:newName={contactName}
			placeholder="Search or select a customer…"
		/>
	</div>

	<div class="field-grid field">
		<div>
			<label class="field-label" for="inv-currency">Currency</label>
			<Select.Root type="single" bind:value={currency}>
				<Select.Trigger id="inv-currency" class="w-full">{currency}</Select.Trigger>
				<Select.Content>
					{#each CURRENCIES as c (c.code)}
						<Select.Item value={c.code} label={`${c.code} — ${c.name}`} />
					{/each}
				</Select.Content>
			</Select.Root>
		</div>
		{#if currency !== mainCurrency()}
			<div>
				<label class="field-label" for="inv-rate">Rate (1 {currency} = ? {mainCurrency()})</label>
				<Input
					id="inv-rate"
					type="text"
					inputmode="decimal"
					placeholder={isNew && rateFetching ? 'Fetching…' : '1.0'}
					disabled={isNew && rateFetching}
					bind:value={exchangeRate}
				/>
				{#if isNew && (rateFetching || rateError)}
					<p class="foreign-note">{rateFetching ? 'Fetching rate…' : rateError}</p>
				{/if}
			</div>
		{/if}
	</div>

	<div class="field" style="margin-bottom:0;">
		<label class="field-label" for="inv-reference">Reference</label>
		<Input id="inv-reference" type="text" placeholder="Optional reference…" bind:value={reference} />
	</div>
</section>

<section class="detail-card">
	<div class="detail-card-head"><span class="detail-card-title">Line items *</span></div>
	<LineItemEditor bind:lines currency={currency} />
</section>

<section class="detail-card">
	<div class="detail-card-head"><span class="detail-card-title">What the customer reads</span></div>
	<div class="field">
		<label class="field-label" for="inv-notes">Notes</label>
		<Textarea id="inv-notes" placeholder="Optional notes for the customer…" class="leading-relaxed" bind:value={notes} />
	</div>
	<div class="field" style="margin-bottom:0;">
		<label class="field-label" for="inv-terms">Terms &amp; conditions</label>
		<Textarea id="inv-terms" placeholder="Optional terms…" class="leading-relaxed" bind:value={terms} />
	</div>
</section>
