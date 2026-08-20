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
		Search,
		Tag,
	} from '@lucide/svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { Input } from '$lib/components/ui/input/index.js';
	import { formatMinor } from '$lib/format.js';
	import { AccountRole } from '$lib/enums.js';
	import { displaySignFor, isMoneyPotRole } from './display-sign.js';
	import {
		ROLE_FILTERS,
		ACCOUNT_ROLES,
		CATEGORY_ROLES,
		MONEY_POT_FILTER_ROLES,
		roleLabel
	} from './account-roles.js';
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
	// Both filters run over the already-loaded list. The loader fetches every
	// account with `includeArchived: true`, and a hundred rows cost nothing to
	// filter in the browser — a round trip per keystroke would cost more
	// (research.md R-12).
	let search = $state('');
	let roleFilter = $state<string | null>(null);


	const visible = $derived(showArchived ? accounts : accounts.filter((a) => !a.archivedAt));
	const archivedCount = $derived(accounts.filter((a) => a.archivedAt != null).length);

	/**
	 * One flat list, in the query's existing stable order.
	 *
	 * No headings. Two accounts named "Fuel" in different roles are told apart by
	 * the sort of account each one is, shown on its own row, rather than by which
	 * section they were filed under (FR-015, FR-016).
	 */
	/**
	 * What this screen lists: the balance-sheet half only.
	 *
	 * Categories live on their own screen. They are still accounts underneath —
	 * a category is one side of a record (002 FR-006a) — but a list of 22
	 * categories and 4 accounts read as nothing but categories, which is not
	 * what a person opening "Accounts" is looking for.
	 */
	const listed = $derived(visible.filter((a) => (ACCOUNT_ROLES as number[]).includes(a.role)));

	/** How many categories are waiting on the other screen, for the card below. */
	const categoryCounts = $derived({
		spending: visible.filter((a) => a.role === AccountRole.ExpenseCategory).length,
		earning: visible.filter((a) => a.role === AccountRole.IncomeCategory).length,
		total: visible.filter((a) => (CATEGORY_ROLES as number[]).includes(a.role)).length
	});

	/** Only the chips that apply to what this screen lists, and are non-empty. */
	const availableFilters = $derived(
		ROLE_FILTERS.filter(
			(f) =>
				f.roles.some((r) => (ACCOUNT_ROLES as number[]).includes(r)) &&
				listed.some((a) => (f.roles as number[]).includes(a.role))
		)
	);

	const rows = $derived.by(() => {
		let out = listed;

		if (roleFilter !== null) {
			const roles = ROLE_FILTERS.find((f) => f.title === roleFilter)?.roles ?? [];
			out = out.filter((a) => (roles as number[]).includes(a.role));
		}

		const q = search.trim().toLowerCase();
		if (q) out = out.filter((a) => a.name.toLowerCase().includes(q));

		return out
			.slice()
			.sort((a, b) => a.role - b.role || a.rank.localeCompare(b.rank));
	});



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
			.filter((a) => (MONEY_POT_FILTER_ROLES as number[]).includes(a.role))
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

	/** The other half of the chart: what money was earned and spent on. */
	function openCategories(): void {
		void goto(resolve('/(app)/categories'));
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
			{#if accounts.length > 0}
				<div class="search-box">
					<div style="position:relative; display:flex; align-items:center;">
						<span
							style="position:absolute; left:10px; color:var(--muted-foreground); display:flex; pointer-events:none;"
						>
							<Search size={15} />
						</span>
						<Input
							type="search"
							placeholder="Search accounts by name…"
							bind:value={search}
							class="h-[34px] pl-8 text-[13px]"
						/>
					</div>
				</div>
			{/if}
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

	<div class="page-scroll">
		<div class="page-inner">
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

			{#if accounts.length === 0}
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

			{#if accounts.length > 0}
				<div class="toolbar">
					<div class="status-tabs">
						<button
							type="button"
							class="status-tab"
							class:active={roleFilter === null}
							onclick={() => (roleFilter = null)}
						>
							All<span class="tab-count">{listed.length}</span>
						</button>
						{#each availableFilters as filter (filter.title)}
							<button
								type="button"
								class="status-tab"
								class:active={roleFilter === filter.title}
								onclick={() =>
									(roleFilter = roleFilter === filter.title ? null : filter.title)}
							>
								{filter.title}<span class="tab-count"
									>{listed.filter((a) => (filter.roles as number[]).includes(a.role))
										.length}</span
								>
							</button>
						{/each}
					</div>
				</div>
			{/if}

			<!-- The same table every other list screen uses, so a reader moving
			     between them meets one shape. Rows become ordered cards on mobile
			     through the shared `.exp-table` rules. -->
			<div class="table-card">
				<table class="exp-table">
					<thead>
						<tr>
							<th>Account</th>
							<th>Kind</th>
							<th>Records</th>
							<th class="ta-right">Balance</th>
						</tr>
					</thead>
					<tbody>
						{#each rows as account (account.id)}
							<tr
								class="exp-row"
								class:archived={account.archivedAt != null}
								tabindex="0"
								onclick={() => openDetail(account)}
								onkeydown={(event) => {
									if (event.key === 'Enter' || event.key === ' ') {
										event.preventDefault();
										openDetail(account);
									}
								}}
							>
								<td class="td-primary" data-label="Account">
									<div class="cell-item">
										<span class="cell-itemname">{account.name}</span>
										<span class="cell-itemnum">
											{#if account.archivedAt}Archived{/if}
											{#if account.id === data.defaultAccountId}{account.archivedAt
													? ' · '
													: ''}Used by default{/if}
										</span>
									</div>
								</td>
								<td data-label="Kind">{roleLabel(account.role)}</td>
								<td data-label="Records">
									{account.movementCount}
									{account.movementCount === 1 ? 'record' : 'records'}
								</td>
								<td class="td-amount" data-label="Balance">
									<span
										class="amount-num"
										class:below-zero={isBelowZero(account)}
										title={isBelowZero(account) ? BELOW_ZERO_HINT : undefined}
									>
										{formatMinor(account.balanceMinor * displaySignFor(account.role))}
									</span>
								</td>
							</tr>
						{/each}
						{#if rows.length === 0 && accounts.length > 0}
							<tr class="empty-row">
								<td colspan="4">
									<EmptyState
										title="Nothing to show"
										sub={search.trim() && roleFilter !== null
											? `No account named “${search.trim()}” under ${roleFilter}.`
											: search.trim()
												? `No account named “${search.trim()}”.`
												: roleFilter !== null
													? `Nothing under ${roleFilter}.`
													: 'No accounts match the current filters.'}
									>
										{#snippet icon()}<Search size={20} />{/snippet}
									</EmptyState>
								</td>
							</tr>
						{/if}
					</tbody>
				</table>
			</div>

			<!--
				Categories are accounts underneath, and a category is one side of a
				record — but they are not what a person opening "Accounts" is looking
				for, so they have their own screen. Relation-card contract: the whole
				element is one button, with a trailing chevron (CLAUDE.md).
			-->
			<button type="button" class="related-link ob-card acct-catcard" onclick={openCategories}>
				<span class="ob-icon"><Tag size={15} /></span>
				<span class="ob-main">
					<span class="ob-title">Categories</span>
					<span class="ob-sub">
						What money is earned and spent on ·
						{categoryCounts.spending} spending, {categoryCounts.earning} earning
					</span>
				</span>
				<ChevronRight size={14} color="var(--muted-foreground)" />
			</button>
		</div>
	</div>
</div>

<AccountSheet
	bind:open={sheetOpen}
	account={editingLive}
	canDelete={data.perms.delete}
	canChange={data.perms.change}
	canReconcile={data.perms.reconcile}
	unfinishedStatements={editingLive
		? (data.unfinishedStatements[editingLive.id] ?? 0)
		: 0}
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
	/* Account-row shape lives in layout.css (shared with Categories). */
	.acct-catcard {
		width: 100%;
		margin-top: 12px;
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
