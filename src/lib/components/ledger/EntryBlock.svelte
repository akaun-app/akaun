<script lang="ts">
	import { X } from '@lucide/svelte';
	import { Input } from '$lib/components/ui/input/index.js';
	import { formatMinor } from '$lib/format.js';
	import AccountSelect from './AccountSelect.svelte';
	import { differenceMinor, sideMinor, type SideDraft } from './journal-rules.js';
	import type { AccountView } from '$lib/server/ledger/types.js';

	/**
	 * The record's two sides, as a ledger reads them.
	 *
	 * Every record in this app is defined by one thing: its movements add up to
	 * zero. The screens have never shown it. They asked "from account" and "to
	 * account" as two unrelated fields, put any third side in a separate block
	 * further down, and left the balance to the server. This is those three
	 * things as one control — the entry itself, with the difference running
	 * underneath it.
	 *
	 * The sign is shown, never typed. `journal-rules.ts` is explicit that the
	 * direction decides the sign "so a minus typed into the amount box cannot
	 * quietly reverse what the row says", so an amount box here only ever holds a
	 * positive figure and the signed column is derived.
	 *
	 * The two named sides carry the record's own figure and follow the Amount
	 * field, which is what the entry builder does with them — until a third
	 * side exists, at which point whichever named side is the category has an
	 * amount of its own to type too, the same as a third and later side always
	 * has (FR-010). The other named side is always the money side, and never
	 * gets typed into.
	 */
	let {
		fromAccountId = $bindable(null),
		toAccountId = $bindable(null),
		extraSides = $bindable([]),
		categoryAmount = $bindable(''),
		sideChoices,
		toAccountChoices,
		allAccounts = [],
		canAdjust = false,
		canAddSide = canAdjust,
		extraSideAccountChoices = allAccounts,
		extraSideDirection = null,
		defaultAccountId = null,
		readOnly = false,
		fromDisabled = readOnly,
		toDisabled = readOnly,
		extraSidesReadOnly = readOnly,
		mainAmountMinor = 0,
		onaddside,
		onremoveside
	}: {
		fromAccountId?: number | null;
		toAccountId?: number | null;
		extraSides?: SideDraft[];
		/**
		 * The named category's own typed amount, once `extraSides` is non-empty
		 * — a plain decimal string, like an extra side's own `amount`. Unused
		 * (and not shown) with no extra sides yet, when the category still
		 * simply matches `mainAmountMinor`.
		 */
		categoryAmount?: string;
		sideChoices: AccountView[];
		toAccountChoices: AccountView[];
		allAccounts?: AccountView[];
		canAdjust?: boolean;
		/** Whether a third line may be added at all — a free choice with `adjustments` (FR-031), or an everyday same-type category without it. */
		canAddSide?: boolean;
		/** Without `adjustments`, the accounts a new or existing extra line may name — same-type categories only, so the result is always the everyday shape `sides-from-accounts.ts` accepts without the ability. Ignored when `canAdjust`. */
		extraSideAccountChoices?: AccountView[];
		/** Without `adjustments`, the one direction every extra line must keep (FR-031c's everyday pattern needs every category side pointing the same way). `null` when `canAdjust`, or when no kind is known yet. */
		extraSideDirection?: 'in' | 'out' | null;
		defaultAccountId?: number | null;
		readOnly?: boolean;
		/** Overrides `readOnly` for just the "money came out of" side. */
		fromDisabled?: boolean;
		/** Overrides `readOnly` for just the "and went into" side. */
		toDisabled?: boolean;
		/**
		 * Overrides `readOnly` for the third and later sides — a category is not
		 * itself settled or reconciled, so a locked record's category can still
		 * be split, resized or merged back into one (`RecordForm.svelte`'s
		 * `categoryUnlockable`).
		 */
		extraSidesReadOnly?: boolean;
		/**
		 * The record's own figure in cents — what the money side is worth. The
		 * category side matches it too, until there is more than one, at which
		 * point it is `categoryAmount` instead — see the running difference,
		 * which is what actually says whether the two still add up.
		 */
		mainAmountMinor?: number;
		onaddside?: () => void;
		onremoveside?: (key: number) => void;
	} = $props();

	// Mirrors `toAccountChoices` in RecordForm.svelte: the "to" side can never
	// offer the account "from" already claimed, in the full chart any more than
	// in the shortlist — otherwise a `canAdjust` user's full-chart pre-select can
	// land on `fromAccountId`, which RecordForm's own guard effect immediately
	// clears back to null, and AccountSelect picks it again: an infinite loop.
	const toAllAccounts = $derived(allAccounts.filter((a) => a.id !== fromAccountId));

	/**
	 * The named category's own typed share once extras exist — `categoryAmount`
	 * itself, not derived from the total. The other named side is always the
	 * money side and keeps the record's whole figure.
	 */
	const primaryAmountMinor = $derived(
		extraSides.length > 0
			? Math.round(Math.abs(parseFloat(categoryAmount || '0') || 0) * 100)
			: mainAmountMinor
	);
	const fromAmountMinor = $derived(
		extraSideDirection === 'out' ? primaryAmountMinor : mainAmountMinor
	);
	const toAmountMinor = $derived(
		extraSideDirection === 'in' ? primaryAmountMinor : mainAmountMinor
	);
	// Which named side is the category the user can now type an amount for —
	// the other is always the money side and stays exactly as it was, a
	// figure shown rather than typed.
	const fromIsCategory = $derived(extraSideDirection === 'out' && extraSides.length > 0);
	const toIsCategory = $derived(extraSideDirection === 'in' && extraSides.length > 0);

	const allSides = $derived.by((): SideDraft[] => {
		return [
			{
				key: -1,
				accountId: fromAccountId,
				direction: 'out' as const,
				amount: (fromAmountMinor / 100).toFixed(2)
			},
			{
				key: -2,
				accountId: toAccountId,
				direction: 'in' as const,
				amount: (toAmountMinor / 100).toFixed(2)
			},
			...extraSides
		];
	});

	const difference = $derived(differenceMinor(allSides));

	function codeOf(accountId: number | null): string {
		if (accountId === null) return '';
		return String(allAccounts.find((a) => a.id === accountId)?.code ?? '');
	}
