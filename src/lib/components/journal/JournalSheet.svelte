<script lang="ts">
	import { Plus, Trash2, X } from '@lucide/svelte';
	import * as Sheet from '$lib/components/ui/sheet/index.js';
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
	import AuditTrail from '$lib/components/ui/AuditTrail.svelte';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { useIsMobile } from '$lib/hooks/useIsMobile.svelte.js';
	import { formatDate, formatMinor } from '$lib/format.js';
	import { mainCurrency, mainCurrencySymbol } from '$lib/currency-state.svelte.js';
	import { roleLabel } from '$lib/components/accounts/account-roles.js';
	import {
		differenceMinor,
		moneyInMinor,
		moneyOutMinor,
		sideMinor,
		whyNotSaveable,
		type SideDraft
	} from './journal-rules.js';
	import type { AccountView, RecordView } from '$lib/server/ledger/types.js';

	/**
	 * The drawer where both sides of a record are typed in by hand.
	 *
	 * Two jobs, one piece of chrome: writing a new entry, and reading one that
	 * was already saved. While writing, the running difference sits above the
	 * Save button and updates on every keystroke, and Save stays refused until
	 * it is zero (FR-002, FR-040) — the rule is something to watch rather than
	 * something that rejects you at the end.
	 *
	 * A saved entry is read back but not re-typed. Nothing in the records API
	 * changes a record's sides, so an entry that is wrong is deleted and entered
	 * again rather than quietly patched into a different shape.
	 */
	let {
		open = $bindable(false),
		record = null,
		accounts,
		contacts = [],
		canAdd = false,
		canDelete = false,
		onclose,
		onsaved,
		ondeleted
	}: {
		open?: boolean;
		/** A saved entry to read, or null to write a new one. */
		record?: RecordView | null;
		/** Every account there is — this is the screen where all of them are offered. */
		accounts: AccountView[];
		contacts?: { id: number; legalName: string }[];
		canAdd?: boolean;
		canDelete?: boolean;
		onclose: () => void;
		onsaved?: () => void;
		ondeleted?: (id: number) => void;
	} = $props();

	const screen = useIsMobile();
	const isMobile = $derived(screen.current);
	const panelSide = $derived(isMobile ? 'bottom' : 'right');

	const isNew = $derived(record === null);

	const choices = $derived(
		[...accounts].sort((a, b) => a.role - b.role || a.rank.localeCompare(b.rank))
	);
	const roleById = $derived(new Map(accounts.map((a) => [a.id, a.role])));

	// --- Form state ---------------------------------------------------------
	let date = $state('');
	let description = $state('');
	let reference = $state('');
	let remark = $state('');
	let contactId = $state<number | null>(null);
	let sides = $state<SideDraft[]>([]);
	let error = $state('');
	let saving = $state(false);
	let deleteDialogOpen = $state(false);

	/** Rows carry their own key so removing one never re-seeds the ones below it. */
	let nextKey = 0;
	function blankSide(direction: SideDraft['direction']): SideDraft {
		return { key: nextKey++, accountId: null, direction, amount: '' };
	}

	/** Re-seeds the form whenever the drawer opens on something different. */
	$effect(() => {
		const source = record;
		if (!open) return;

		date = source?.date ?? new Date().toISOString().slice(0, 10);
		description = source?.description ?? '';
		reference = source?.reference ?? '';
		remark = source?.remark ?? '';
		contactId = source?.contactId ?? null;
		error = '';

		// A new entry starts with the two sides every record needs, so the shape
		// of the thing is on screen before anything has been typed.
		sides = source ? [] : [blankSide('in'), blankSide('out')];
	});

	const moneyIn = $derived(moneyInMinor(sides));
	const moneyOut = $derived(moneyOutMinor(sides));
	const difference = $derived(differenceMinor(sides));
	const blockedReason = $derived(
		whyNotSaveable(sides, (id) => roleById.get(id), contactId)
	);

	function addSide() {
		// A new row leans the way that brings the entry closer to cancelling out.
		sides = [...sides, blankSide(difference > 0 ? 'out' : 'in')];
	}

	function removeSide(key: number) {
		sides = sides.filter((side) => side.key !== key);
	}

	async function save(event: SubmitEvent) {
		event.preventDefault();
		if (saving || blockedReason !== null) return;
		saving = true;
		error = '';

		const res = await fetch('/api/records', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				kind: 'journal',
				date,
				description,
				// An entry with many sides has no single figure anyone typed, so its
				// own figure is the total that moved — everything going in, added up.
				amount: moneyIn / 100,
				currency: mainCurrency(),
				exchangeRate: 1,
				reference,
				remark,
				contactId,
				movements: sides.map((side) => ({
					accountId: side.accountId,
					amountMinor: sideMinor(side)
				}))
			})
		});

		saving = false;
		if (!res.ok) {
			const body = await res.json().catch(() => null);
			error = body?.reason ?? body?.error ?? 'That could not be saved.';
			return;
		}
		onsaved?.();
		onclose();
	}

	async function remove() {
		if (!record) return;
		const id = record.id;
		error = '';
		const res = await fetch(`/api/records/${id}`, { method: 'DELETE' });
		if (!res.ok) {
			const body = await res.json().catch(() => null);
			error = body?.reason ?? body?.error ?? 'That could not be deleted.';
			return;
		}
		// Leave the entry's own URL first — it now points at nothing — and only
		// then ask the list behind it to re-read itself.
		onclose();
		ondeleted?.(id);
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
					<div class="sheet-eyebrow">{isNew ? 'New' : 'Entry'}</div>
					<div class="sheet-title-text">
						{isNew ? 'Enter both sides' : 'Entry made by hand'}
					</div>
				</div>
				<Sheet.Close class="sheet-close"><X size={16} /></Sheet.Close>
			</div>

			{#if record}
				<div style="flex:1; overflow-y:auto; padding:20px 22px;">
					{#if error}
						<div class="form-error">{error}</div>
					{/if}

					<div class="detail-amount">
						<span class="detail-amount-val">{formatMinor(record.amountMinor)}</span>
					</div>
					<div class="detail-statusrow">
						<span class="detail-sub">
							{formatDate(record.date)}
							{#if record.contactName}· {record.contactName}{/if}
						</span>
					</div>

					<p class="note">
						The sides of an entry cannot be changed once it is saved. If it is wrong,
						delete it and enter it again.
					</p>

					{#if record.description}
						<div class="readfield">
							<div class="field-label">What it was for</div>
							<div class="readvalue">{record.description}</div>
						</div>
					{/if}

					<div class="field-label" style="margin-bottom:8px;">The sides</div>
					<div class="table-card" style="margin-bottom:18px;">
						{#each record.movements as movement (movement.id)}
							<div class="saved-side">
								<span class="saved-side-main">
									<span class="saved-side-name">{movement.accountName}</span>
									<span class="saved-side-sub">{roleLabel(movement.accountRole)}</span>
								</span>
								<span class="saved-side-dir">
									{movement.amountMinor > 0 ? 'Money in' : 'Money out'}
								</span>
								<span class="saved-side-amount">
									{formatMinor(Math.abs(movement.amountMinor))}
								</span>
							</div>
						{/each}
					</div>

					{#if record.reference}
						<div class="readfield">
							<div class="field-label">Reference</div>
							<div class="readvalue">{record.reference}</div>
						</div>
					{/if}

					{#if record.remark}
						<div class="readfield">
							<div class="field-label">Remark</div>
							<div class="readvalue">{record.remark}</div>
						</div>
					{/if}

					<AuditTrail recordType="record" recordId={record.id} />
				</div>

				<div class="sheet-foot">
					<div class="sheet-foot-actions">
						{#if canDelete}
							<button
								type="button"
								class="sheet-btn sheet-btn-delete"
								style="margin-right:auto;"
								disabled={record.locked}
								title={record.locked ? (record.lockedReason ?? undefined) : undefined}
								onclick={() => (deleteDialogOpen = true)}
							>
								<Trash2 size={14} /> Delete
							</button>
						{/if}
						<button type="button" class="sheet-btn" onclick={onclose}>Close</button>
					</div>
				</div>
			{:else}
				<form onsubmit={save} style="flex:1; display:flex; flex-direction:column; overflow:hidden;">
					<div style="flex:1; overflow-y:auto; padding:20px 22px;">
						{#if error}
							<div class="form-error">{error}</div>
						{/if}

						<div class="field">
							<label class="field-label" for="jrn-description">What was it for? *</label>
							<Input
								id="jrn-description"
								bind:value={description}
								required
								maxlength={500}
								class="w-full"
							/>
						</div>

						<div class="field">
							<label class="field-label" for="jrn-date">Date *</label>
							<Input id="jrn-date" type="date" bind:value={date} required class="w-full" />
						</div>

						<div class="field-label" style="margin-bottom:8px;">The sides *</div>
						<p class="hint">
							Every side says which account the money went into or came out of. Add as
							many as the entry needs — at least two.
						</p>

						<div class="sides">
							{#each sides as side, i (side.key)}
								<div class="side-row" class:stacked={isMobile}>
									<select
										class="plain-select"
										aria-label="Account for side {i + 1}"
										bind:value={sides[i].accountId}
									>
										<option value={null} disabled>Choose an account</option>
										{#each choices as account (account.id)}
											<option value={account.id}>
												{account.name} · {roleLabel(account.role)}
											</option>
										{/each}
									</select>

									<div class="dirtoggle" role="group" aria-label="Direction for side {i + 1}">
										<button
											type="button"
											class="dirbtn"
											class:on={side.direction === 'in'}
											aria-pressed={side.direction === 'in'}
											onclick={() => (sides[i].direction = 'in')}
										>
											Money in
										</button>
										<button
											type="button"
											class="dirbtn"
											class:on={side.direction === 'out'}
											aria-pressed={side.direction === 'out'}
											onclick={() => (sides[i].direction = 'out')}
										>
											Money out
										</button>
									</div>

									<input
										class="plain-input side-amount"
										type="text"
										inputmode="decimal"
										placeholder="0.00"
										aria-label="Amount for side {i + 1} ({mainCurrencySymbol()})"
										bind:value={sides[i].amount}
									/>

									<button
										type="button"
										class="side-remove"
										aria-label="Remove side {i + 1}"
										disabled={sides.length <= 2}
										title={sides.length <= 2
											? 'A record needs at least two sides.'
											: 'Remove this side'}
										onclick={() => removeSide(side.key)}
									>
										<X size={14} />
									</button>
								</div>
							{/each}
						</div>

						<button type="button" class="link-btn add-side" onclick={addSide}>
							<Plus size={13} /> Add another side
						</button>

						{#if contacts.length > 0}
							<div class="field" style="margin-top:18px;">
								<label class="field-label" for="jrn-contact">Who was it with?</label>
								<select id="jrn-contact" bind:value={contactId} class="plain-select">
									<option value={null}>—</option>
									{#each contacts as contact (contact.id)}
										<option value={contact.id}>{contact.legalName}</option>
									{/each}
								</select>
							</div>
						{/if}

						<div class="field">
							<label class="field-label" for="jrn-reference">Reference</label>
							<Input id="jrn-reference" bind:value={reference} maxlength={200} class="w-full" />
						</div>

						<div class="field">
							<label class="field-label" for="jrn-remark">Remark</label>
							<Textarea id="jrn-remark" bind:value={remark} rows={2} class="leading-relaxed" />
						</div>
					</div>

					<div class="sheet-foot">
						<!--
							The running difference, right where the Save button is, so it stays in
							view however many sides the entry has grown to.
						-->
						<div class="sheet-foot-note">
							<div class="tally">
								<span>In {formatMinor(moneyIn)}</span>
								<span>Out {formatMinor(moneyOut)}</span>
							</div>
							<div class="verdict" class:balanced={difference === 0}>
								{blockedReason ?? 'The two sides cancel out.'}
							</div>
						</div>
						<div class="sheet-foot-actions">
							<button type="button" class="sheet-btn" onclick={onclose}>Cancel</button>
							{#if canAdd}
								<button
									type="submit"
									class="sheet-btn sheet-btn-primary"
									disabled={saving || blockedReason !== null}
								>
									{saving ? 'Saving…' : 'Save'}
								</button>
							{/if}
						</div>
					</div>
				</form>
			{/if}
		</Sheet.Content>
	</Sheet.Portal>
</Sheet.Root>

<ConfirmDialog
	bind:open={deleteDialogOpen}
	title="Delete this entry?"
	description="This removes it and every side of it. It can't be undone."
	confirmLabel="Delete entry"
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
	.note {
		font-size: 12px;
		color: var(--muted-foreground);
		background: var(--accent);
		border-radius: 8px;
		padding: 10px 12px;
		margin: 0 0 18px;
		line-height: 1.5;
	}
	.hint {
		font-size: 12px;
		color: var(--muted-foreground);
		margin: 0 0 10px;
		line-height: 1.5;
	}
	.detail-sub {
		font-size: 12.5px;
		color: var(--muted-foreground);
	}
	.readfield {
		margin-bottom: 16px;
	}
	.readvalue {
		font-size: 13.5px;
		line-height: 1.5;
		white-space: pre-wrap;
	}
	.plain-select,
	.plain-input {
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

	/* --- The sides being typed ------------------------------------------- */
	.sides {
		display: flex;
		flex-direction: column;
		gap: 10px;
		margin-bottom: 10px;
	}
	.side-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto 96px 28px;
		align-items: center;
		gap: 8px;
	}
	/* Below the mobile breakpoint the row becomes one column (FR-043). */
	.side-row.stacked {
		grid-template-columns: minmax(0, 1fr) 28px;
		row-gap: 8px;
	}
	.side-row.stacked .dirtoggle,
	.side-row.stacked .side-amount {
		grid-column: 1 / -1;
	}
	.dirtoggle {
		display: flex;
		border: 1px solid var(--border);
		border-radius: 8px;
		overflow: hidden;
	}
	.dirbtn {
		padding: 0 10px;
		height: 34px;
		border: none;
		background: var(--card);
		color: var(--muted-foreground);
		font-family: inherit;
		font-size: 12px;
		white-space: nowrap;
		cursor: pointer;
	}
	.dirbtn.on {
		background: var(--accent);
		color: var(--foreground);
		font-weight: 500;
	}
	.side-amount {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.side-remove {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border: none;
		border-radius: 6px;
		background: transparent;
		color: var(--muted-foreground);
		cursor: pointer;
	}
	.side-remove:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}
	.add-side {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 0;
	}

	/* --- The running difference ------------------------------------------ */
	.tally {
		display: flex;
		gap: 14px;
		font-variant-numeric: tabular-nums;
	}
	.verdict {
		margin-top: 4px;
		color: var(--red);
		line-height: 1.5;
	}
	.verdict.balanced {
		color: var(--muted-foreground);
	}

	/* --- The sides of a saved entry -------------------------------------- */
	.saved-side {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 12px;
		border-bottom: 1px solid var(--border);
	}
	.saved-side:last-child {
		border-bottom: none;
	}
	.saved-side-main {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
		flex: 1;
	}
	.saved-side-name {
		font-size: 13px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.saved-side-sub {
		font-size: 11.5px;
		color: var(--muted-foreground);
	}
	.saved-side-dir {
		font-size: 11.5px;
		color: var(--muted-foreground);
		white-space: nowrap;
	}
	.saved-side-amount {
		font-size: 13px;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
</style>
