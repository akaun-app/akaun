<script lang="ts">
	import { Trash2, X, Scale, ChevronRight } from '@lucide/svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import * as Sheet from '$lib/components/ui/sheet/index.js';
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
	import AuditTrail from '$lib/components/ui/AuditTrail.svelte';
	import AttachmentManager, {
		type Attachment
	} from '$lib/components/ui/AttachmentManager.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { useIsMobile } from '$lib/hooks/useIsMobile.svelte.js';
	import { formatMinor } from '$lib/format.js';
	import { mainCurrency, mainCurrencySymbol } from '$lib/currency-state.svelte.js';
	import { formatMoneyRM } from '$lib/format.js';
	import { CURRENCIES } from '$lib/currency.js';
	import { LedgerRecordKind } from '$lib/enums.js';
	import AccountSelect from './AccountSelect.svelte';
	import { isSharedOwedRole } from '$lib/components/accounts/display-sign.js';
	import {
		differenceMinor,
		sideMinor,
		whyNotSaveable,
		type SideDraft
	} from './journal-rules.js';
	import SettlementList, { type SettlementLink } from './SettlementList.svelte';
	import { statusLabelFor } from './record-status.js';
	import type { AccountView, RecordView } from '$lib/server/ledger/types.js';

	/**
	 * The one record detail and create/edit drawer.
	 *
	 * Every kind of record is shown through this — an expense, income, a
	 * transfer between two accounts you hold, a payment. A user should not be
	 * able to tell which screen they came from by looking at the drawer
	 * (CLAUDE.md § Drawer standard), and nothing here uses an accounting word
	 * (Principle VII, SC-010).
	 *
	 * Writes go through `/api/records`, and the list updates from the SSE event
	 * rather than from this component's response — one driver, no race.
	 */
	let {
		open = $bindable(false),
		record = null,
		accounts,
		categories,
		allAccounts = [],
		contacts = [],
		defaultAccountId = null,
		lastForeignCurrency = null,
		canChange = false,
		canDelete = false,
		canAdjust = false,
		onclose,
		onsaved,
		ondeleted,
		extra
	}: {
		open?: boolean;
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
		canDelete?: boolean;
		/** Free choice of account, and a third side (FR-031). */
		canAdjust?: boolean;
		onclose: () => void;
		onsaved?: (record: RecordView) => void;
		ondeleted?: (id: number) => void;
		/** Extra content for the body — the settlement list, a linked invoice. */
		extra?: import('svelte').Snippet<[RecordView]>;
	} = $props();

	const screen = useIsMobile();
	const isMobile = $derived(screen.current);
	const panelSide = $derived(isMobile ? 'bottom' : 'right');

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
	let attachments = $state<Attachment[]>([]);
	let settlementLinks = $state<SettlementLink[]>([]);
	let error = $state('');
	let saving = $state(false);
	let deleteDialogOpen = $state(false);

	/** Re-seeds the form whenever a different record opens the drawer. */
	$effect(() => {
		const source = record;
		if (!open) return;

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
			// simply has "Money we owe" as its paying side, which is exactly what
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
	});

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
				const res = await fetch(
					`/api/exchange-rate?from=${from}&to=${mainCurrency()}&date=${on}`
				);
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
	 * Everything about the open record that does not travel with it: the files
	 * attached to it, and the payments put against it.
	 *
	 * Keyed on the record's id rather than the record itself, because the parent
	 * hands over a fresh object every time the stream reports a change — without
	 * the guard, every live update would refetch both lists.
	 */
	let loadedForId = $state<number | null>(null);
	$effect(() => {
		const id = open ? (record?.id ?? null) : null;
		if (id === loadedForId) return;
		loadedForId = id;
		attachments = [];
		settlementLinks = [];
		if (id === null) return;
		void loadAttachments(id);
		void loadSettlements(id);
	});

	async function loadAttachments(id: number) {
		const res = await fetch(`/api/records/${id}/attachments`);
		if (!res.ok || loadedForId !== id) return;
		attachments = await res.json();
	}

	async function loadSettlements(id: number) {
		const res = await fetch(`/api/records/${id}/settlements`);
		if (!res.ok || loadedForId !== id) return;
		settlementLinks = (await res.json()).links ?? [];
	}

	/**
	 * Takes one payment back off this record (FR-017). The record's own paid
	 * figure comes back over the stream, so only the list is corrected here.
	 */
	async function undoPayment(link: SettlementLink) {
		error = '';
		const res = await fetch(`/api/settlements/${link.settlementId}`, { method: 'DELETE' });
		if (!res.ok) {
			const body = await res.json().catch(() => null);
			error = body?.reason ?? body?.error ?? 'That could not be taken back.';
			return;
		}
		settlementLinks = settlementLinks.filter((l) => l.settlementId !== link.settlementId);
	}

	const settlementsLabel = $derived(
		record?.kind === LedgerRecordKind.Payment ? 'What this paid off' : 'Payments against this'
	);


	/**
	 * What each side offers, before the full list is asked for.
	 *
	 * Money usually leaves a place it was being held and arrives at what it was
	 * for, or the other way round for a sale, so both shortlists carry both — the
	 * user is never asked which direction they are recording, only where the
	 * money came from and where it went. "Money we owe" and "Money owed to us"
	 * belong on the shortlist too: choosing one is how somebody records that
	 * another person paid, or that a customer has not yet (FR-008, FR-011).
	 */
	const sideChoices = $derived(
		[...accounts, ...categories]
			.filter((a, i, all) => all.findIndex((b) => b.id === a.id) === i)
	);

	// Money cannot move to the account it came from, so the destination never
	// offers the source. Clearing a destination the source has just become lets
	// AccountSelect pick the next one, rather than leaving a choice sitting in a
	// picker that no longer lists it.
	const toAccountChoices = $derived(sideChoices.filter((a) => a.id !== fromAccountId));
	$effect(() => {
		if (toAccountId !== null && toAccountId === fromAccountId) toAccountId = null;
	});

	/**
	 * What this record is called, once it exists.
	 *
	 * A new record has no kind yet — that is the whole point, it is derived from
	 * the two accounts when it is saved — so the title of a new one says what is
	 * being done rather than what it will turn out to be.
	 */
	const KIND_TITLES: Record<number, string> = {
		[LedgerRecordKind.Expense]: 'Purchase',
		[LedgerRecordKind.Income]: 'Sale',
		[LedgerRecordKind.Transfer]: 'Money moved',
		[LedgerRecordKind.Payment]: 'Payment',
		[LedgerRecordKind.OpeningBalance]: 'Starting balance',
		[LedgerRecordKind.InvoiceIssue]: 'Invoice',
		[LedgerRecordKind.Journal]: 'Adjustment'
	};

	const title = $derived(
		isNew ? 'New record' : (KIND_TITLES[record!.kind] ?? 'Record')
	);

	const eyebrow = $derived(record?.recordNumber ?? (isNew ? 'New' : 'Record'));

	/**
	 * A record created by issuing an invoice is read-only here (FR-013).
	 */
	const fromInvoice = $derived(record?.kind === LedgerRecordKind.InvoiceIssue);
	const readOnly = $derived(fromInvoice || locked || (!canChange && !isNew));

	/** A payment's sides are decided in the payment drawer, not restated here. */
	const isPayment = $derived(record?.kind === LedgerRecordKind.Payment);

	// --- The running difference, live (FR-010) -------------------------------
	// The two named sides always cancel — the builder fills them from the
	// record's own figure — so only the extra sides can push it away from zero.
	const roleOf = $derived((accountId: number) =>
		allAccounts.concat(sideChoices).find((a) => a.id === accountId)?.role
	);

	const typedAmount = $derived(
		isForeign ? parseFloat(foreignAmount || '0') : parseFloat(amount || '0')
	);

	const allSides = $derived.by((): SideDraft[] => {
		const main = Math.round(Math.abs(typedAmount || 0) * 100) / 100;
		return [
			{ key: -1, accountId: fromAccountId, direction: 'out' as const, amount: String(main) },
			{ key: -2, accountId: toAccountId, direction: 'in' as const, amount: String(main) },
			...extraSides
		];
	});

	const differenceLive = $derived(differenceMinor(allSides));

	/** Why this cannot be saved yet, in the words the server would use. */
	const blockedReason = $derived(
		extraSides.length > 0 ? whyNotSaveable(allSides, roleOf, contactId) : null
	);

	function addSide() {
		extraSides = [
			...extraSides,
			{ key: nextSideKey++, accountId: null, direction: 'out', amount: '' }
		];
	}

	function removeSide(key: number) {
		extraSides = extraSides.filter((side) => side.key !== key);
	}

	/**
	 * Whether either named side is a shared owed account.
	 *
	 * Choosing "Money we owe" as the paying side is how somebody records that
	 * another person paid for this, and choosing "Money owed to us" is how a sale
	 * not yet settled is recorded. Either way the record is owed to or by
	 * somebody, and saving it without saying who would leave a balance owed to
	 * nobody — so the same sentence the server refuses with is shown here first
	 * (FR-008, FR-011).
	 */
	const needsContact = $derived.by(() => {
		for (const id of [fromAccountId, toAccountId]) {
			if (id === null) continue;
			const role = roleOf(id);
			if (role !== undefined && isSharedOwedRole(role)) return true;
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
		// it covers are decided. This drawer only reads one back, so it never
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

	async function save(event: SubmitEvent) {
		event.preventDefault();
		if (saving) return;
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
			return;
		}
		onsaved?.(await res.json());
		onclose();
	}

	async function remove() {
		if (!record) return;
		error = '';
		const res = await fetch(`/api/records/${record.id}`, { method: 'DELETE' });
		if (!res.ok) {
			const body = await res.json().catch(() => null);
			error = body?.reason ?? body?.error ?? 'That could not be deleted.';
			return;
		}
		ondeleted?.(record.id);
		onclose();
	}
</script>

<Sheet.Root
	{open}
	onOpenChange={(o) => {
		if (!o) onclose();
	}}
>
	<Sheet.Portal>
		<Sheet.Overlay />
		<Sheet.Content
			side={panelSide}
			style={isMobile
				? 'height:100dvh; border-radius:0; border-top:none; display:flex; flex-direction:column; overflow:hidden; gap:0;'
				: 'width:500px; max-width:95vw; display:flex; flex-direction:column; overflow:hidden; gap:0;'}
		>
			<div
				style="display:flex; align-items:flex-start; justify-content:space-between; padding:22px 22px 16px; border-bottom:1px solid var(--border);"
			>
				<div>
					<div class="sheet-eyebrow">{eyebrow}</div>
					<div class="sheet-title-text">{title}</div>
				</div>
				<Sheet.Close class="sheet-close"><X size={16} /></Sheet.Close>
			</div>

			<form onsubmit={save} style="flex:1; display:flex; flex-direction:column; overflow:hidden;">
				<div style="flex:1; overflow-y:auto; padding:20px 22px;">
					{#if error}
						<div class="form-error">{error}</div>
					{/if}

					{#if record}
						<div class="detail-amount">{formatMinor(record.amountMinor)}</div>
						<!-- Moving money between two accounts you hold owes nobody anything,
						     so "paid" is not a state it can be in (FR-007). -->
						{#if record.kind !== LedgerRecordKind.Transfer}
							<div class="detail-statusrow">
								<StatusBadge status={statusLabelFor(record)} />
								{#if record.outstandingMinor > 0}
									<span class="outstanding">
										{formatMinor(record.outstandingMinor)} still owed
									</span>
								{/if}
							</div>
						{/if}
					{/if}

					{#if fromInvoice}
						<!-- A record with no everyday name of its own: it was created by
						     issuing an invoice, and it changes when that invoice does
						     (FR-013). -->
						<p class="locked-note">
							This record was created by issuing an invoice. Change it on the invoice
							instead.
						</p>
					{:else if locked}
						<p class="locked-note">{lockedReason}</p>
					{/if}

					<div class="field">
						<label class="field-label" for="rec-description">What was it for? *</label>
						<Input
							id="rec-description"
							bind:value={description}
							required
							maxlength={500}
							disabled={!canChange && !isNew}
							class="w-full"
						/>
					</div>

					<div class="field">
						<div class="amount-head">
							<label class="field-label" for="rec-amount">
								Amount ({isForeign ? entryCurrency : mainCurrencySymbol()}) *
							</label>
							{#if !locked && (canChange || isNew)}
								<button
									type="button"
									class="link-btn"
									onclick={() => {
										showForeign = !showForeign;
										if (!showForeign) {
											// Back to the main currency: the rate must go back to 1
											// too, or the amount would keep being converted by a
											// rate that no longer applies.
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

					{#if isForeign}
						<div class="field">
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
									Comes to {formatMoneyRM(convertedMain)}. Looked up for {date} and kept
									with the record, so it stays right when rates move.
								{:else}
									The rate on the record's own date. Change the date and it is looked
									up again.
								{/if}
							</p>
						</div>
					{/if}

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

					<!-- The two everyday questions, and the only two asked about accounts.
					     Which kind of record this is follows from the answers; nobody is
					     asked to classify their own bookkeeping (D-01, FR-006). -->
					<AccountSelect
						accounts={sideChoices}
						{allAccounts}
						{canAdjust}
						bind:value={fromAccountId}
						name="fromAccount"
						label="Money came from"
						{defaultAccountId}
						disabled={readOnly}
					/>

					{#if toAccountChoices.length === 0}
						<p class="locked-note">
							There is only one account to choose from, so there is nowhere for money to
							move to. Add another account first.
						</p>
					{:else}
						<AccountSelect
							accounts={toAccountChoices}
							{allAccounts}
							{canAdjust}
							bind:value={toAccountId}
							name="toAccount"
							label="Money went to"
							{defaultAccountId}
							disabled={readOnly}
						/>
					{/if}

					{#if needsContact}
						<!-- A side on a shared owed account is meaningless without saying
						     whose it is — the balance would be owed to nobody (FR-008). -->
						<div class="field">
							<label class="field-label" for="rec-contact">Who is it owed to, or by? *</label>
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
								<p class="hint">Say who this is owed to or by.</p>
							{/if}
						</div>
					{:else if contacts.length > 0}
						<div class="field">
							<label class="field-label" for="rec-contact">Who was it with?</label>
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

					<!-- More than two sides. Only with `adjustments`, and the server
					     refuses it regardless of what this hides (FR-010, FR-031c). -->
					{#if canAdjust && !readOnly}
						{#if extraSides.length > 0}
							<div class="sides">
								<div class="sides-head">
									<span>Other sides</span>
									<span class="sides-diff" class:sides-diff-off={differenceLive !== 0}>
										{differenceLive === 0
											? 'Balanced'
											: `${(Math.abs(differenceLive) / 100).toFixed(2)} out`}
									</span>
								</div>
								{#each extraSides as side (side.key)}
									<div class="side-row">
										<select bind:value={side.accountId} class="plain-select side-account">
											<option value={null} disabled>Choose an account</option>
											{#each allAccounts as account (account.id)}
												<option value={account.id}>{account.name}</option>
											{/each}
										</select>
										<select bind:value={side.direction} class="plain-select side-dir">
											<option value="out">out of</option>
											<option value="in">into</option>
										</select>
										<Input
											type="text"
											inputmode="decimal"
											bind:value={side.amount}
											placeholder="0.00"
											class="side-amount"
										/>
										<button
											type="button"
											class="side-remove"
											onclick={() => removeSide(side.key)}
											aria-label="Remove this side"
										>
											<X size={14} />
										</button>
									</div>
								{/each}
							</div>
						{/if}
						<button type="button" class="add-side" onclick={addSide}>
							+ Add another side
						</button>
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

					<div class="field">
						<label class="field-label" for="rec-remark">Remark</label>
						<Textarea
							id="rec-remark"
							bind:value={remark}
							rows={2}
							disabled={!canChange && !isNew}
							class="leading-relaxed"
						/>
					</div>

					{#if record}
						<!--
							Whether a bank line has been matched to this record. `locked`
							alone cannot say it: it stays quiet until the record is actually
							locked, and says nothing about one that is simply not cleared yet.

							Stated, not linked. Reconciling is reached from the account it
							belongs to, and a record touches two of them — there is no single
							account this could send the reader to, and the generic
							`/reconciliation` address it used to open no longer exists
							(FR-048, D-06).
						-->
						<div class="ob-card ob-card-static">
							<span class="ob-icon" class:cleared={record.reconciled}>
								<Scale size={15} />
							</span>
							<span class="ob-main">
								<span class="ob-title">
									{record.reconciled ? 'Matched to the bank' : 'Not matched to the bank yet'}
								</span>
								<span class="ob-sub">
									{record.reconciled
										? 'A line on a bank statement has been matched to this.'
										: 'No bank statement line has been matched to this yet.'}
								</span>
							</span>
						</div>
					{/if}

					{#if record && fromInvoice}
						<button
							type="button"
							class="related-link ob-card"
							onclick={() => goto(resolve('/(app)/invoices'))}
						>
							<span class="ob-icon"><Scale size={15} /></span>
							<span class="ob-main">
								<span class="ob-title">The invoice this came from</span>
								<span class="ob-sub">Issued invoices are changed on the invoice itself.</span>
							</span>
							<ChevronRight size={14} color="var(--muted-foreground)" />
						</button>
					{/if}

					{#if record}
						{#if extra}{@render extra(record)}{/if}
						{#if settlementLinks.length > 0}
							<div class="detail-section-label">{settlementsLabel}</div>
							<SettlementList
								links={settlementLinks}
								onundo={canDelete ? undoPayment : undefined}
							/>
						{/if}
						<AttachmentManager apiBase="/api/records/{record.id}" bind:attachments />
						<AuditTrail recordType="record" recordId={record.id} />
					{/if}
				</div>

				<div class="sheet-foot">
					{#if blockedReason}
						<div class="sheet-foot-note">{blockedReason}</div>
					{/if}
					{#if record && !record.paid && record.outstandingMinor > 0}
						<div class="sheet-foot-note">
							{formatMinor(record.outstandingMinor)} of this is still owed.
						</div>
					{/if}
					<div class="sheet-foot-actions">
						{#if record && canDelete}
							<button
								type="button"
								class="sheet-btn sheet-btn-delete"
								style="margin-right:auto;"
								disabled={locked}
								title={locked ? lockedReason : undefined}
								onclick={() => (deleteDialogOpen = true)}
							>
								<Trash2 size={14} /> Delete
							</button>
						{/if}
						<button type="button" class="sheet-btn" onclick={onclose}>Cancel</button>
						{#if (canChange || isNew) && !fromInvoice}
							<button
								type="submit"
								class="sheet-btn sheet-btn-primary"
								disabled={saving || rateMissing || blockedReason !== null}
								title={blockedReason ?? undefined}
							>
								{saving ? 'Saving…' : record ? 'Save changes' : 'Save'}
							</button>
						{/if}
					</div>
				</div>
			</form>
		</Sheet.Content>
	</Sheet.Portal>
</Sheet.Root>

<ConfirmDialog
	bind:open={deleteDialogOpen}
	title="Delete this record?"
	description="This removes it and both sides of it. It can't be undone."
	confirmLabel="Delete record"
	danger
	onConfirm={remove}
/>

<style>
	/* More than two sides — shown only with `adjustments`. */
	.sides {
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 10px;
		margin-bottom: 10px;
	}
	.sides-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 8px;
		font-size: 11.5px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--muted-foreground);
	}
	/* The running difference, live: the rule becomes something to watch rather
	   than something that rejects you at the end (FR-010). */
	.sides-diff {
		text-transform: none;
		letter-spacing: 0;
		color: var(--green);
	}
	.sides-diff-off {
		color: var(--red);
	}
	.side-row {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-bottom: 6px;
	}
	.side-account {
		flex: 1 1 auto;
		min-width: 0;
	}
	.side-dir {
		flex: 0 0 84px;
	}
	.side-remove {
		flex: 0 0 auto;
		display: grid;
		place-items: center;
		width: 28px;
		height: 28px;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--card);
		color: var(--muted-foreground);
		cursor: pointer;
	}
	.side-remove:hover {
		border-color: var(--red);
		color: var(--red);
	}
	.add-side {
		margin-bottom: 12px;
		padding: 0;
		border: none;
		background: none;
		color: var(--primary);
		font-family: inherit;
		font-size: 12.5px;
		font-weight: 500;
		cursor: pointer;
	}
	.add-side:hover {
		text-decoration: underline;
	}
	/* Relation-card shape lives in layout.css; only the spacing and the cleared
	   tint are this drawer's own. */
	.ob-card {
		margin-bottom: 16px;
	}
	/* Says what is true without pretending to be a way through to somewhere. */
	.ob-card-static {
		cursor: default;
	}

	.form-error {
		background: var(--red-soft);
		color: var(--red);
		border-radius: 8px;
		padding: 10px 14px;
		font-size: 13px;
		margin-bottom: 16px;
	}
	.locked-note {
		font-size: 12px;
		color: var(--muted-foreground);
		background: var(--accent);
		border-radius: 8px;
		padding: 10px 12px;
		margin: 0 0 18px;
		line-height: 1.5;
	}
	.outstanding {
		font-size: 12px;
		color: var(--muted-foreground);
	}
	.plain-select {
		width: 100%;
		height: 36px;
		padding: 0 10px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--card);
		color: var(--foreground);
		font-family: inherit;
		font-size: 13.5px;
	}
	.plain-select:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
	.ob-icon.cleared {
		background: var(--green-soft);
		color: var(--green);
	}
	.amount-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 10px;
	}
	.currency-row {
		display: flex;
		gap: 8px;
	}
	.currency-row .plain-select {
		width: auto;
		flex: 0 0 auto;
	}
</style>
