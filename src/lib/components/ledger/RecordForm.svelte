<script lang="ts">
	import { Input } from '$lib/components/ui/input/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { mainCurrency, mainCurrencySymbol } from '$lib/currency-state.svelte.js';
	import { formatMoneyRM } from '$lib/format.js';
	import { CURRENCIES } from '$lib/currency.js';
	import { LedgerRecordKind } from '$lib/enums.js';
	import EntryBlock from './EntryBlock.svelte';
	// The running difference itself is drawn by `EntryBlock`, which owns the
	// lines it is computed from.
	import { sideMinor, whyNotSaveable, type SideDraft } from './journal-rules.js';
	import type { AccountView, RecordView } from '$lib/server/ledger/types.js';

	/**
	 * The fields that describe a record — nothing else.
	 *
	 * One definition, two frames: the create drawer on the Records list, and the
	 * editor on `/records/[id]`. When the fields lived inside the drawer, the
	 * page could only have had a second copy of them, and two copies of "which
	 * accounts may this side name" is two answers waiting to disagree.
	 *
	 * Writes go through `/api/records`. Nothing here uses an accounting word
	 * (Principle VII, SC-010).
	 */
	let {
		record = null,
		accounts,
		categories,
		allAccounts = [],
		contacts = [],
		defaultAccountId = null,
		lastForeignCurrency = null,
		canChange = false,
		canAdjust = false,
		onsaved,
		// Write-only out-parameters: the frame around this form reads them to
		// decide whether to show a save bar and what to put on it.
		// eslint-disable-next-line no-useless-assignment
		dirty = $bindable(false),
		saving = $bindable(false),
		error = $bindable('')
	}: {
		record?: RecordView | null;
		/** Every place money sits — what "which account?" offers. */
		accounts: AccountView[];
		/** The category accounts — what a record was for, either direction. */
		categories: AccountView[];
		/** Every account, for the full list a user with `adjustments` can reach. */
		allAccounts?: AccountView[];
		contacts?: { id: number; legalName: string }[];
		defaultAccountId?: number | null;
		/** The last foreign currency this user recorded in. */
		lastForeignCurrency?: string | null;
		canChange?: boolean;
		/** Free choice of account, and a third side (FR-031). */
		canAdjust?: boolean;
		onsaved?: (record: RecordView) => void;
		dirty?: boolean;
		saving?: boolean;
		error?: string;
	} = $props();

	const isNew = $derived(record === null);
	const locked = $derived(record?.locked ?? false);
	const lockedReason = $derived(record?.lockedReason ?? '');

	// --- Form state ---------------------------------------------------------
	let date = $state('');
	let description = $state('');
	let amount = $state('');
	let reference = $state('');
	let remark = $state('');
	let contactId = $state<number | null>(null);
	// The two everyday questions, and the only two the form asks about accounts:
	// which account the money left, and which it went to. The kind is derived
	// from them on the server and never picked here (D-01, FR-006).
	let fromAccountId = $state<number | null>(null);
	let toAccountId = $state<number | null>(null);
	// Third and later sides, shown only with `adjustments` (FR-010).
	let extraSides = $state<SideDraft[]>([]);
	let nextSideKey = 0;

	// --- Foreign currency, hidden until asked for --------------------------
	// A record keeps the amount exactly as it was typed, in the currency it was
	// typed in, plus the rate that applied on its date — locked at that point so
	// a historical figure never drifts when rates move (FR-005). Everything the
	// ledger totals is the converted value; this is what produces it.
	let showForeign = $state(false);
	let entryCurrency = $state('');
	let foreignAmount = $state('');
	let rate = $state('');
	let rateFetching = $state(false);
	let rateError = $state('');

	/** What the server last told us, so `dirty` has something to compare against. */
	let snapshot = $state('');

	function seed(source: RecordView | null) {
		date = source?.date ?? new Date().toISOString().slice(0, 10);
		description = source?.description ?? '';
		amount = source ? String(source.amount) : '';
		reference = source?.reference ?? '';
		remark = source?.remark ?? '';
		contactId = source?.contactId ?? null;
		error = '';

		// An existing record opens in the currency it was recorded in, at the rate
		// it was recorded at — never re-fetched behind the user's back, because
		// that rate is part of what the record says.
		const recordedCurrency = source?.currency ?? mainCurrency();
		showForeign = recordedCurrency !== mainCurrency();
		entryCurrency = showForeign ? recordedCurrency : (lastForeignCurrency ?? mainCurrency());
		rate = source ? String(source.exchangeRate) : '';
		foreignAmount = showForeign && source ? String(source.amount) : '';
		rateError = '';

		if (source) {
			// Value leaving an account is negative and value arriving is positive,
			// so the two sides name themselves — the same rule for every kind, with
			// no per-screen branch to get wrong. An expense somebody else paid
			// simply has Accounts Payable as its paying side, which is exactly what
			// the user picked to record it that way (FR-008).
			const into = source.movements.find((m) => m.amountMinor > 0);
			const outOf = source.movements.find((m) => m.amountMinor < 0);
			fromAccountId = outOf?.accountId ?? null;
			toAccountId = into?.accountId ?? null;

			// A record with more than two sides keeps the rest of them editable.
			const [, ...rest] = source.movements
				.filter((m) => m.accountId !== outOf?.accountId && m.accountId !== into?.accountId)
				.map((m) => m);
			extraSides = (rest.length ? rest : source.movements.slice(2)).map((m) => ({
				key: nextSideKey++,
				accountId: m.accountId,
				direction: m.amountMinor >= 0 ? ('in' as const) : ('out' as const),
				amount: (Math.abs(m.amountMinor) / 100).toFixed(2)
			}));
		} else {
			fromAccountId = null;
			toAccountId = null;
			extraSides = [];
		}
		snapshot = fingerprint();
	}

	/** Everything the user can change, as one comparable string. */
	function fingerprint(): string {
		return JSON.stringify([
			date,
			description,
			amount,
			foreignAmount,
			rate,
			entryCurrency,
			showForeign,
			reference,
			remark,
			contactId,
			fromAccountId,
			toAccountId,
			extraSides.map((s) => [s.accountId, s.direction, s.amount])
		]);
	}

	/**
	 * Re-seeds whenever a different record arrives.
	 *
	 * Keyed on the id, not the object: the stream hands over a fresh object every
	 * time anything about the record changes, and re-seeding on that would throw
	 * away whatever the user was in the middle of typing.
	 */
	let seededId = $state<number | null | undefined>(undefined);
	$effect(() => {
		const id = record?.id ?? null;
		if (id === seededId) return;
		seededId = id;
		seed(record);
	});

	$effect(() => {
		dirty = snapshot !== '' && fingerprint() !== snapshot;
	});

	export function revert(): void {
		seed(record);
	}

	const isForeign = $derived(showForeign && entryCurrency !== mainCurrency());

	/**
	 * Looks the rate up for the currency AND the date.
	 *
	 * The date matters as much as the currency: a purchase made in March is worth
	 * what March's rate said, not today's. So changing either re-queries, and the
	 * answer is only ever a starting point — the field stays editable, and a
	 * failed lookup leaves it blank with a hint rather than blocking the entry.
	 * Debounced, because both inputs change as the user types.
	 */
	$effect(() => {
		if (!isForeign || !date) return;
		const from = entryCurrency;
		const on = date;
		rateFetching = true;
		rateError = '';
		const timer = setTimeout(async () => {
			try {
				const res = await fetch(`/api/exchange-rate?from=${from}&to=${mainCurrency()}&date=${on}`);
				const body = await res.json();
				if (body.rate != null) {
					rate = String(body.rate);
				} else {
					rate = '';
					rateError = 'No rate found for that date — enter it yourself.';
				}
			} catch {
				rate = '';
				rateError = 'Could not look the rate up — enter it yourself.';
			} finally {
				rateFetching = false;
			}
		}, 400);
		return () => clearTimeout(timer);
	});

	/** What the foreign amount comes to in the main currency, at the rate shown. */
	const convertedMain = $derived.by(() => {
		const typed = parseFloat(foreignAmount);
		const r = parseFloat(rate);
		if (!isForeign || Number.isNaN(typed) || Number.isNaN(r) || r <= 0) return null;
		return typed * r;
	});

	/** A foreign entry cannot be saved without a rate to convert it by. */
	const rateMissing = $derived(isForeign && !(parseFloat(rate) > 0));

	/**
	 * What each side offers, before the full list is asked for.
	 *
	 * Money usually leaves a place it was being held and arrives at what it was
	 * for, or the other way round for a sale, so both shortlists carry both — the
	 * user is never asked which direction they are recording, only where the
	 * money came from and where it went. Accounts Payable and Accounts Receivable
	 * belong on the shortlist too: choosing one is how somebody records that
	 * another person paid, or that a customer has not yet (FR-008, FR-011).
	 */
	const sideChoices = $derived(
		[...accounts, ...categories].filter((a, i, all) => all.findIndex((b) => b.id === a.id) === i)
	);

	// Money cannot move to the account it came from, so the destination never
	// offers the source. Clearing a destination the source has just become lets
	// AccountSelect pick the next one, rather than leaving a choice sitting in a
	// picker that no longer lists it.
	const toAccountChoices = $derived(sideChoices.filter((a) => a.id !== fromAccountId));
	$effect(() => {
		if (toAccountId !== null && toAccountId === fromAccountId) toAccountId = null;
	});

	/** A record created by issuing an invoice is read-only here (FR-013). */
	const fromInvoice = $derived(record?.kind === LedgerRecordKind.InvoiceIssue);
	const readOnly = $derived(fromInvoice || locked || (!canChange && !isNew));

	/** A payment's sides are decided in the payment drawer, not restated here. */
	const isPayment = $derived(record?.kind === LedgerRecordKind.Payment);

	// --- The running difference, live (FR-010) -------------------------------
	// The two named sides always cancel — the builder fills them from the
	// record's own figure — so only the extra sides can push it away from zero.
	const requiresContact = $derived(
		(accountId: number) =>
			allAccounts.concat(sideChoices).find((a) => a.id === accountId)?.owedContactRequired ?? false
	);

	const typedAmount = $derived(
		isForeign ? parseFloat(foreignAmount || '0') : parseFloat(amount || '0')
	);

	/** The record's own figure in cents — what both named sides are worth. */
	const mainAmountMinor = $derived(Math.round(Math.abs(typedAmount || 0) * 100));

	const allSides = $derived.by((): SideDraft[] => {
		const main = (mainAmountMinor / 100).toFixed(2);
		return [
			{ key: -1, accountId: fromAccountId, direction: 'out' as const, amount: main },
			{ key: -2, accountId: toAccountId, direction: 'in' as const, amount: main },
			...extraSides
		];
	});

	/** Why this cannot be saved yet, in the words the server would use. */
	const blockedReason = $derived(
		extraSides.length > 0 ? whyNotSaveable(allSides, requiresContact, contactId) : null
	);

	/** What the frame around this form shows above its Save button. */
	export function blockedBy(): string | null {
		if (rateMissing) return 'Enter the exchange rate before saving.';
		return blockedReason;
	}

	function addSide() {
		extraSides = [...extraSides, { key: nextSideKey++, accountId: null, direction: 'out', amount: '' }];
	}

	function removeSide(key: number) {
		extraSides = extraSides.filter((side) => side.key !== key);
	}

	/**
	 * Whether either named side is a shared owed account.
	 *
	 * Choosing Accounts Payable as the paying side is how somebody records that
	 * another person paid for this, and choosing Accounts Receivable is how a sale
	 * not yet settled is recorded. Either way the record is owed to or by
	 * somebody, and saving it without saying who would leave a balance owed to
	 * nobody — so the same sentence the server refuses with is shown here first
	 * (FR-008, FR-011).
	 */
	const needsContact = $derived.by(() => {
		for (const id of [fromAccountId, toAccountId]) {
			if (id === null) continue;
			if (requiresContact(id)) return true;
		}
		return false;
	});

	/** The body the records API expects, in the everyday terms of this screen. */
	function payload() {
		// The record keeps what was actually typed — the foreign figure and its
		// currency — plus the rate that turns it into the main currency. The
		// ledger converts once, from these (FR-005).
		const base = {
			date,
			description,
			amount: isForeign ? parseFloat(foreignAmount || '0') : parseFloat(amount || '0'),
			currency: isForeign ? entryCurrency : mainCurrency(),
			exchangeRate: isForeign ? parseFloat(rate) : 1,
			reference,
			remark,
			contactId
		};
		// Two accounts and no kind. The server derives which of the seven shapes
		// this is from the two accounts named, and refuses with a plain sentence
		// if they do not make one (D-01, FR-009).
		return {
			...base,
			fromAccountId,
			toAccountId,
			...(extraSides.length > 0
				? {
						extraSides: extraSides.map((side) => ({
							accountId: side.accountId,
							amountMinor: sideMinor(side)
						}))
					}
				: {})
		};
	}

	/** The fields a patch may carry: everything on a free record, the rest on a locked one. */
	function patchPayload() {
		const everyday = { description, reference, remark, contactId };
		// A locked record refuses its amount, date and accounts, and a payment is
		// described by the payment drawer, which is where its direction and what
		// it covers are decided. This form only reads one back, so it never
		// tries to restate its sides (FR-012).
		if (locked || isPayment) return everyday;

		return {
			...everyday,
			date,
			amount: isForeign ? parseFloat(foreignAmount || '0') : parseFloat(amount || '0'),
			currency: isForeign ? entryCurrency : mainCurrency(),
			exchangeRate: isForeign ? parseFloat(rate) : 1,
			// Both accounts, so the server re-derives the kind: an expense whose
			// paying side becomes another bank account really is a transfer now.
			fromAccountId,
			toAccountId
		};
	}

	/** Saves, and reports whether it went through. The frame decides what to do next. */
	export async function submit(): Promise<RecordView | null> {
		if (saving) return null;
		saving = true;
		error = '';

		const res = await fetch(record ? `/api/records/${record.id}` : '/api/records', {
			method: record ? 'PATCH' : 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(record ? patchPayload() : payload())
		});

		saving = false;
		if (!res.ok) {
			const body = await res.json().catch(() => null);
			error = body?.reason ?? body?.error ?? 'That could not be saved.';
			return null;
		}
		const saved: RecordView = await res.json();
		snapshot = fingerprint();
		onsaved?.(saved);
		return saved;
	}
