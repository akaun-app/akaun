<script lang="ts">
	import { AccountTypeDisplayLabels } from '$lib/enums.js';
	import type { AccountView } from '$lib/server/ledger/types.js';

	/**
	 * The one control that answers "which account paid?" / "which account
	 * received it?".
	 *
	 * Two rules make it invisible when it should be (FR-011, SC-009):
	 *
	 *  - it starts on the default account, so the common case needs no thought;
	 *  - when there is only one account to choose from, there is no question to
	 *    ask, so it renders as a plain line of text and a hidden field rather
	 *    than a picker with one option in it.
	 *
	 * A business that never opens a second account should never learn that
	 * accounts exist.
	 */
	let {
		accounts,
		allAccounts = [],
		canAdjust = false,
		value = $bindable<number | null>(null),
		name,
		label = 'Account',
		defaultAccountId = null,
		required = true,
		disabled = false,
		disabledReason = '',
		bare = false
	}: {
		/** The shortlist: the accounts this side would sensibly be. */
		accounts: AccountView[];
		/** Every account, offered one step away — only with `adjustments`. */
		allAccounts?: AccountView[];
		canAdjust?: boolean;
		value?: number | null;
		name: string;
		label?: string;
		defaultAccountId?: number | null;
		required?: boolean;
		disabled?: boolean;
		disabledReason?: string;
		/**
		 * Drop the `.field` wrapper and the label: the caller has already said
		 * what this side is. `EntryBlock` uses it, where the row's own columns
		 * name the direction and a second label would only break the alignment.
		 * Every rule about *what* is offered stays here — there is one picker.
		 */
		bare?: boolean;
	} = $props();

	/**
	 * Whether the full chart of accounts is showing.
	 *
	 * Each side offers the accounts it would sensibly be — categories for what a
	 * record was for, money pots for where it came from or went. That shortlist
	 * is what makes the form answerable without knowing the chart of accounts
	 * exists. The full list is one step away rather than gone, and only for
	 * someone with `adjustments`, because a record between any two accounts is
	 * exactly what that ability is for (FR-008a, FR-031).
	 */
	let showAll = $state(false);

	// A record already pointing at an account outside the shortlist opens with
	// the full list showing, so the picker never hides what the record says.
	$effect(() => {
		if (!canAdjust || value == null) return;
		if (!accounts.some((a) => a.id === value)) showAll = true;
	});

	const offered = $derived(showAll && canAdjust ? allAccounts : accounts);

	// Archived accounts stay out of the picker but never disappear from history.
	const choices = $derived(
		offered
			.filter((a) => ((a.active ?? a.archivedAt == null) && (a.postingEligible ?? true)) || a.id === value)
			.sort((a, b) => a.type - b.type || (a.code ?? a.id) - (b.code ?? b.id))
	);

	// Pre-select once there is something to select. Guarded on `value` being
	// unset so re-running this never overwrites what the user picked.
	$effect(() => {
		if (value != null || choices.length === 0) return;
		const preferred = choices.find((a) => a.id === defaultAccountId);
		value = (preferred ?? choices[0]).id;
	});

	// One account is only "no question to ask" when there is genuinely nothing
	// else to offer — not when a wider list is a click away.
	const canWiden = $derived(canAdjust && !showAll && allAccounts.length > accounts.length);
	const onlyChoice = $derived(choices.length === 1 && !canWiden ? choices[0] : null);
	const id = $derived(`account-select-${name}`);
</script>

{#if onlyChoice}
	<!-- One account means no question to ask. Bare mode still says which one it
	     is, because there it is a line of the entry rather than a field the
	     reader can skip. -->
	<input type="hidden" {name} value={onlyChoice.id} />
	{#if bare}
		<span class="only-choice">{onlyChoice.name}</span>
	{/if}
{:else if choices.length > 0}
	<div class={bare ? 'bare' : 'field'}>
		{#if !bare}
			<label class="field-label" for={id}>{label}{required ? ' *' : ''}</label>
		{/if}
		<select
			{id}
			{name}
			bind:value
			{required}
			{disabled}
			class="account-select"
			aria-label={bare ? label : undefined}
		>
			{#if !required}
				<option value={null}>Paid by a third party</option>
			{/if}
			{#each choices as account (account.id)}
				<option value={account.id}>
					{account.code} · {(account.path ?? [account.name]).join(' › ')} · {AccountTypeDisplayLabels[account.type]}
				</option>
			{/each}
		</select>
		{#if canWiden && !disabled}
			<button type="button" class="widen" onclick={() => (showAll = true)}>
				Choose any account
			</button>
		{:else if showAll && canAdjust && !disabled}
			<button type="button" class="widen" onclick={() => (showAll = false)}>
				Show the usual accounts
			</button>
		{/if}
		{#if disabled && disabledReason}
			<p class="hint">{disabledReason}</p>
		{/if}
	</div>
{/if}

<style>
	.only-choice {
		font-size: 13.5px;
	}
	.bare {
		min-width: 0;
	}
	.account-select {
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
	.account-select:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
	.widen {
		margin-top: 6px;
		padding: 0;
		border: none;
		background: none;
		color: var(--primary);
		font-family: inherit;
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
	}
	.widen:hover {
		text-decoration: underline;
	}
</style>
