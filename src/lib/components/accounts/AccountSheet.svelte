<script lang="ts">
	import { enhance } from '$app/forms';
	import { X } from '@lucide/svelte';
	import * as Sheet from '$lib/components/ui/sheet/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { useIsMobile } from '$lib/hooks/useIsMobile.svelte.js';
	import { AccountType, AccountTypeDisplayLabels, type AccountTypeCode } from '$lib/enums.js';
	import type { AccountView } from '$lib/server/ledger/types.js';

	/**
	 * Adding an account to the chart.
	 *
	 * Create only. Editing an existing account happens in place on
	 * `/accounts/[id]` — a page can show what an account *is* (its balance, its
	 * children, its movements, what it still has to reconcile) beside the three
	 * fields that name it, which a 500px panel never could.
	 */
	let {
		open = $bindable(false),
		accounts = [],
		error = '',
		onclose
	}: {
		open?: boolean;
		accounts?: AccountView[];
		error?: string;
		onclose: () => void;
	} = $props();

	const screen = useIsMobile();
	const isMobile = $derived(screen.current);
	const panelSide = $derived(isMobile ? 'bottom' : 'right');

	const types = Object.values(AccountType).filter(
		(v): v is AccountTypeCode => typeof v === 'number'
	);

	let selectedType = $state<AccountTypeCode>(AccountType.Asset);

	/** A heading can only sit above an account of its own type. */
	const parents = $derived(accounts.filter((a) => a.type === selectedType && a.active));
</script>

<Sheet.Root
	{open}
	onOpenChange={(v) => {
		if (!v) onclose();
	}}
>
	<Sheet.Content
		side={panelSide}
		style={isMobile
			? 'height:100dvh; border-radius:0; border-top:none; display:flex; flex-direction:column; overflow:hidden; gap:0;'
			: 'width:500px; max-width:95vw; display:flex; flex-direction:column; overflow:hidden; gap:0;'}
	>
		<div class="sheet-head">
			<div>
				<div class="sheet-eyebrow">New</div>
				<div class="sheet-title-text">Add account</div>
			</div>
			<Sheet.Close class="sheet-close"><X size={16} /></Sheet.Close>
		</div>

		<form method="POST" action="?/create" use:enhance class="sheet-form">
			<div class="sheet-body">
				{#if error}
					<p class="form-error">{error}</p>
				{/if}

				<div class="field">
					<label class="field-label" for="account-name">Name *</label>
					<Input id="account-name" name="name" required maxlength={120} class="w-full" />
				</div>

				<div class="field">
					<label class="field-label" for="account-type">Account type *</label>
					<select id="account-type" name="type" bind:value={selectedType} class="plain-select">
						{#each types as type (type)}
							<option value={type}>{AccountTypeDisplayLabels[type]}</option>
						{/each}
					</select>
					<p class="field-hint">
						The type decides which report the account appears on, and it cannot be changed
						once the account has movements.
					</p>
				</div>

				<div class="field">
					<label class="field-label" for="account-parent">Parent heading</label>
					<select id="account-parent" name="parentId" class="plain-select">
						<option value="">None</option>
						{#each parents as parent (parent.id)}
							<option value={parent.id}>{parent.code} · {parent.path?.join(' › ')}</option>
						{/each}
					</select>
				</div>
			</div>

			<footer class="sheet-foot">
				<div class="sheet-foot-actions">
					<button type="button" class="sheet-btn" onclick={onclose}>Cancel</button>
					<button type="submit" class="sheet-btn sheet-btn-primary">Create account</button>
				</div>
			</footer>
		</form>
	</Sheet.Content>
</Sheet.Root>

<style>
	.sheet-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		padding: 22px 22px 16px;
		border-bottom: 1px solid var(--border);
	}
	.sheet-form {
		flex: 1;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
	.sheet-body {
		flex: 1;
		overflow-y: auto;
		padding: 20px 22px;
	}
	.form-error {
		background: var(--red-soft);
		color: var(--red);
		border-radius: 8px;
		padding: 10px 12px;
		font-size: 13px;
		margin: 0 0 14px;
	}
</style>
