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
	type Kind = 'expense' | 'income' | 'transfer' | 'payment';

	let {
		open = $bindable(false),
		record = null,
		kind,
		accounts,
		categories,
		contacts = [],
		defaultAccountId = null,
		lastForeignCurrency = null,
		canChange = false,
		canDelete = false,
		onclose,
		onsaved,
		ondeleted,
		extra
	}: {
		open?: boolean;
		record?: RecordView | null;
		kind: Kind;
		/** Every place money sits — what "which account?" offers. */
		accounts: AccountView[];
		/** The category accounts this screen offers. */
		categories: AccountView[];
		contacts?: { id: number; legalName: string }[];
		defaultAccountId?: number | null;
		/** The last foreign currency this user recorded in, on this screen. */
		lastForeignCurrency?: string | null;
		canChange?: boolean;
		canDelete?: boolean;
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
	let categoryAccountId = $state<number | null>(null);
	let moneyAccountId = $state<number | null>(null);
	let toAccountId = $state<number | null>(null);
	let someoneElsePaid = $state(false);

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
			const into = source.movements.find((m) => m.amountMinor > 0);
			const outOf = source.movements.find((m) => m.amountMinor < 0);
			if (kind === 'income') {
				categoryAccountId = outOf?.accountId ?? null;
				moneyAccountId = into?.accountId ?? null;
			} else if (kind === 'transfer') {
				moneyAccountId = outOf?.accountId ?? null;
				toAccountId = into?.accountId ?? null;
			} else {
				categoryAccountId = into?.accountId ?? null;
				someoneElsePaid = source.outstandingMinor > 0 || !source.paid;
				moneyAccountId = someoneElsePaid ? null : (outOf?.accountId ?? null);
			}
		} else {
			categoryAccountId = null;
			moneyAccountId = null;
			toAccountId = null;
			someoneElsePaid = false;
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

	// Money cannot move to the account it came from, so the destination never
	// offers the source. Clearing a destination the source has just become lets
	// AccountSelect pick the next one, rather than leaving a choice sitting in a
	// picker that no longer lists it.
	const toAccountChoices = $derived(
		kind === 'transfer' ? accounts.filter((a) => a.id !== moneyAccountId) : accounts
	);
	$effect(() => {
		if (kind !== 'transfer') return;
		if (toAccountId !== null && toAccountId === moneyAccountId) toAccountId = null;
	});

	const title = $derived.by(() => {
		if (kind === 'transfer') return isNew ? 'Move money' : 'Money moved';
		if (kind === 'payment') return isNew ? 'Record a payment' : 'Payment';
		if (kind === 'income') return isNew ? 'Add income' : 'Income';
		return isNew ? 'Add expense' : 'Expense';
	});

	const eyebrow = $derived(record?.recordNumber ?? (isNew ? 'New' : 'Record'));

	const moneyLabel = $derived(
		kind === 'income'
			? 'Received into'
			: kind === 'transfer'
				? 'Moved from'
				: 'Paid from'
	);

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
		if (kind === 'income') {
			return {
				...base,
				kind: 'income',
				categoryAccountId,
				receivedIntoAccountId: moneyAccountId
			};
		}
		if (kind === 'transfer') {
			return {
				...base,
				kind: 'transfer',
				fromAccountId: moneyAccountId,
				toAccountId
			};
		}
		return {
			...base,
			kind: 'expense',
			categoryAccountId,
			paidFromAccountId: someoneElsePaid ? null : moneyAccountId
		};
	}

	/** The fields a patch may carry: everything on a free record, the rest on a locked one. */
	function patchPayload() {
		const everyday = { description, reference, remark, contactId };
		// A payment is described by the payment drawer, which is where its
		// direction and what it covers are decided. This drawer only reads one
		// back, so it never tries to restate its sides.
		if (locked || kind === 'payment') return everyday;

		// Built from the same locals `payload()` reads, branching on `kind` — the
		// prop, whose type is narrow. Picking the fields back out of what
		// `payload()` returned instead would mean narrowing a union whose `kind`
		// has already widened to `string`, which is not something the compiler can
		// do and not something a reader should have to.
		const money = {
			date,
			amount: isForeign ? parseFloat(foreignAmount || '0') : parseFloat(amount || '0'),
			currency: isForeign ? entryCurrency : mainCurrency(),
			exchangeRate: isForeign ? parseFloat(rate) : 1
		};

		if (kind === 'income') {
			return {
				...everyday,
				...money,
				categoryAccountId,
				receivedIntoAccountId: moneyAccountId
			};
		}
		if (kind === 'transfer') {
			return { ...everyday, ...money, fromAccountId: moneyAccountId, toAccountId };
		}
		return {
			...everyday,
			...money,
			categoryAccountId,
			paidFromAccountId: someoneElsePaid ? null : moneyAccountId
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

					{#if locked}
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
									disabled={locked || (!canChange && !isNew)}
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
									disabled={locked || (!canChange && !isNew)}
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
								disabled={locked || (!canChange && !isNew)}
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
								disabled={locked || (!canChange && !isNew)}
								class="w-full"
							/>
							<p class="hint">
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
							disabled={locked || (!canChange && !isNew)}
							class="w-full"
						/>
					</div>

					{#if kind === 'expense' || kind === 'income'}
						<div class="field">
							<label class="field-label" for="rec-category">Category *</label>
							<select
								id="rec-category"
								bind:value={categoryAccountId}
								required
								disabled={locked || (!canChange && !isNew)}
								class="plain-select"
							>
								<option value={null} disabled>Choose a category</option>
								{#each categories as category (category.id)}
									<option value={category.id}>{category.name}</option>
								{/each}
							</select>
						</div>
					{/if}

					{#if kind === 'expense'}
						<label class="checkline">
							<input
								type="checkbox"
								bind:checked={someoneElsePaid}
								disabled={locked || (!canChange && !isNew)}
							/>
							Someone else paid for this
						</label>
					{/if}

					{#if !(kind === 'expense' && someoneElsePaid)}
						<AccountSelect
							{accounts}
							bind:value={moneyAccountId}
							name="moneyAccount"
							label={moneyLabel}
							{defaultAccountId}
							disabled={locked || (!canChange && !isNew)}
						/>
					{/if}

					{#if kind === 'transfer'}
						{#if toAccountChoices.length === 0}
							<p class="locked-note">
								Money can only be moved between two accounts you hold, and there is only one to
								move it from. Add another account first.
							</p>
						{:else}
							<AccountSelect
								accounts={toAccountChoices}
								bind:value={toAccountId}
								name="toAccount"
								label="Moved into"
								{defaultAccountId}
								disabled={locked || (!canChange && !isNew)}
							/>
						{/if}
					{/if}

					<!-- A transfer is money moving between two places you hold, so there is
					     nobody on the other side of it to name (FR-007). -->
					{#if contacts.length > 0 && kind !== 'transfer'}
						<div class="field">
							<label class="field-label" for="rec-contact">
								{kind === 'expense' && someoneElsePaid ? 'Who paid for it? *' : 'Who was it with?'}
							</label>
							<select
								id="rec-contact"
								bind:value={contactId}
								required={kind === 'expense' && someoneElsePaid}
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

					{#if record && (kind === 'expense' || kind === 'income')}
						<!--
							Whether a bank line has been matched to this record. The old
							screens showed this and it went missing when the two became views
							of one store; `locked` alone could not say it, because it stays
							quiet until the record is actually locked and says nothing about
							one that is simply not cleared yet.
						-->
						<button
							type="button"
							class="related-link ob-card"
							onclick={() => goto(resolve('/(app)/reconciliation'))}
						>
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
						{#if canChange || isNew}
							<button
								type="submit"
								class="sheet-btn sheet-btn-primary"
								disabled={saving || rateMissing}
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
	.ob-card {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
		padding: 10px 12px;
		margin-bottom: 16px;
		background: var(--card);
		border: 1px solid var(--border);
		border-radius: 8px;
		font-family: inherit;
		text-align: left;
	}
	.ob-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 34px;
		height: 34px;
		border-radius: 7px;
		background: var(--accent);
		color: var(--muted-foreground);
		flex: 0 0 auto;
	}
	.ob-icon.cleared {
		background: var(--green-soft);
		color: var(--green);
	}
	.ob-main {
		display: flex;
		flex-direction: column;
		gap: 2px;
		flex: 1;
		min-width: 0;
	}
	.ob-title {
		font-size: 13.5px;
		font-weight: 500;
	}
	.ob-sub {
		font-size: 11.5px;
		color: var(--muted-foreground);
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
	.checkline {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 13px;
		margin-bottom: 16px;
		cursor: pointer;
	}
</style>
