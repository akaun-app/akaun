<script lang="ts">
	import { roleLabel } from '$lib/components/accounts/account-roles.js';
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
		value = $bindable<number | null>(null),
		name,
		label = 'Paid from',
		defaultAccountId = null,
		required = true,
		disabled = false,
		disabledReason = ''
	}: {
		accounts: AccountView[];
		value?: number | null;
		name: string;
		label?: string;
		defaultAccountId?: number | null;
		required?: boolean;
		disabled?: boolean;
		disabledReason?: string;
	} = $props();

	// Archived accounts stay out of the picker but never disappear from history.
	const choices = $derived(
		accounts
			.filter((a) => a.archivedAt == null || a.id === value)
			.sort((a, b) => a.role - b.role || a.rank.localeCompare(b.rank))
	);

	// Pre-select once there is something to select. Guarded on `value` being
	// unset so re-running this never overwrites what the user picked.
	$effect(() => {
		if (value != null || choices.length === 0) return;
		const preferred = choices.find((a) => a.id === defaultAccountId);
		value = (preferred ?? choices[0]).id;
	});

	const onlyChoice = $derived(choices.length === 1 ? choices[0] : null);
	const id = $derived(`account-select-${name}`);
</script>

{#if onlyChoice}
	<!-- One account means no question to ask. -->
	<input type="hidden" {name} value={onlyChoice.id} />
{:else if choices.length > 0}
	<div class="field">
		<label class="field-label" for={id}>{label}{required ? ' *' : ''}</label>
		<select {id} {name} bind:value {required} {disabled} class="account-select">
			{#if !required}
				<option value={null}>Someone else paid</option>
			{/if}
			{#each choices as account (account.id)}
				<option value={account.id}>
					{account.name}{account.archivedAt ? ' (archived)' : ''} · {roleLabel(account.role)}
				</option>
			{/each}
		</select>
		{#if disabled && disabledReason}
			<p class="hint">{disabledReason}</p>
		{/if}
	</div>
{/if}

<style>
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
	.hint {
		font-size: 12px;
		color: var(--muted-foreground);
		margin: 6px 0 0;
		line-height: 1.5;
	}
</style>
