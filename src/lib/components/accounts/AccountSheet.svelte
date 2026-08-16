<script lang="ts">
	import { enhance } from '$app/forms';
	import {
		X,
		Trash2,
		Archive,
		ArchiveRestore,
		Scale,
		History,
		ChevronRight
	} from '@lucide/svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import * as Sheet from '$lib/components/ui/sheet/index.js';
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
	import AuditTrail from '$lib/components/ui/AuditTrail.svelte';
	import { Input } from '$lib/components/ui/input/index.js';
	import { useIsMobile } from '$lib/hooks/useIsMobile.svelte.js';
	import { formatMinor } from '$lib/format.js';
	import { AccountRole } from '$lib/enums.js';
	import type { AccountView } from '$lib/server/ledger/types.js';
	import { CREATABLE_ROLES, roleLabel } from './account-roles.js';
	import { isCategoryRole } from './display-sign.js';

	let {
		open = $bindable(false),
		account = null,
		canDelete = false,
		canChange = false,
		error = '',
		onclose,
		onOpeningBalance
	}: {
		open?: boolean;
		account?: AccountView | null;
		canDelete?: boolean;
		canChange?: boolean;
		error?: string;
		onclose: () => void;
		onOpeningBalance: (account: AccountView) => void;
	} = $props();

	const screen = useIsMobile();
	const isMobile = $derived(screen.current);
	const panelSide = $derived(isMobile ? 'bottom' : 'right');

	// Writable `$derived`: re-seeds the role picker whenever a different account
	// opens the sheet, while still following the radio group as the user picks.
	let role = $derived<number>(account ? account.role : AccountRole.Bank);
	let auditTrailRef = $state<{ refresh: () => Promise<void> } | null>(null);
	let deleteDialogOpen = $state(false);
	let deleteFormEl = $state<HTMLFormElement | null>(null);

	const isArchived = $derived(account?.archivedAt != null);
	// A category says what money was spent on or earned from; it holds nothing,
	// so "what was already in it" is not a question that means anything.
	const isCategoryAccount = $derived(account !== null && isCategoryRole(account.role));
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
					<div class="sheet-eyebrow">{account ? 'Edit' : 'New'}</div>
					<div class="sheet-title-text">{account ? 'Edit account' : 'Add account'}</div>
				</div>
				<Sheet.Close class="sheet-close"><X size={16} /></Sheet.Close>
			</div>

			<form
				method="POST"
				action={account ? '?/update' : '?/create'}
				use:enhance={() => async ({ update }) => {
					await update();
					auditTrailRef?.refresh();
				}}
				style="flex:1; display:flex; flex-direction:column; overflow:hidden;"
			>
				{#if account}<input type="hidden" name="id" value={account.id} />{/if}

				<div style="flex:1; overflow-y:auto; padding:20px 22px;">
					{#if error}
						<div
							style="background:var(--red-soft); color:var(--red); border-radius:8px; padding:10px 14px; font-size:13px; margin-bottom:16px;"
						>
							{error}
						</div>
					{/if}

					{#if account}
						<div class="detail-amount">{formatMinor(account.balanceMinor)}</div>
						<div class="detail-statusrow">
							<span class="account-kind">{roleLabel(account.role)}</span>
							{#if isArchived}
								<span class="account-archived">Archived</span>
							{/if}
						</div>
					{/if}

					<div class="field">
						<label class="field-label" for="account-name">Name *</label>
						<Input
							id="account-name"
							name="name"
							required
							maxlength={120}
							value={account?.name ?? ''}
							class="w-full"
						/>
					</div>

					{#if !account}
						<div class="field">
							<span class="field-label">What kind of account is this? *</span>
							<div style="display:flex; gap:8px; flex-wrap:wrap;">
								{#each CREATABLE_ROLES as option (option)}
									<label
										style="display:inline-flex; align-items:center; gap:6px; border:1px solid {role ===
										option
											? 'var(--primary)'
											: 'var(--border)'}; border-radius:8px; padding:6px 12px; font-size:13px; cursor:pointer; background:{role ===
										option
											? 'color-mix(in srgb, var(--primary) 10%, transparent)'
											: 'var(--card)'};"
									>
										<input
											type="radio"
											name="role"
											value={option}
											bind:group={role}
											style="display:none;"
										/>
										{roleLabel(option)}
									</label>
								{/each}
							</div>
						</div>
					{:else}
						<!-- A role cannot change: an account that has been a bank account
						     cannot become a category without rewriting what every record
						     against it meant. -->
						<p class="field-note">
							This is a {roleLabel(account.role).toLowerCase()} account. That cannot be changed —
							{account.movementCount === 0 ? 'delete it and add a new one instead.' : 'the records already against it depend on it.'}
						</p>
					{/if}

					{#if account && account.movementCount > 0}
						<!--
							The account's own history is a full page rather than a drawer —
							it is a report read across and exported, which is the named
							exception in CLAUDE.md. This is the relation-card contract's
							single-action shape: the whole row is one button, and the
							trailing chevron says it goes somewhere before you hover.
						-->
						<button
							type="button"
							class="related-link ob-card"
							onclick={() =>
								goto(resolve('/(app)/accounts/[id]/history', { id: String(account.id) }))}
						>
							<span class="ob-icon"><History size={15} /></span>
							<span class="ob-main">
								<span class="ob-title">See every movement</span>
								<span class="ob-sub">
									{account.movementCount}
									{account.movementCount === 1 ? 'record' : 'records'}, with a running balance
								</span>
							</span>
							<ChevronRight size={14} color="var(--muted-foreground)" />
						</button>
					{/if}

					{#if account && canChange && !isCategoryAccount}
						<button
							type="button"
							class="related-link ob-card"
							onclick={() => onOpeningBalance(account)}
						>
							<span class="ob-icon"><Scale size={15} /></span>
							<span class="ob-main">
								<span class="ob-title">Starting balance</span>
								<span class="ob-sub">What was in this account before you started</span>
							</span>
							<ChevronRight size={14} color="var(--muted-foreground)" />
						</button>
					{/if}

					{#if account}
						<AuditTrail bind:this={auditTrailRef} recordType="account" recordId={account.id} />
					{/if}
				</div>

				<div class="sheet-foot">
					{#if account && !account.canDelete && account.cannotDeleteReason}
						<div class="sheet-foot-note">{account.cannotDeleteReason}</div>
					{/if}
					<div class="sheet-foot-actions">
						{#if account && canDelete}
							<button
								type="button"
								class="sheet-btn sheet-btn-delete"
								style="margin-right:auto;"
								disabled={!account.canDelete}
								title={account.cannotDeleteReason ?? undefined}
								onclick={() => (deleteDialogOpen = true)}
							>
								<Trash2 size={14} /> Delete
							</button>
						{/if}
						{#if account && !account.isSystem}
							<button
								type="submit"
								class="sheet-btn"
								formaction="?/update"
								name="archived"
								value={isArchived ? 'false' : 'true'}
							>
								{#if isArchived}<ArchiveRestore size={14} />{:else}<Archive size={14} />{/if}
								{isArchived ? 'Restore' : 'Archive'}
							</button>
						{/if}
						<button type="button" class="sheet-btn" onclick={onclose}>Cancel</button>
						<button type="submit" class="sheet-btn sheet-btn-primary">
							{account ? 'Save changes' : 'Create account'}
						</button>
					</div>
				</div>
			</form>
		</Sheet.Content>
	</Sheet.Portal>
</Sheet.Root>

<form method="POST" action="?/delete" use:enhance style="display:none" bind:this={deleteFormEl}>
	<input type="hidden" name="id" value={account?.id ?? ''} />
</form>
<ConfirmDialog
	bind:open={deleteDialogOpen}
	title="Delete {account?.name ?? 'account'}?"
	description="Nothing is recorded against this account, so removing it changes no figures. This can't be undone."
	confirmLabel="Delete account"
	danger
	onConfirm={() => deleteFormEl?.requestSubmit()}
/>

<style>
	.account-kind {
		display: inline-flex;
		align-items: center;
		font-size: 11.5px;
		background: var(--secondary);
		color: var(--secondary-foreground);
		padding: 2px 9px;
		border-radius: 999px;
		white-space: nowrap;
	}
	.account-archived {
		display: inline-flex;
		align-items: center;
		font-size: 11.5px;
		background: var(--amber-soft);
		color: var(--amber);
		padding: 2px 9px;
		border-radius: 999px;
		white-space: nowrap;
	}
	.field-note {
		font-size: 12px;
		color: var(--muted-foreground);
		margin: 0 0 16px;
		line-height: 1.5;
	}
	.ob-card {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
		padding: 10px 12px;
		margin-top: 4px;
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
</style>
