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
	 * The two named sides carry the record's own figure and cannot be typed into
	 * here — they follow the Amount field, which is what the entry builder does
	 * with them. Only a third and later side has an amount of its own (FR-010).
	 */
	let {
		fromAccountId = $bindable(null),
		toAccountId = $bindable(null),
		extraSides = $bindable([]),
		sideChoices,
		toAccountChoices,
		allAccounts = [],
		canAdjust = false,
		defaultAccountId = null,
		readOnly = false,
		fromDisabled = readOnly,
		toDisabled = readOnly,
		mainAmountMinor = 0,
		onaddside,
		onremoveside
	}: {
		fromAccountId?: number | null;
		toAccountId?: number | null;
		extraSides?: SideDraft[];
		sideChoices: AccountView[];
		toAccountChoices: AccountView[];
		allAccounts?: AccountView[];
		canAdjust?: boolean;
		defaultAccountId?: number | null;
		readOnly?: boolean;
		/** Overrides `readOnly` for just the "money came out of" side. */
		fromDisabled?: boolean;
		/** Overrides `readOnly` for just the "and went into" side. */
		toDisabled?: boolean;
		/** The record's own figure in cents — what the two named sides are worth. */
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

	const allSides = $derived.by((): SideDraft[] => {
		const main = (Math.abs(mainAmountMinor) / 100).toFixed(2);
		return [
			{ key: -1, accountId: fromAccountId, direction: 'out' as const, amount: main },
			{ key: -2, accountId: toAccountId, direction: 'in' as const, amount: main },
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
			<span class="entry-amount out">{formatMinor(-Math.abs(mainAmountMinor))}</span>
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
			<span class="entry-amount">{formatMinor(Math.abs(mainAmountMinor))}</span>
			<span class="entry-gutter"></span>
		</div>

		<!-- A third and later side. Only with `adjustments`, and the server
		     refuses it regardless of what this offers (FR-010, FR-031c). -->
		{#each extraSides as side (side.key)}
			<div class="entry-line extra">
				<span class="entry-code">{codeOf(side.accountId)}</span>
				<div class="entry-account">
					<select bind:value={side.accountId} class="plain-select" disabled={readOnly}>
						<option value={null} disabled>Choose an account</option>
						{#each allAccounts as account (account.id)}
							<option value={account.id}>{account.code} · {account.name}</option>
						{/each}
					</select>
				</div>
				<select bind:value={side.direction} class="plain-select entry-dir-select" disabled={readOnly}>
					<option value="out">out of</option>
					<option value="in">into</option>
				</select>
				<div class="entry-amount-field">
					<Input
						type="text"
						inputmode="decimal"
						bind:value={side.amount}
						placeholder="0.00"
						disabled={readOnly}
						class="w-full text-right"
					/>
				</div>
				<span class="entry-gutter">
					{#if !readOnly}
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
		{#if canAdjust && !readOnly}
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