</script>

<section class="detail-card entry">
	<div class="detail-card-head">
		<span class="detail-card-title">The entry</span>
		<span class="entry-state" class:off={difference !== 0}>
			{difference === 0 ? 'Balanced' : `${(Math.abs(difference) / 100).toFixed(2)} apart`}
		</span>
	</div>

	<div class="entry-lines">
		<!-- The two sides every record has. Their figure is the record's own, so
		     it is shown rather than typed — the builder fills both from it. -->
		<div class="entry-line">
			<span class="entry-code">{codeOf(fromAccountId)}</span>
			<div class="entry-account">
				<AccountSelect
					accounts={sideChoices}
					{allAccounts}
					{canAdjust}
					bind:value={fromAccountId}
					name="fromAccount"
					label="Money came out of"
					{defaultAccountId}
					disabled={fromDisabled}
					bare
				/>
			</div>
			<span class="entry-dir">out of</span>
			{#if fromIsCategory}
				<div class="entry-amount-field">
					<Input
						type="text"
						inputmode="decimal"
						bind:value={categoryAmount}
						placeholder="0.00"
						disabled={extraSidesReadOnly}
						class="w-full text-right"
					/>
				</div>
			{:else}
				<span class="entry-amount out">{formatMinor(-Math.abs(fromAmountMinor))}</span>
			{/if}
			<span class="entry-gutter"></span>
		</div>

		<div class="entry-line">
			<span class="entry-code">{codeOf(toAccountId)}</span>
			<div class="entry-account">
				{#if toAccountChoices.length === 0}
					<p class="entry-note">
						There is only one account to choose from, so there is no second account to
						post to. Add another account first.
					</p>
				{:else}
					<AccountSelect
						accounts={toAccountChoices}
						allAccounts={toAllAccounts}
						{canAdjust}
						bind:value={toAccountId}
						name="toAccount"
						label="And went into"
						{defaultAccountId}
						disabled={toDisabled}
						bare
					/>
				{/if}
			</div>
			<span class="entry-dir">into</span>
			{#if toIsCategory}
				<div class="entry-amount-field">
					<Input
						type="text"
						inputmode="decimal"
						bind:value={categoryAmount}
						placeholder="0.00"
						disabled={extraSidesReadOnly}
						class="w-full text-right"
					/>
				</div>
			{:else}
				<span class="entry-amount">{formatMinor(Math.abs(toAmountMinor))}</span>
			{/if}
			<span class="entry-gutter"></span>
		</div>

		<!-- A third and later side. Free with `adjustments`; otherwise an
		     everyday same-type category only, and the server refuses anything
		     else regardless of what this offers (FR-010, FR-031c). -->
		{#each extraSides as side (side.key)}
			<div class="entry-line extra">
				<span class="entry-code">{codeOf(side.accountId)}</span>
				<div class="entry-account">
					<select bind:value={side.accountId} class="plain-select" disabled={extraSidesReadOnly}>
						<option value={null} disabled>Choose an account</option>
						{#each canAdjust ? allAccounts : extraSideAccountChoices as account (account.id)}
							<option value={account.id}>{account.code} · {account.name}</option>
						{/each}
					</select>
				</div>
				{#if canAdjust}
					<select bind:value={side.direction} class="plain-select entry-dir-select" disabled={extraSidesReadOnly}>
						<option value="out">out of</option>
						<option value="in">into</option>
					</select>
				{:else}
					<span class="entry-dir">{side.direction === 'in' ? 'into' : 'out of'}</span>
				{/if}
				<div class="entry-amount-field">
					<Input
						type="text"
						inputmode="decimal"
						bind:value={side.amount}
						placeholder="0.00"
						disabled={extraSidesReadOnly}
						class="w-full text-right"
					/>
				</div>
				<span class="entry-gutter">
					{#if !extraSidesReadOnly}
						<button
							type="button"
							class="entry-remove"
							onclick={() => onremoveside?.(side.key)}
							aria-label="Remove this line"
						>
							<X size={13} />
						</button>
					{/if}
				</span>
			</div>
			{#if side.accountId !== null}
				<div class="entry-line signed">
					<span class="entry-code"></span>
					<span class="entry-account"></span>
					<span class="entry-dir"></span>
					<span class="entry-amount" class:out={sideMinor(side) < 0}>
						{formatMinor(sideMinor(side))}
					</span>
					<span class="entry-gutter"></span>
				</div>
			{/if}
		{/each}
	</div>

	<div class="entry-foot">
		{#if canAddSide && !extraSidesReadOnly}
			<button type="button" class="detail-card-action" onclick={() => onaddside?.()}>
				+ Add a line
			</button>
		{:else}
			<span></span>
		{/if}
		<span class="entry-total" class:off={difference !== 0}>{formatMinor(difference)}</span>
	</div>
</section>

<style>
	.entry-state {
		font-family: 'Geist Mono', monospace;
		font-size: 11.5px;
		font-weight: 500;
		color: var(--green);
		background: var(--green-soft);
		padding: 2px 9px;
		border-radius: 999px;
	}
	.entry-state.off {
		color: var(--amber);
		background: var(--amber-soft);
	}
	.entry-lines {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding-bottom: 12px;
	}
	.entry-line {
		display: grid;
		grid-template-columns: 52px minmax(0, 1fr) 82px 132px 26px;
		align-items: center;
		gap: 10px;
	}
	.entry-line.signed {
		gap: 10px;
		margin-top: -4px;
	}
	.entry-code {
		font-family: 'Geist Mono', monospace;
		font-size: 12px;
		color: var(--muted-foreground);
		font-variant-numeric: tabular-nums;
	}
	.entry-dir {
		font-size: 12.5px;
		color: var(--muted-foreground);
	}
	.entry-dir-select {
		width: 82px;
	}
	.entry-amount {
		font-family: 'Geist Mono', monospace;
		font-variant-numeric: tabular-nums;
		font-size: 13.5px;
		font-weight: 600;
		text-align: right;
	}
	.entry-amount.out {
		color: var(--muted-foreground);
	}
	.entry-amount-field {
		min-width: 0;
	}
	.entry-gutter {
		display: flex;
		justify-content: flex-end;
	}
	.entry-remove {
		display: grid;
		place-items: center;
		width: 24px;
		height: 24px;
		border: none;
		background: none;
		border-radius: 6px;
		color: var(--muted-foreground);
		cursor: pointer;
	}
	.entry-remove:hover {
		background: var(--accent);
		color: var(--destructive);
	}
	.entry-note {
		font-size: 12.5px;
		color: var(--muted-foreground);
		margin: 0;
	}
	.entry-foot {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 132px 26px;
		align-items: center;
		gap: 10px;
		border-top: 1px solid var(--border);
		padding-top: 12px;
	}
	/* The invariant, stated. Zero is the whole point of the block. */
	.entry-total {
		font-family: 'Geist Mono', monospace;
		font-variant-numeric: tabular-nums;
		font-size: 14px;
		font-weight: 600;
		text-align: right;
	}
	.entry-total.off {
		color: var(--amber);
	}

	@media (max-width: 767px) {
		.entry-line,
		.entry-line.signed {
			grid-template-columns: minmax(0, 1fr) 26px;
			gap: 6px 10px;
		}
		.entry-code,
		.entry-dir {
			display: none;
		}
		.entry-amount {
			text-align: left;
		}
		.entry-dir-select {
			width: 100%;
		}
		.entry-foot {
			grid-template-columns: minmax(0, 1fr) auto;
		}
	}
</style>