</script>

{#if error}
	<div class="form-error">{error}</div>
{/if}

{#if fromInvoice}
	<!-- A record with no everyday name of its own: it was created by issuing an
	     invoice, and it changes when that invoice does (FR-013). -->
	<p class="locked-note">
		This record was created by issuing an invoice. Change it on the invoice instead.
	</p>
{:else if locked}
	<p class="locked-note">{lockedReason}</p>
{/if}

<section class="detail-card">
	<div class="detail-card-head"><span class="detail-card-title">What happened</span></div>

	<div class="field">
		<label class="field-label" for="rec-description">Description *</label>
		<Input
			id="rec-description"
			bind:value={description}
			required
			maxlength={500}
			disabled={!canChange && !isNew}
			class="w-full"
		/>
	</div>

	<div class="field-grid">
		<div class="field">
			<div class="amount-head">
				<label class="field-label" for="rec-amount">
					Amount ({isForeign ? entryCurrency : mainCurrencySymbol()}) *
				</label>
			</div>

			{#if isForeign}
				<div class="currency-row">
					<select
						bind:value={entryCurrency}
						disabled={readOnly}
						class="plain-select"
						aria-label="Currency"
					>
						{#each CURRENCIES as c (c.code)}
							<option value={c.code}>{c.code} — {c.name}</option>
						{/each}
					</select>
					<Input
						id="rec-amount"
						type="number"
						step="0.01"
						bind:value={foreignAmount}
						required
						disabled={readOnly}
						class="w-full"
					/>
				</div>
			{:else}
				<Input
					id="rec-amount"
					type="number"
					step="0.01"
					bind:value={amount}
					required
					disabled={readOnly}
					class="w-full"
				/>
			{/if}
		</div>

		<div class="field">
			<label class="field-label" for="rec-date">Date *</label>
			<Input
				id="rec-date"
				type="date"
				bind:value={date}
				required
				disabled={readOnly}
				class="w-full"
			/>
		</div>
	</div>

	{#if !readOnly}
		<button
			type="button"
			class="detail-card-action"
			onclick={() => {
				showForeign = !showForeign;
				if (!showForeign) {
					// Back to the main currency: the rate must go back to 1 too, or the
					// amount would keep being converted by a rate that no longer applies.
					rate = '';
					rateError = '';
					foreignAmount = '';
				} else if (entryCurrency === mainCurrency()) {
					entryCurrency = lastForeignCurrency ?? '';
				}
			}}
		>
			{showForeign ? 'It was in ' + mainCurrency() : 'It was in another currency'}
		</button>
	{/if}

	{#if isForeign}
		<div class="field" style="margin-top:14px;">
			<label class="field-label" for="rec-rate">
				{mainCurrency()} per 1 {entryCurrency} *
			</label>
			<Input
				id="rec-rate"
				type="number"
				step="0.000001"
				bind:value={rate}
				required
				disabled={readOnly}
				class="w-full"
			/>
			<p class="field-hint">
				{#if rateFetching}
					Looking up the rate for {date}…
				{:else if rateError}
					{rateError}
				{:else if convertedMain != null}
					Comes to {formatMoneyRM(convertedMain)}. Looked up for {date} and kept with the
					record, so it stays right when rates move.
				{:else}
					The rate on the record's own date. Change the date and it is looked up again.
				{/if}
			</p>
		</div>
	{/if}
</section>

<!-- The two sides, and the rule that they cancel. -->
<EntryBlock
	bind:fromAccountId
	bind:toAccountId
	bind:extraSides
	{sideChoices}
	{toAccountChoices}
	{allAccounts}
	{canAdjust}
	{defaultAccountId}
	{readOnly}
	{mainAmountMinor}
	onaddside={addSide}
	onremoveside={removeSide}
/>

<section class="detail-card">
	<div class="detail-card-head"><span class="detail-card-title">Details</span></div>

	{#if needsContact}
		<!-- A side on a shared owed account is meaningless without saying whose it
		     is — the balance would be owed to nobody (FR-008). -->
		<div class="field">
			<label class="field-label" for="rec-contact">Contact *</label>
			<select
				id="rec-contact"
				bind:value={contactId}
				required
				disabled={!canChange && !isNew}
				class="plain-select"
			>
				<option value={null}>—</option>
				{#each contacts as contact (contact.id)}
					<option value={contact.id}>{contact.legalName}</option>
				{/each}
			</select>
			{#if contactId === null}
				<p class="field-hint">Name the customer or supplier this is owed to or by.</p>
			{/if}
		</div>
	{:else if contacts.length > 0}
		<div class="field">
			<label class="field-label" for="rec-contact">Contact</label>
			<select
				id="rec-contact"
				bind:value={contactId}
				disabled={!canChange && !isNew}
				class="plain-select"
			>
				<option value={null}>—</option>
				{#each contacts as contact (contact.id)}
					<option value={contact.id}>{contact.legalName}</option>
				{/each}
			</select>
		</div>
	{/if}

	<div class="field">
		<label class="field-label" for="rec-reference">Reference</label>
		<Input
			id="rec-reference"
			bind:value={reference}
			maxlength={200}
			disabled={!canChange && !isNew}
			class="w-full"
		/>
	</div>

	<div class="field" style="margin-bottom:0;">
		<label class="field-label" for="rec-remark">Remark</label>
		<Textarea
			id="rec-remark"
			bind:value={remark}
			rows={2}
			disabled={!canChange && !isNew}
			class="leading-relaxed"
		/>
	</div>
</section>

<style>
	.form-error {
		background: var(--red-soft);
		color: var(--red);
		border-radius: 8px;
		padding: 10px 12px;
		font-size: 13px;
		margin-bottom: 14px;
	}
	.locked-note {
		background: var(--muted);
		color: var(--muted-foreground);
		border-radius: 8px;
		padding: 10px 12px;
		font-size: 12.5px;
		line-height: 1.5;
		margin: 0 0 14px;
	}
	.amount-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.currency-row {
		display: grid;
		grid-template-columns: 150px minmax(0, 1fr);
		gap: 8px;
	}
</style>
