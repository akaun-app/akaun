<script lang="ts">
	import { X } from '@lucide/svelte';
	import * as Sheet from '$lib/components/ui/sheet/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { useIsMobile } from '$lib/hooks/useIsMobile.svelte.js';
	import { formatDate, formatMinor } from '$lib/format.js';
	import { mainCurrency, mainCurrencySymbol } from '$lib/currency-state.svelte.js';
	import AccountSelect from './AccountSelect.svelte';
	import type { AccountView, OutstandingItem, RecordView } from '$lib/server/ledger/types.js';

	/**
	 * Recording a payment, and ticking what it covers.
	 *
	 * The payment and the note saying what it paid off are one action for the
	 * user, so they are one request: `POST /api/records` takes the payment and
	 * its allocations together and takes the payment back if the allocations are
	 * refused, rather than leaving money recorded against nothing (FR-015).
	 *
	 * When a rule refuses — usually because more has been put against an item
	 * than is left on it — the sentence shown is the one the API sent. This
	 * screen never writes its own wording for a refusal, so the figure the user
	 * is told is the figure the rule actually used (FR-016, Principle VII).
	 */
	type Direction = 'we-pay' | 'we-receive';

	let {
		open = $bindable(false),
		direction = 'we-pay',
		accounts,
		contacts = [],
		defaultAccountId = null,
		contactId: initialContactId = null,
		onclose,
		onsaved
	}: {
		open?: boolean;
		/** we-pay: we are paying someone. we-receive: someone is paying us. */
		direction?: Direction;
		/** Every place money sits — what "paid from" / "received into" offers. */
		accounts: AccountView[];
		contacts?: { id: number; legalName: string }[];
		defaultAccountId?: number | null;
		/** Opens with this person already chosen, from a row that names them. */
		contactId?: number | null;
		onclose: () => void;
		onsaved?: (record: RecordView) => void;
	} = $props();

	const screen = useIsMobile();
	const isMobile = $derived(screen.current);
	const panelSide = $derived(isMobile ? 'bottom' : 'right');

	// --- Form state ---------------------------------------------------------
	let date = $state('');
	let description = $state('');
	let reference = $state('');
	let remark = $state('');
	let contactId = $state<number | null>(null);
	let moneyAccountId = $state<number | null>(null);
	let amountInput = $state('0.00');
	// Until the user types an amount of their own, the payment is worth exactly
	// what it covers — which is the ordinary case and saves a keystroke.
	let amountEdited = $state(false);
	/**
	 * movement id → how much of this payment goes against it, exactly as typed.
	 * Held as the typed text rather than as cents so that reformatting never
	 * fights the person filling the box in; it becomes cents once, on the way
	 * out, and the arithmetic is only ever done on those whole cents.
	 */
	let picked = $state<Record<number, string>>({});
	let items = $state<OutstandingItem[]>([]);
	let loading = $state(false);
	let error = $state('');
	let saving = $state(false);

	/** Re-seeds the form whenever the drawer opens. */
	$effect(() => {
		if (!open) return;
		date = new Date().toISOString().slice(0, 10);
		description = '';
		reference = '';
		remark = '';
		contactId = initialContactId;
		amountInput = '0.00';
		amountEdited = false;
		picked = {};
		error = '';
	});

	// Paying what we owe clears the money-we-owe side; being paid clears the
	// money-owed-to-us side. The list of what can be covered follows from that.
	const listDirection = $derived(direction === 'we-pay' ? 'we-owe' : 'owed-to-us');

	// A stale answer must never overwrite a newer one, so each request carries a
	// token and only the newest one is allowed to land.
	let loadToken = 0;
	$effect(() => {
		const person = contactId;
		const dir = listDirection;
		const token = ++loadToken;
		if (!open || person === null) {
			items = [];
			loading = false;
			return;
		}
		loading = true;
		fetch(`/api/settlements?direction=${dir}&contactId=${person}`)
			.then((res) => (res.ok ? res.json() : null))
			.then((body) => {
				if (token !== loadToken) return;
				items = body?.items ?? [];
				loading = false;
			})
			.catch(() => {
				if (token !== loadToken) return;
				items = [];
				loading = false;
			});
	});

	// Changing who the payment is with invalidates every tick against the old
	// person's items — those movements are not theirs to pay off.
	$effect(() => {
		void contactId;
		picked = {};
	});

	// A box left empty is the same as not having ticked the item, so it is
	// dropped here rather than sent as an allocation of nothing and bounced.
	const allocations = $derived(
		Object.entries(picked)
			.map(([movementId, raw]) => ({
				owedMovementId: Number(movementId),
				amountMinor: Math.round(parseFloat(String(raw ?? '')) * 100) || 0
			}))
			.filter((a) => a.amountMinor > 0)
	);

	const allocatedMinor = $derived(
		allocations.reduce((sum, a) => sum + a.amountMinor, 0)
	);

	$effect(() => {
		const total = allocatedMinor;
		if (amountEdited) return;
		amountInput = (total / 100).toFixed(2);
	});

	const amountMinor = $derived(
		Math.round(parseFloat(String(amountInput ?? '')) * 100) || 0
	);
	const unallocatedMinor = $derived(amountMinor - allocatedMinor);

	const title = $derived(direction === 'we-pay' ? 'Record a payment' : 'Record money received');
	const contactLabel = $derived(direction === 'we-pay' ? 'Who was paid? *' : 'Who paid you? *');
	const moneyLabel = $derived(direction === 'we-pay' ? 'Paid from' : 'Received into');

	function isPicked(item: OutstandingItem): boolean {
		return item.movementId in picked;
	}

	function toggle(item: OutstandingItem) {
		if (isPicked(item)) {
			delete picked[item.movementId];
		} else {
			// Ticking an item offers to clear all of what is left on it, which is
			// what a payment usually does.
			picked[item.movementId] = (item.outstandingMinor / 100).toFixed(2);
		}
	}

	const canSave = $derived(
		contactId !== null && moneyAccountId !== null && amountMinor > 0 && !saving
	);

	async function save(event: SubmitEvent) {
		event.preventDefault();
		if (saving) return;
		saving = true;
		error = '';

		const res = await fetch('/api/records', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				kind: 'payment',
				date,
				description,
				amount: amountMinor / 100,
				currency: mainCurrency(),
				exchangeRate: 1,
				reference,
				remark,
				contactId,
				paidFromAccountId: moneyAccountId,
				direction,
				settlements: allocations
			})
		});

		saving = false;
		if (!res.ok) {
			const body = await res.json().catch(() => null);
			// The rule's own sentence, never a rewrite of it (FR-016).
			error = body?.reason ?? body?.error ?? 'That payment could not be saved.';
			return;
		}
		onsaved?.(await res.json());
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
					<div class="sheet-eyebrow">New</div>
					<div class="sheet-title-text">{title}</div>
				</div>
				<Sheet.Close class="sheet-close"><X size={16} /></Sheet.Close>
			</div>

			<form onsubmit={save} style="flex:1; display:flex; flex-direction:column; overflow:hidden;">
				<div style="flex:1; overflow-y:auto; padding:20px 22px;">
					{#if error}
						<div class="form-error">{error}</div>
					{/if}

					<div class="field">
						<label class="field-label" for="pay-contact">{contactLabel}</label>
						<select id="pay-contact" bind:value={contactId} required class="plain-select">
							<option value={null} disabled>Choose a person</option>
							{#each contacts as contact (contact.id)}
								<option value={contact.id}>{contact.legalName}</option>
							{/each}
						</select>
					</div>

					<div class="field">
						<label class="field-label" for="pay-description">What was it for? *</label>
						<Input
							id="pay-description"
							bind:value={description}
							required
							maxlength={500}
							class="w-full"
						/>
					</div>

					<div class="field">
						<label class="field-label" for="pay-amount">Amount ({mainCurrencySymbol()}) *</label>
						<Input
							id="pay-amount"
							type="number"
							step="0.01"
							bind:value={amountInput}
							oninput={() => (amountEdited = true)}
							required
							class="w-full"
						/>
					</div>

					<div class="field">
						<label class="field-label" for="pay-date">Date *</label>
						<Input id="pay-date" type="date" bind:value={date} required class="w-full" />
					</div>

					<AccountSelect
						{accounts}
						bind:value={moneyAccountId}
						name="paymentAccount"
						label={moneyLabel}
						{defaultAccountId}
					/>

					<div class="detail-section-label">What this covers</div>
					{#if contactId === null}
						<p class="covers-note">Choose a person to see what is still owed.</p>
					{:else if loading}
						<p class="covers-note">Looking…</p>
					{:else if items.length === 0}
						<p class="covers-note">Nothing is outstanding with this person.</p>
					{:else}
						<div class="covers-list">
							{#each items as item (item.movementId)}
								<div class="covers-row" class:on={isPicked(item)}>
									<label class="covers-tick">
										<input
											type="checkbox"
											checked={isPicked(item)}
											onchange={() => toggle(item)}
										/>
										<span class="covers-main">
											<span class="covers-name">{item.description || 'Record'}</span>
											<span class="covers-sub">
												{formatDate(item.date)}{item.recordNumber
													? ` · ${item.recordNumber}`
													: ''} · {formatMinor(item.outstandingMinor)} still owed
												{#if item.daysOverdue > 0}
													· {item.daysOverdue} days late
												{/if}
											</span>
										</span>
									</label>
									{#if isPicked(item)}
										<input
											class="covers-amount"
											type="number"
											step="0.01"
											aria-label="Amount put against {item.description || 'this record'}"
											bind:value={picked[item.movementId]}
										/>
									{/if}
								</div>
							{/each}
						</div>
					{/if}

					<div class="field">
						<label class="field-label" for="pay-reference">Reference</label>
						<Input id="pay-reference" bind:value={reference} maxlength={200} class="w-full" />
					</div>

					<div class="field">
						<label class="field-label" for="pay-remark">Remark</label>
						<Textarea id="pay-remark" bind:value={remark} rows={2} class="leading-relaxed" />
					</div>
				</div>

				<div class="sheet-foot">
					{#if allocatedMinor > 0 && unallocatedMinor > 0}
						<div class="sheet-foot-note">
							{formatMinor(unallocatedMinor)} of this payment is not put against anything yet.
						</div>
					{:else if allocatedMinor > 0}
						<div class="sheet-foot-note">
							This pays off {formatMinor(allocatedMinor)}.
						</div>
					{/if}
					<div class="sheet-foot-actions">
						<button type="button" class="sheet-btn" onclick={onclose}>Cancel</button>
						<button type="submit" class="sheet-btn sheet-btn-primary" disabled={!canSave}>
							{saving ? 'Saving…' : 'Save'}
						</button>
					</div>
				</div>
			</form>
		</Sheet.Content>
	</Sheet.Portal>
</Sheet.Root>

<style>
	.form-error {
		background: var(--red-soft);
		color: var(--red);
		border-radius: 8px;
		padding: 10px 14px;
		font-size: 13px;
		margin-bottom: 16px;
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
	.covers-note {
		font-size: 12.5px;
		color: var(--muted-foreground);
		margin: 0 0 16px;
	}
	.covers-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin-bottom: 16px;
	}
	.covers-row {
		display: flex;
		align-items: center;
		gap: 10px;
		border: 1px solid var(--border);
		border-radius: 9px;
		padding: 10px 12px;
		background: var(--card);
	}
	.covers-row.on {
		border-color: var(--primary);
	}
	.covers-tick {
		display: flex;
		align-items: center;
		gap: 10px;
		flex: 1;
		min-width: 0;
		cursor: pointer;
	}
	.covers-main {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.covers-name {
		font-size: 13px;
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.covers-sub {
		font-size: 11.5px;
		color: var(--muted-foreground);
	}
	.covers-amount {
		width: 92px;
		height: 30px;
		padding: 0 8px;
		border: 1px solid var(--border);
		border-radius: 7px;
		background: var(--card);
		color: var(--foreground);
		font-family: inherit;
		font-size: 13px;
		text-align: right;
		flex-shrink: 0;
	}
</style>
