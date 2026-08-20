<script lang="ts">
	import { onMount } from 'svelte';
	import { goto, pushState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { Plus, Search, Tag } from '@lucide/svelte';
	import { Input } from '$lib/components/ui/input/index.js';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { formatMinor } from '$lib/format.js';
	import { AccountRole } from '$lib/enums.js';
	import { displaySignFor } from './display-sign.js';
	import {
		CATEGORY_GROUPS,
		CATEGORY_ROLES,
		CREATABLE_CATEGORY_ROLES
	} from './account-roles.js';
	import AccountSheet from './AccountSheet.svelte';
	import { createResourceStream, mergeById } from '$lib/sse.js';
	import type { AccountView } from '$lib/server/ledger/types.js';
	import type { loadCategoriesPage } from '$lib/server/loaders/accounts.js';

	/**
	 * What money is earned and spent on.
	 *
	 * These are accounts underneath — a category is one side of a record, and
	 * double-entry needs both sides to name an account (002 FR-006a). They have
	 * their own screen because they are not what a person opening "Accounts" is
	 * looking for: this installation has 22 of them against 4 accounts that hold
	 * or owe money, and one list of both read as nothing but categories.
	 *
	 * Nothing here is a second way to manage an account. It is the *only* place
	 * a category is created, renamed or retired, and it goes through the same
	 * `accountsActions` the Accounts screen uses.
	 */
	type PageData = ReturnType<typeof loadCategoriesPage>;

	let {
		data,
		form,
		openId
	}: { data: PageData; form: unknown; openId: number | null } = $props();

	// Writable `$derived`, so a fresh server load replaces the list and an
	// incoming stream event can still merge into it.
	let accounts = $derived(data.accounts);

	let showArchived = $state(false);
	let search = $state('');
	let group = $state<string>('spending');

	const visible = $derived(showArchived ? accounts : accounts.filter((a) => !a.archivedAt));
	const archivedCount = $derived(
		accounts.filter((a) => a.archivedAt != null && (CATEGORY_ROLES as number[]).includes(a.role))
			.length
	);

	const currentGroup = $derived(
		CATEGORY_GROUPS.find((g) => g.id === group) ?? CATEGORY_GROUPS[0]
	);

	const groupCounts = $derived(
		Object.fromEntries(
			CATEGORY_GROUPS.map((g) => [g.id, visible.filter((a) => a.role === g.role).length])
		)
	);

	/** Every category, whichever group it is in — what the screen holds at all. */
	const listed = $derived(visible.filter((a) => (CATEGORY_ROLES as number[]).includes(a.role)));

	/** One flat list within a group, in the query's existing stable order. */
	const rows = $derived.by(() => {
		let out = visible.filter((a) => a.role === currentGroup.role);
		const q = search.trim().toLowerCase();
		if (q) out = out.filter((a) => a.name.toLowerCase().includes(q));
		return out.slice().sort((a, b) => a.rank.localeCompare(b.rank));
	});

	/** What this group has come to, all told. */
	const groupTotal = $derived(
		rows.reduce((sum, a) => sum + a.balanceMinor * displaySignFor(a.role), 0)
	);

	// --- Drawer -------------------------------------------------------------
	let sheetOpen = $state(false);
	let editing = $state<AccountView | null>(null);
	const editingLive = $derived(
		editing ? (accounts.find((a) => a.id === editing!.id) ?? editing) : null
	);

	function openDetail(account: AccountView, { push = true } = {}) {
		editing = account;
		sheetOpen = true;
		if (push) {
			pushState(resolve('/(app)/categories/[id]', { id: String(account.id) }), {
				viaPush: true
			});
		}
	}

	function openCreate() {
		editing = null;
		sheetOpen = true;
	}

	function closeDetail() {
		sheetOpen = false;
		editing = null;
		// `viaPush` means this drawer put an entry on the history stack, so going
		// back returns to the list and the browser's own back button works.
		if (page.state.viaPush) {
			history.back();
		} else {
			goto(resolve('/categories'), { replaceState: true, noScroll: true });
		}
	}

	// --- Live updates -------------------------------------------------------
	// Opened in onMount and closed in onDestroy by the helper — never in
	// `$effect`, which re-runs on reactive changes and would tear the connection
	// down (CLAUDE.md).
	createResourceStream<{ type: string; account?: AccountView; id?: number }>(
		'/api/accounts/stream',
		(msg) => {
			if (msg.type === 'account-update' && msg.account) {
				accounts = mergeById(accounts, [msg.account]);
			} else if (msg.type === 'account-deleted' && msg.id != null) {
				accounts = accounts.filter((a) => a.id !== msg.id);
				if (editing?.id === msg.id) closeDetail();
			}
		}
	);

	onMount(() => {
		if (openId) {
			const found = data.accounts.find((a) => a.id === openId);
			if (found) {
				// A real navigation to /categories/[id] — the address is already right.
				openDetail(found, { push: false });
				group =
					found.role === AccountRole.IncomeCategory ? 'earning' : 'spending';
			}
		}
	});
</script>

<div class="screen">
	<header class="topbar">
		<div class="topbar-left">
			<h1 class="page-title">Categories</h1>
			<p class="page-sub">
				What money is earned and spent on ·
				{visible.filter((a) => (CATEGORY_ROLES as number[]).includes(a.role)).length} in use
			</p>
		</div>
		<div class="topbar-right">
			{#if listed.length > 0}
				<div class="search-box">
					<div style="position:relative; display:flex; align-items:center;">
						<span
							style="position:absolute; left:10px; color:var(--muted-foreground); display:flex; pointer-events:none;"
						>
							<Search size={15} />
						</span>
						<Input
							type="search"
							placeholder="Search categories by name…"
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
					{showArchived ? 'Hide' : 'Show'} retired ({archivedCount})
				</button>
			{/if}
			{#if data.perms.add}
				<button type="button" class="sheet-btn sheet-btn-primary" onclick={openCreate}>
					<Plus size={14} /> Add category
				</button>
			{/if}
		</div>
	</header>

	<div class="page-scroll">
		<div class="page-inner">
			<div class="toolbar">
				<div class="status-tabs">
					{#each CATEGORY_GROUPS as g (g.id)}
						<button
							type="button"
							class="status-tab"
							class:active={group === g.id}
							onclick={() => (group = g.id)}
						>
							{g.title}<span class="tab-count">{groupCounts[g.id] ?? 0}</span>
						</button>
					{/each}
				</div>
			</div>

			<!-- The same table as the Accounts screen: these are the two halves of
			     one chart, and a reader must not be able to tell them apart. -->
			<div class="table-card">
				<table class="exp-table">
					<thead>
						<tr>
							<th>Category</th>
							<th>Records</th>
							<th class="ta-right">{currentGroup.id === 'earning' ? 'Earned' : 'Spent'}</th>
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
								<td class="td-primary" data-label="Category">
									<div class="cell-item">
										<span class="cell-itemname">{account.name}</span>
										<span class="cell-itemnum">
											{#if account.archivedAt}Retired{/if}
										</span>
									</div>
								</td>
								<td data-label="Records">
									{account.movementCount}
									{account.movementCount === 1 ? 'record' : 'records'}
								</td>
								<td class="td-amount" data-label={currentGroup.id === 'earning' ? 'Earned' : 'Spent'}>
									<span class="amount-num">
										{formatMinor(account.balanceMinor * displaySignFor(account.role))}
									</span>
								</td>
							</tr>
						{/each}
						{#if rows.length === 0}
							<tr class="empty-row">
								<td colspan="3">
									<EmptyState
										title="Nothing to show"
										sub={search.trim()
											? `No ${currentGroup.title.toLowerCase()} category named “${search.trim()}”.`
											: `No ${currentGroup.title.toLowerCase()} categories yet.`}
									>
										{#snippet icon()}<Tag size={20} />{/snippet}
									</EmptyState>
								</td>
							</tr>
						{/if}
					</tbody>
				</table>
			</div>

			<div class="table-foot">
				<span>{rows.length} {currentGroup.title.toLowerCase()}</span>
				<span>Total <b class="num">{formatMinor(groupTotal)}</b></span>
			</div>
		</div>
	</div>
</div>

<AccountSheet
	bind:open={sheetOpen}
	account={editingLive}
	canDelete={data.perms.delete}
	canChange={data.perms.change}
	creatableRoles={CREATABLE_CATEGORY_ROLES}
	nounSingular="category"
	error={(form as { error?: string } | null)?.error ?? ''}
	onclose={closeDetail}
	onOpeningBalance={() => {}}
/>

<style>
	/* Nothing local: every control and the table itself are shared (layout.css). */
</style>
