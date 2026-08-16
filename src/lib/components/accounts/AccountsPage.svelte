<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { goto, pushState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import {
		ArrowLeftRight,
		ChevronRight,
		Landmark,
		Plus,
		Scale,
		Wallet
	} from '@lucide/svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { formatMinor } from '$lib/format.js';
	import { displaySignFor, isMoneyPotRole } from './display-sign.js';
	import { ROLE_GROUPS, roleLabel } from './account-roles.js';
	import AccountSheet from './AccountSheet.svelte';
	import OpeningBalanceSheet from './OpeningBalanceSheet.svelte';
	import RecordSheet from '$lib/components/ledger/RecordSheet.svelte';
	import type { AccountView } from '$lib/server/ledger/types.js';
	import type { loadAccountsPage } from '$lib/server/loaders/accounts.js';

	type PageData = ReturnType<typeof loadAccountsPage>;
	type ActionData = { error?: string; success?: boolean; id?: number; deleted?: boolean } | null;

	let { data, form, openId }: { data: PageData; form: ActionData; openId: number | null } =
		$props();

	// Writable `$derived`, so a fresh server load replaces the chart and an
	// incoming stream event can still merge into it.
	let accounts = $derived(data.accounts);

	let showArchived = $state(false);

	const visible = $derived(showArchived ? accounts : accounts.filter((a) => !a.archivedAt));
	const archivedCount = $derived(accounts.filter((a) => a.archivedAt != null).length);

	/** The groups that actually have something in them, in the documented order. */
	const groups = $derived(
		ROLE_GROUPS.map((group) => ({
			...group,
			rows: visible
				.filter((a) => (group.roles as number[]).includes(a.role))
				.sort((a, b) => a.role - b.role || a.rank.localeCompare(b.rank))
		})).filter((group) => group.rows.length > 0)
	);

	/**
	 * A place money sits should never hold less than nothing. When it does, it is
	 * almost always a timing difference rather than an error — the classic case
	 * is a withdrawal recorded before the statement it came out of, which leaves
	 * a wallet showing minus until the statement is entered (US2/AC6). Saying so
	 * is the difference between a gap that is explained and a figure that just
	 * looks wrong.
	 *
	 * Only money-holding accounts qualify. Money we owe and income categories sit
	 * negative by nature, and `displaySign` already turns those the right way up.
	 */
	const BELOW_ZERO_HINT =
		'This account is showing less than nothing. That usually means something was recorded before the statement it came from — enter the missing one and it will settle.';

	function isBelowZero(account: AccountView): boolean {
		return isMoneyPotRole(account.role) && account.balanceMinor < 0;
	}

	const belowZeroAccounts = $derived(visible.filter(isBelowZero));

	/**
	 * What the business holds, at a glance: every place money sits, added up.
	 * Categories are left out — they say what money was spent on, not where it is.
	 */
	const heldMinor = $derived(
		accounts
			.filter((a) => (ROLE_GROUPS[0].roles as number[]).includes(a.role))
			.reduce((sum, a) => sum + a.balanceMinor, 0)
	);

	/**
	 * Every place money actually sits. Moving money is only a question worth
	 * asking once there are two of them — with one account there is nowhere to
	 * move it to (FR-007).
	 */
	const moneyPots = $derived(
		accounts.filter((a) => isMoneyPotRole(a.role) && a.archivedAt == null)
	);
	const canMoveMoney = $derived(data.perms.change && moneyPots.length > 1);

	// --- Sheets -------------------------------------------------------------
	let sheetOpen = $state(false);
	let transferOpen = $state(false);
	let editing = $state<AccountView | null>(null);
	let openingBalanceOpen = $state(false);
	let openingBalanceFor = $state<AccountView | null>(null);

	/** The live row, so an SSE update while the drawer is open is reflected in it. */
	const editingLive = $derived(
		editing ? (accounts.find((a) => a.id === editing!.id) ?? editing) : null
	);

	function openCreate() {
		editing = null;
		sheetOpen = true;
	}

	function openDetail(account: AccountView, { push = true } = {}) {
		editing = account;
		sheetOpen = true;
		if (push) {
			pushState(resolve('/(app)/accounts/[id]', { id: String(account.id) }), { viaPush: true });
		}
	}

	function closeDetail() {
		const wasExisting = editing !== null;
		sheetOpen = false;
		editing = null;
		if (!wasExisting) return;
		if (page.state.viaPush) {
			history.back();
		} else {
			goto(resolve('/accounts'), { replaceState: true, noScroll: true });
		}
	}

	onMount(() => {
		if (openId) {
			const found = accounts.find((a) => a.id === openId);
			if (found) openDetail(found, { push: false });
		}
	});

	$effect(() => {
		if (form?.success) {
			sheetOpen = false;
			openingBalanceOpen = false;
			editing = null;
		}
	});

	// --- Live updates -------------------------------------------------------
	// Opened in onMount and closed in onDestroy — never in $effect, which re-runs
	// on reactive changes and would tear the connection down (CLAUDE.md).
	let source: EventSource | null = null;

	onMount(() => {
		source = new EventSource('/api/accounts/stream');
		source.onmessage = (event) => {
			let msg: { type: string; account?: AccountView; id?: number };
			try {
				msg = JSON.parse(event.data);
			} catch {
				return;
			}
			if (msg.type === 'account-update' && msg.account) {
				const incoming = msg.account;
				const known = accounts.some((a) => a.id === incoming.id);
				accounts = known
					? accounts.map((a) => (a.id === incoming.id ? incoming : a))
					: [...accounts, incoming];
			} else if (msg.type === 'account-deleted' && msg.id !== undefined) {
				accounts = accounts.filter((a) => a.id !== msg.id);
			}
		};
	});

	onDestroy(() => {
		source?.close();
		source = null;
	});
</script>

<div class="screen">
	<header class="topbar">
		<div class="topbar-left">
			<h1 class="page-title">Accounts</h1>
			<p class="page-sub">
				{accounts.length} total · {formatMinor(heldMinor)} held
			</p>
		</div>
		<div class="topbar-right">
			{#if archivedCount > 0}
				<button
					type="button"
					class="sheet-btn"
					onclick={() => (showArchived = !showArchived)}
				>
					{showArchived ? 'Hide' : 'Show'} archived ({archivedCount})
				</button>
			{/if}
			{#if canMoveMoney}
				<button type="button" class="sheet-btn" onclick={() => (transferOpen = true)}>
					<ArrowLeftRight size={14} /> Move money
				</button>
			{/if}
			{#if data.perms.add}
				<button type="button" class="sheet-btn sheet-btn-primary" onclick={openCreate}>
					<Plus size={14} /> Add account
				</button>
			{/if}
		</div>
	</header>

	<div class="content">
		<div class="content-inner">
			{#if form?.error && !sheetOpen && !openingBalanceOpen}
				<div class="page-error">{form.error}</div>
			{/if}

			{#if belowZeroAccounts.length > 0}
				<div class="page-note">
					<b
						>{belowZeroAccounts.map((a) => a.name).join(', ')}
						{belowZeroAccounts.length === 1 ? 'is' : 'are'} showing less than nothing.</b
					>
					{BELOW_ZERO_HINT.replace('This account is showing less than nothing. ', '')}
				</div>
			{/if}

			{#if groups.length === 0}
				<EmptyState
					title="No accounts yet"
					sub="Accounts are the places your money sits and the categories you spend it on."
				>
					{#snippet icon()}<Landmark size={20} />{/snippet}
					{#snippet action()}
						{#if data.perms.add}
							<button class="link-btn" onclick={openCreate}>Add your first account</button>
						{/if}
					{/snippet}
				</EmptyState>
			{/if}

			{#each groups as group (group.title)}
				<section class="acct-group">
					<div class="acct-group-head">
						<h2 class="acct-group-title">{group.title}</h2>
						<p class="acct-group-sub">{group.sub}</p>
					</div>
					<div class="table-card">
						{#each group.rows as account (account.id)}
							<button
								type="button"
								class="acct-row related-link"
								class:archived={account.archivedAt != null}
								onclick={() => openDetail(account)}
							>
								<span class="acct-icon">
									{#if (ROLE_GROUPS[0].roles as number[]).includes(account.role)}
										<Wallet size={15} />
									{:else}
										<Scale size={15} />
									{/if}
								</span>
								<span class="acct-main">
									<span class="acct-name">{account.name}</span>
									<span class="acct-sub">
										{roleLabel(account.role)}
										{#if account.archivedAt}· Archived{/if}
										{#if account.id === data.defaultAccountId}· Used by default{/if}
										· {account.movementCount}
										{account.movementCount === 1 ? 'record' : 'records'}
									</span>
								</span>
								<span
									class="acct-balance"
									class:below-zero={isBelowZero(account)}
									title={isBelowZero(account) ? BELOW_ZERO_HINT : undefined}
								>
									{formatMinor(account.balanceMinor * displaySignFor(account.role))}
								</span>
								<ChevronRight size={14} color="var(--muted-foreground)" />
							</button>
						{/each}
					</div>
				</section>
			{/each}
		</div>
	</div>
</div>

<AccountSheet
	bind:open={sheetOpen}
	account={editingLive}
	canDelete={data.perms.delete}
	canChange={data.perms.change}
	error={form?.error ?? ''}
	onclose={closeDetail}
	onOpeningBalance={(account) => {
		openingBalanceFor = account;
		openingBalanceOpen = true;
	}}
/>

<!--
	Moving money between two places you hold. It lives here rather than on the
	Expenses screen because it is neither an expense nor income — a transfer
	recorded there would vanish from the list it was created on the moment it
	saved (FR-007). This is the everyday half of US2's Shopee routine: each
	withdrawal is one action from here, and the reconciliation workspace covers
	the other half, turning an unmatched bank line into the same thing.
-->
<RecordSheet
	bind:open={transferOpen}
	kind="transfer"
	accounts={moneyPots}
	categories={[]}
	defaultAccountId={data.defaultAccountId}
	canChange={data.perms.change}
	onclose={() => (transferOpen = false)}
	onsaved={() => (transferOpen = false)}
/>

<OpeningBalanceSheet
	bind:open={openingBalanceOpen}
	account={openingBalanceFor}
	error={form?.error ?? ''}
	onclose={() => {
		openingBalanceOpen = false;
		openingBalanceFor = null;
	}}
/>

<style>
	.acct-group {
		margin-bottom: 28px;
	}
	.acct-group-head {
		margin-bottom: 10px;
	}
	.acct-group-title {
		font-size: 14px;
		font-weight: 600;
		margin: 0;
	}
	.acct-group-sub {
		font-size: 12px;
		color: var(--muted-foreground);
		margin: 2px 0 0;
	}
	.acct-row {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
		padding: 12px 14px;
		background: var(--card);
		border: none;
		border-bottom: 1px solid var(--border);
		font-family: inherit;
		text-align: left;
	}
	.acct-row:last-child {
		border-bottom: none;
	}
	.acct-row.archived {
		opacity: 0.55;
	}
	.acct-icon {
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
	.acct-main {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
		flex: 1;
	}
	.acct-name {
		font-size: 13.5px;
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.acct-sub {
		font-size: 11.5px;
		color: var(--muted-foreground);
	}
	.acct-balance {
		font-size: 13.5px;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.acct-balance.below-zero {
		color: var(--amber);
	}
	.page-note {
		background: var(--amber-soft);
		color: var(--amber);
		border-radius: 8px;
		padding: 10px 14px;
		font-size: 13px;
		line-height: 1.5;
		margin-bottom: 16px;
	}
	.page-error {
		background: var(--red-soft);
		color: var(--red);
		border-radius: 8px;
		padding: 10px 14px;
		font-size: 13px;
		margin-bottom: 16px;
	}
</style>
