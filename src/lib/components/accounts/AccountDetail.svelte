<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { ChevronRight, Landmark, ListTree, Scale, Trash2, Wallet } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import DetailPage from '$lib/components/ui/DetailPage.svelte';
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
	import AuditTrail from '$lib/components/ui/AuditTrail.svelte';
	import { Input } from '$lib/components/ui/input/index.js';
	import OpeningBalanceSheet from './OpeningBalanceSheet.svelte';
	import { createResourceStream } from '$lib/sse.js';
	import { formatDate, formatMinor } from '$lib/format.js';
	import { AccountType, AccountTypeDisplayLabels, type AccountTypeCode } from '$lib/enums.js';
	import type { loadAccountDetail } from '$lib/server/loaders/accounts.js';
	import type { AccountView } from '$lib/server/ledger/types.js';

	/**
	 * One account, on its own page.
	 *
	 * An account is the entity with the most around it and the least in it. Three
	 * fields name it; its balance, its children, what has moved through it and
	 * what it still has to reconcile are the reasons anyone opens it. A 500px
	 * drawer could hold the three fields, so for a while the three fields were
	 * all the app showed — the balance, the reconciliation card and the way
	 * through to the movements were dropped when the chart was standardised, and
	 * their data went on being loaded for a card that no longer rendered.
	 */
	let { data, form }: { data: Awaited<ReturnType<typeof loadAccountDetail>>; form: { error?: string } | null } =
		$props();

	let chart = $derived<AccountView[]>(data.accounts);
	const account = $derived(chart.find((a) => a.id === data.account.id) ?? data.account);
	const children = $derived(chart.filter((a) => a.parentId === account.id));

	const types = Object.values(AccountType).filter(
		(v): v is AccountTypeCode => typeof v === 'number'
	);

	// --- The three fields that name it --------------------------------------
	let name = $state('');
	let selectedType = $state<AccountTypeCode>(AccountType.Asset);
	let parentId = $state<number | null>(null);
	let snapshot = $state('');
	let saving = $state(false);
	let error = $state('');

	function fingerprint(): string {
		return JSON.stringify([name, selectedType, parentId]);
	}

	function seed() {
		name = account.name;
		selectedType = account.type;
		parentId = account.parentId ?? null;
		snapshot = fingerprint();
		error = '';
	}

	let seededId = $state<number | null>(null);
	$effect(() => {
		if (seededId === account.id) return;
		seededId = account.id;
		seed();
	});

	const dirty = $derived(snapshot !== '' && fingerprint() !== snapshot);
	const canEdit = $derived(data.perms.change && !account.isSystem);

	/** A heading can only sit above an account of its own type. */
	const parents = $derived(
		chart.filter((a) => a.id !== account.id && a.type === selectedType && a.active)
	);

	async function save() {
		if (saving) return;
		saving = true;
		error = '';
		const res = await fetch(`/api/accounts/${account.id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name, type: selectedType, parentId })
		});
		saving = false;
		if (!res.ok) {
			const body = await res.json().catch(() => null);
			error = body?.reason ?? body?.error ?? 'That could not be saved.';
			return;
		}
		snapshot = fingerprint();
		auditTrailRef?.refresh();
	}

	// --- Related surfaces ---------------------------------------------------
	let openingOpen = $state(false);
	let deleteDialogOpen = $state(false);
	let auditTrailRef = $state<{ refresh: () => Promise<void> } | null>(null);

	/**
	 * This account's statement: the Records list narrowed to it (D-05).
	 *
	 * `resolve()` builds the route and the account is appended as a query
	 * parameter — a value, not part of the route — so the lint rule cannot see
	 * through the template string.
	 */
	const movementsHref = $derived(
		`${resolve('/(app)/records')}?account=${account.id}`
	);
	const reconcileHref = $derived(
		resolve('/(app)/accounts/[id]/reconcile', { id: String(account.id) })
	);

	/**
	 * Whether reconciling is offered at all (FR-049).
	 *
	 * An inactive account and a heading have nothing to match a bank line
	 * against, so the card would point at a surface with nothing on it.
	 */
	const canReconcile = $derived(
		data.perms.reconcile && account.active && account.postingEligible
	);

	createResourceStream<{ type: string; account?: AccountView; id?: number }>(
		'/api/accounts/stream',
		(m) => {
			if (m.type === 'accounts-refresh') {
				// The whole chart changed underneath us (an upgrade or a bulk
				// renumber), so nothing short of a reload is trustworthy.
				location.reload();
			} else if (m.type === 'account-update' && m.account) {
				const incoming = m.account;
				chart = chart.some((a) => a.id === incoming.id)
					? chart.map((a) => (a.id === incoming.id ? incoming : a))
					: [...chart, incoming];
			} else if (m.type === 'account-deleted' && m.id === account.id) {
				toast('That account was deleted.');
				void goto(resolve('/(app)/accounts'), { replaceState: true });
			}
		}
	);
</script>

<svelte:head><title>{account.code} {account.name} - Akaun</title></svelte:head>

<DetailPage
	backHref="/accounts"
	backLabel="Accounts"
	{dirty}
	{saving}
	onsave={save}
	onrevert={seed}
>
	{#snippet actions()}
		{#if data.perms.delete && !account.isSystem}
			<button
				class="sheet-btn sheet-btn-delete"
				disabled={!account.canDelete}
				title={account.cannotDeleteReason ?? undefined}
				onclick={() => (deleteDialogOpen = true)}
			>
				<Trash2 size={14} /> Delete
			</button>
		{/if}
		{#if canEdit}
			<form method="POST" action="?/update" use:enhance style="display:contents;">
				<input type="hidden" name="id" value={account.id} />
				<button type="submit" class="sheet-btn" name="active" value={account.active ? 'false' : 'true'}>
					{account.active ? 'Deactivate' : 'Reactivate'}
				</button>
			</form>
		{/if}
	{/snippet}

	{#snippet hero()}
		<div class="detail-hero-eyebrow">
			<span>{account.code}</span>
			<span>·</span>
			<span>{AccountTypeDisplayLabels[account.type]}</span>
			{#if account.hasChildren}<span>·</span><span>Heading</span>{/if}
			{#if !account.active}<span>·</span><span>Inactive</span>{/if}
			{#if account.id === data.defaultAccountId}<span>·</span><span>Used by default</span>{/if}
		</div>
		<h1 class="detail-hero-title">{account.name}</h1>
		<div class="detail-hero-figure">
			<span class="detail-hero-amount">
				{formatMinor(account.rolledUpBalanceMinor ?? account.balanceMinor)}
			</span>
			{#if account.hasChildren}
				<span class="detail-hero-note">
					{formatMinor(account.directBalanceMinor ?? 0)} on this account itself
				</span>
			{/if}
		</div>
		{#if account.path && account.path.length > 1}
			<p class="detail-hero-note">{account.path.join(' › ')}</p>
		{/if}
		{#if error || form?.error}<p class="hero-error">{error || form?.error}</p>{/if}
	{/snippet}

	{#snippet main()}
		<!-- What has actually moved through it. The one thing an account is for,
		     and the one thing a drawer could never hold. -->
		<section class="detail-card">
			<div class="detail-card-head">
				<span class="detail-card-title">Recent movements</span>
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- the route comes from resolve(); only the query string is appended. -->
				<a class="detail-card-action" href={movementsHref}>
					See all {data.recentTotal} <ChevronRight size={13} />
				</a>
			</div>
			{#if data.recent.length === 0}
				<p class="empty-note">Nothing has been recorded against this account yet.</p>
			{:else}
				<div class="mv-list">
					{#each data.recent as r (r.id)}
						{@const side = r.movements.find((m) => m.accountId === account.id)}
						<a
							class="mv-row related-link"
							href={resolve('/(app)/records/[id]', { id: String(r.id) })}
						>
							<span class="mv-date">{formatDate(r.date)}</span>
							<span class="mv-desc">{r.description}</span>
							<span class="mv-amount" class:out={(side?.amountMinor ?? 0) < 0}>
								{formatMinor(side?.amountMinor ?? 0)}
							</span>
							<ChevronRight size={13} color="var(--muted-foreground)" />
						</a>
					{/each}
				</div>
				<p class="empty-note">
					A running balance needs the whole account in date order, so it lives on the
					full list rather than on this extract.
				</p>
			{/if}
		</section>

		<section class="detail-card">
			<div class="detail-card-head"><span class="detail-card-title">What it is called</span></div>

			<div class="field">
				<label class="field-label" for="acc-name">Name *</label>
				<Input id="acc-name" bind:value={name} maxlength={120} disabled={!canEdit} class="w-full" />
			</div>

			<div class="field">
				<label class="field-label" for="acc-type">Account type *</label>
				<select id="acc-type" bind:value={selectedType} class="plain-select" disabled={!canEdit}>
					{#each types as type (type)}
						<option value={type}>{AccountTypeDisplayLabels[type]}</option>
					{/each}
				</select>
				<p class="field-hint">
					The type decides which report this appears on and which direction its balance
					normally runs.
				</p>
			</div>

			<div class="field" style="margin-bottom:0;">
				<label class="field-label" for="acc-parent">Parent heading</label>
				<select id="acc-parent" bind:value={parentId} class="plain-select" disabled={!canEdit}>
					<option value={null}>None</option>
					{#each parents as parent (parent.id)}
						<option value={parent.id}>{parent.code} · {parent.path?.join(' › ')}</option>
					{/each}
				</select>
			</div>
		</section>
	{/snippet}

	{#snippet rail()}
		<section class="detail-card">
			<div class="detail-card-head"><span class="detail-card-title">Starting balance</span></div>
			<button class="related-link ob-card" onclick={() => (openingOpen = true)} disabled={!data.perms.change}>
				<span class="ob-icon"><Wallet size={15} /></span>
				<span class="ob-main">
					<span class="ob-title">
						{data.openingBalance ? formatMinor(data.openingBalance.amountMinor) : 'None set'}
					</span>
					<span class="ob-sub">
						{data.openingBalance
							? `As at ${formatDate(data.openingBalance.date)}`
							: 'What was already here when the books started'}
					</span>
				</span>
				<ChevronRight size={14} color="var(--muted-foreground)" />
			</button>
		</section>

		{#if children.length > 0}
			<section class="detail-card">
				<div class="detail-card-head">
					<span class="detail-card-title">Accounts under this</span>
				</div>
				<div class="child-list">
					{#each children as child (child.id)}
						<a
							class="related-link ob-card"
							href={resolve('/(app)/accounts/[id]', { id: String(child.id) })}
						>
							<span class="ob-icon"><ListTree size={15} /></span>
							<span class="ob-main">
								<span class="ob-title">{child.name}</span>
								<span class="ob-sub">
									{child.code} · {formatMinor(child.rolledUpBalanceMinor ?? child.balanceMinor)}
								</span>
							</span>
							<ChevronRight size={14} color="var(--muted-foreground)" />
						</a>
					{/each}
				</div>
			</section>
		{/if}

		{#if canReconcile}
			<!-- There is no top-level Reconciliation list any more. If the only way
			     in is through the account, the account has to say whether there is
			     anything waiting (FR-053). -->
			<section class="detail-card">
				<div class="detail-card-head"><span class="detail-card-title">Bank reconciliation</span></div>
				<a class="related-link ob-card" href={reconcileHref}>
					<span class="ob-icon"><Scale size={15} /></span>
					<span class="ob-main">
						<span class="ob-title">
							{data.unfinishedStatements > 0
								? `${data.unfinishedStatements} statement${data.unfinishedStatements === 1 ? '' : 's'} still open`
								: 'Statements'}
						</span>
						<span class="ob-sub">Match this account against what the bank says.</span>
					</span>
					<ChevronRight size={14} color="var(--muted-foreground)" />
				</a>
			</section>
		{/if}

		<section class="detail-card">
			<div class="detail-card-head"><span class="detail-card-title">Every movement</span></div>
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- the route comes from resolve(); only the query string is appended. -->
			<a class="related-link ob-card" href={movementsHref}>
				<span class="ob-icon"><Landmark size={15} /></span>
				<span class="ob-main">
					<span class="ob-title">See every movement</span>
					<span class="ob-sub">
						{data.recentTotal} record{data.recentTotal === 1 ? '' : 's'}, with a running balance
					</span>
				</span>
				<ChevronRight size={14} color="var(--muted-foreground)" />
			</a>
		</section>

		<section class="detail-card">
			<div class="detail-card-head"><span class="detail-card-title">History</span></div>
			<AuditTrail bind:this={auditTrailRef} recordType="account" recordId={account.id} />
		</section>
	{/snippet}
</DetailPage>

<OpeningBalanceSheet
	bind:open={openingOpen}
	{account}
	existing={data.openingBalance}
	error={form?.error ?? ''}
	onclose={() => (openingOpen = false)}
/>

<!-- Delete posts the form action, which redirects to the list on success: the
     server knows the account is gone, so it says where to go next. -->
<form method="POST" action="?/delete" use:enhance id="account-delete-form" hidden>
	<input type="hidden" name="id" value={account.id} />
</form>

<ConfirmDialog
	bind:open={deleteDialogOpen}
	title="Delete this account?"
	description="This removes the account from the chart. It is only possible while nothing has been recorded against it."
	confirmLabel="Delete"
	danger
	onConfirm={() =>
		(document.getElementById('account-delete-form') as HTMLFormElement)?.requestSubmit()}
/>

<style>
	.hero-error {
		background: var(--red-soft);
		color: var(--red);
		border-radius: 8px;
		padding: 8px 12px;
		font-size: 13px;
		margin: 8px 0 0;
	}
	.empty-note {
		font-size: 12px;
		color: var(--muted-foreground);
		line-height: 1.5;
		margin: 10px 0 0;
	}
	.mv-list,
	.child-list {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.mv-row {
		display: grid;
		grid-template-columns: 92px minmax(0, 1fr) auto 13px;
		align-items: center;
		gap: 12px;
		padding: 9px 12px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--card);
		color: inherit;
		text-decoration: none;
	}
	.mv-date {
		font-family: 'Geist Mono', monospace;
		font-size: 12px;
		color: var(--muted-foreground);
		font-variant-numeric: tabular-nums;
	}
	.mv-desc {
		font-size: 13px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.mv-amount {
		font-family: 'Geist Mono', monospace;
		font-variant-numeric: tabular-nums;
		font-size: 13px;
		font-weight: 600;
		text-align: right;
	}
	.mv-amount.out {
		color: var(--muted-foreground);
	}

	@media (max-width: 767px) {
		.mv-row {
			grid-template-columns: minmax(0, 1fr) auto;
			gap: 4px 10px;
		}
		.mv-date {
			grid-column: 1 / -1;
		}
	}
</style>
