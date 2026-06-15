<script lang="ts">
	import { enhance } from '$app/forms';
	import { onMount, onDestroy } from 'svelte';
	import { fly } from 'svelte/transition';
	import {
		Search,
		Plus,
		Tag,
		Calendar,
		SlidersHorizontal,
		ChevronDown,
		ChevronUp,
		ChevronsUpDown,
		X,
		Paperclip,
		Lock,
		FileText,
		Wallet,
		Upload
	} from '@lucide/svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import FilterDropdown from '$lib/components/ui/FilterDropdown.svelte';
	import * as Sheet from '$lib/components/ui/sheet/index.js';
	import { formatMoney, formatMoneyRM, formatDate, formatDateShort } from '$lib/format.js';
	import DatePicker from '$lib/components/ui/date-picker/DatePicker.svelte';
	import type { PageData, ActionData } from './$types.js';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// Local reactive list — updated by SSE events and re-synced when SvelteKit reloads SSR data
	let expenses = $state(data.expenses);
	$effect(() => { expenses = data.expenses; });

	// --- State ---
	let searchRaw = $state('');
	let search = $state('');
	let statusTab = $state('all');
	let selectedCats = $state<string[]>([]);
	let amountMin = $state('');
	let amountMax = $state('');
	let dateFrom = $state('');
	let dateTo = $state('');
	let sort = $state({ key: 'date', dir: 'desc' as 'asc' | 'desc' });
	let selected = $state(new Set<number>());
	type Attachment = { id: number; filename: string; displayName: string; addedDate: string };
	type FullExpense = (typeof data.expenses)[0] & { attachments: Attachment[] };
	let detailExpense = $state<FullExpense | null>(null);
	let showNew = $state(false);
	let mobileFilterOpen = $state(false);
	let mobileSearchOpen = $state(false);
	let mobileSearchEl = $state<HTMLInputElement | null>(null);
	$effect(() => { if (mobileSearchOpen && mobileSearchEl) mobileSearchEl.focus(); });
	let expenseDrag = $state(false);
	let expenseFileInput = $state<HTMLInputElement | null>(null);
	let newExpenseFiles = $state<File[]>([]);
	let newExpenseDrag = $state(false);
	let newExpenseFileInput = $state<HTMLInputElement | null>(null);

	// Debounced search
	$effect(() => {
		const v = searchRaw;
		const t = setTimeout(() => (search = v), 300);
		return () => clearTimeout(t);
	});

	// Close new sheet on successful create
	$effect(() => {
		if (form?.success) showNew = false;
	});
	$effect(() => { if (!showNew) newExpenseFiles = []; });

	// --- Derived ---
	const filtered = $derived.by(() => {
		let rows = expenses.slice();
		if (statusTab !== 'all') rows = rows.filter((e) => e.status === statusTab);
		if (selectedCats.length) rows = rows.filter((e) => selectedCats.includes(e.category));
		const mn = amountMin !== '' ? parseFloat(amountMin) : null;
		const mx = amountMax !== '' ? parseFloat(amountMax) : null;
		if (mn != null) rows = rows.filter((e) => e.amount >= mn);
		if (mx != null) rows = rows.filter((e) => e.amount <= mx);
		if (dateFrom) rows = rows.filter((e) => e.date >= dateFrom);
		if (dateTo) rows = rows.filter((e) => e.date <= dateTo);
		if (search.trim()) {
			const q = search.toLowerCase();
			rows = rows.filter(
				(e) =>
					e.itemName.toLowerCase().includes(q) ||
					e.supplier.toLowerCase().includes(q) ||
					e.expenseNumber.toLowerCase().includes(q) ||
					(e.reference ?? '').toLowerCase().includes(q) ||
					e.category.toLowerCase().includes(q)
			);
		}
		rows.sort((a, b) => {
			const av = a[sort.key as keyof typeof a] as string | number;
			const bv = b[sort.key as keyof typeof b] as string | number;
			let cmp = av < bv ? -1 : av > bv ? 1 : 0;
			if (cmp === 0) cmp = a.id - b.id;
			return sort.dir === 'asc' ? cmp : -cmp;
		});
		return rows;
	});

	const filteredTotal = $derived(filtered.reduce((s, e) => s + e.amount, 0));
	const activeFilterCount = $derived(
		selectedCats.length + (amountMin || amountMax ? 1 : 0) + (dateFrom || dateTo ? 1 : 0)
	);
	const allSelected = $derived(filtered.length > 0 && filtered.every((e) => selected.has(e.id)));
	const someSelected = $derived(filtered.some((e) => selected.has(e.id)) && !allSelected);
	const selectedList = $derived(filtered.filter((e) => selected.has(e.id)));
	const selTotal = $derived(selectedList.reduce((s, e) => s + e.amount, 0));
	const claimable = $derived(selectedList.length > 0 && selectedList.every((e) => e.status === 'unpaid'));

	const counts = $derived.by(() => ({
		all: expenses.length,
		unpaid: expenses.filter((e) => e.status === 'unpaid').length,
		pending: expenses.filter((e) => e.status === 'pending').length,
		paid: expenses.filter((e) => e.status === 'paid').length,
	}));

	// Stats — derived from local state so they update in real-time
	const stats = $derived.by(() => {
		const unpaid = expenses.filter((e) => e.status === 'unpaid');
		const pending = expenses.filter((e) => e.status === 'pending');
		const now = new Date();
		const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
		const thisMonth = expenses.filter((e) => e.date.startsWith(monthKey));
		return {
			outstanding: unpaid.reduce((s, e) => s + e.amount, 0),
			outstandingCount: unpaid.length,
			pendingTotal: pending.reduce((s, e) => s + e.amount, 0),
			monthTotal: thisMonth.reduce((s, e) => s + e.amount, 0),
			monthCount: thisMonth.length,
			allTotal: expenses.reduce((s, e) => s + e.amount, 0)
		};
	});

	function toggleAll() {
		if (allSelected) {
			filtered.forEach((e) => selected.delete(e.id));
		} else {
			filtered.forEach((e) => selected.add(e.id));
		}
		selected = new Set(selected);
	}

	function toggleOne(id: number) {
		if (selected.has(id)) selected.delete(id);
		else selected.add(id);
		selected = new Set(selected);
	}

	function clearSel() {
		selected = new Set();
	}

	function onSort(key: string) {
		if (sort.key === key) {
			sort = { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' };
		} else {
			sort = { key, dir: key === 'amount' || key === 'date' ? 'desc' : 'asc' };
		}
	}

	function clearAllFilters() {
		selectedCats = [];
		amountMin = '';
		amountMax = '';
		dateFrom = '';
		dateTo = '';
		searchRaw = '';
		statusTab = 'all';
	}

	function toggleCat(c: string) {
		if (selectedCats.includes(c)) {
			selectedCats = selectedCats.filter((x) => x !== c);
		} else {
			selectedCats = [...selectedCats, c];
		}
	}

	const today = new Date().toISOString().slice(0, 10);

	// SSE — real-time updates from server
	let _es: EventSource | null = null;
	onMount(() => {
		_es = new EventSource('/api/expenses/stream');
		_es.onmessage = (e) => {
			const msg = JSON.parse(e.data);
			if (msg.type === 'expense-update') mergeExpenses([msg.item]);
			else if (msg.type === 'expense-delete') expenses = expenses.filter((e) => e.id !== msg.id);
		};
	});
	onDestroy(() => _es?.close());

	function mergeExpenses(incoming: typeof data.expenses) {
		const byId = new Map(incoming.map((e) => [e.id, e]));
		const existingIds = new Set(expenses.map((e) => e.id));
		expenses = expenses.map((local) => byId.get(local.id) ?? local);
		const brandNew = incoming.filter((e) => !existingIds.has(e.id));
		if (brandNew.length > 0) expenses = [...brandNew, ...expenses];
	}

	async function openExpense(e: (typeof data.expenses)[0]) {
		detailExpense = { ...e, attachments: [] };
		const res = await fetch(`/api/expenses/${e.id}`);
		if (res.ok) detailExpense = await res.json();
	}

	async function uploadExpenseFiles(files: FileList) {
		if (!detailExpense) return;
		for (const file of Array.from(files)) {
			const fd = new FormData();
			fd.append('file', file);
			const res = await fetch(`/api/expenses/${detailExpense.id}/attachments`, { method: 'POST', body: fd });
			if (res.ok) {
				const att: Attachment = await res.json();
				detailExpense = { ...detailExpense, attachments: [...detailExpense.attachments, att] };
			}
		}
	}

	async function deleteExpenseAttachment(attachmentId: number) {
		if (!detailExpense) return;
		await fetch(`/api/expenses/${detailExpense.id}/attachments/${attachmentId}`, { method: 'DELETE' });
		detailExpense = { ...detailExpense, attachments: detailExpense.attachments.filter((a) => a.id !== attachmentId) };
	}

	function handleExpenseDrop(e: DragEvent) {
		e.preventDefault(); expenseDrag = false;
		if (e.dataTransfer?.files) uploadExpenseFiles(e.dataTransfer.files);
	}
	function handleExpenseFileInput(e: Event) {
		const input = e.target as HTMLInputElement;
		if (input.files) uploadExpenseFiles(input.files);
		input.value = '';
	}
</script>

<svelte:head>
	<title>Expenses - Akaun</title>
</svelte:head>

<div class="screen" style="position:relative;">
	<!-- Top bar -->
	<header class="topbar">
		<div class="topbar-left">
			<h1 class="page-title">Expenses</h1>
			<p class="page-sub">
				{counts.all} records · <span class="num">{formatMoneyRM(stats.allTotal)}</span> total
			</p>
		</div>
		<div class="topbar-right">
			<div class="search-box">
				<div style="position:relative; display:flex; align-items:center;">
					<span style="position:absolute; left:10px; color:var(--muted-foreground); display:flex; pointer-events:none;">
						<Search size={15} />
					</span>
					<input
						type="search"
						placeholder="Search item, supplier, ref…"
						bind:value={searchRaw}
						style="width:100%; height:34px; border:1px solid var(--input); background:var(--card); color:var(--foreground); border-radius:8px; padding:0 12px 0 32px; font-family:inherit; font-size:13px; outline:none; transition:border-color .12s, box-shadow .12s;"
						onfocus={(e) => { const el = e.currentTarget as HTMLInputElement; el.style.borderColor = 'var(--primary)'; el.style.boxShadow = '0 0 0 3px var(--primary-soft)'; }}
						onblur={(e) => { const el = e.currentTarget as HTMLInputElement; el.style.borderColor = ''; el.style.boxShadow = ''; }}
					/>
				</div>
			</div>
			{#if mobileSearchOpen}
				<div class="mobile-search-inline" transition:fly={{ x: 12, duration: 180 }}>
					<span class="mobile-search-inline-icon"><Search size={15} /></span>
					<input
						class="mobile-search-inline-input"
						type="search"
						placeholder="Search item, supplier, ref…"
						bind:value={searchRaw}
						bind:this={mobileSearchEl}
					/>
				</div>
			{/if}
			<button
				class="mobile-search-toggle"
				class:active={mobileSearchOpen}
				onclick={() => { mobileSearchOpen = !mobileSearchOpen; if (!mobileSearchOpen) searchRaw = ''; }}
			>
				{#if mobileSearchOpen}<X size={16} />{:else}<Search size={16} />{/if}
			</button>
			<button
				onclick={() => (showNew = true)}
				style="display:inline-flex; align-items:center; gap:6px; height:32px; padding:0 12px; background:var(--primary); color:var(--primary-foreground); border:none; border-radius:8px; font-family:inherit; font-size:13px; font-weight:500; cursor:pointer;"
			>
				<Plus size={15} /> <span class="btn-text">New expense</span>
			</button>
		</div>
	</header>

	<!-- Stat strip -->
	<div class="stat-strip">
		<div class="stat-card tone-red">
			<div class="stat-label">Outstanding</div>
			<div class="stat-value"><span class="stat-cur">RM</span>{formatMoney(stats.outstanding)}</div>
			<div class="stat-sub">{stats.outstandingCount} unpaid</div>
		</div>
		<div class="stat-card tone-amber">
			<div class="stat-label">Pending claims</div>
			<div class="stat-value"><span class="stat-cur">RM</span>{formatMoney(stats.pendingTotal)}</div>
			<div class="stat-sub">Awaiting reimbursement</div>
		</div>
		<div class="stat-card">
			<div class="stat-label">This month</div>
			<div class="stat-value"><span class="stat-cur">RM</span>{formatMoney(stats.monthTotal)}</div>
			<div class="stat-sub">{stats.monthCount} records</div>
		</div>
		<div class="stat-card">
			<div class="stat-label">All recorded</div>
			<div class="stat-value"><span class="stat-cur">RM</span>{formatMoney(stats.allTotal)}</div>
			<div class="stat-sub">{counts.all} expenses</div>
		</div>
	</div>

	<div class="work">
		<div class="work-main layout-standard" style="padding-top:12px;">
			<!-- Toolbar -->
			<div class="toolbar">
				<div class="status-tabs">
					{#each [['all','All'], ['unpaid','Unpaid'], ['pending','Pending'], ['paid','Paid']] as [id, label]}
						<button
							class="status-tab"
							class:active={statusTab === id}
							onclick={() => (statusTab = id)}
						>
							{label}<span class="tab-count">{counts[id as keyof typeof counts]}</span>
						</button>
					{/each}
				</div>
				<div class="mobile-filter-row">
					<button
						class="btn-outline btn-sm"
						style="display:inline-flex; align-items:center; gap:6px;"
						onclick={() => (mobileFilterOpen = true)}
					>
						<SlidersHorizontal size={13} /> Filters
						{#if activeFilterCount > 0}<span class="filter-count">{activeFilterCount}</span>{/if}
					</button>
					{#if activeFilterCount > 0}
						<button class="clear-filters" onclick={clearAllFilters}><X size={13} /> Clear</button>
					{/if}
				</div>
				<div class="toolbar-filters">
					{#if activeFilterCount > 0}
						<button class="clear-filters" onclick={clearAllFilters}>
							<X size={13} /> Clear
						</button>
					{/if}
					<FilterDropdown label="Category" active={selectedCats.length > 0}>
						{#snippet icon()}<Tag size={14} />{/snippet}
						<div style="padding:5px;">
							<div style="display:flex; align-items:center; justify-content:space-between; padding:6px 8px 8px; font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.04em; color:var(--muted-foreground);">
								<span>Categories</span>
								{#if selectedCats.length}<button onclick={() => (selectedCats = [])} style="border:none; background:none; color:var(--primary); cursor:pointer; font-size:11px; font-weight:600;">Clear</button>{/if}
							</div>
							{#each data.categories as cat}
								<button
									onclick={() => toggleCat(cat)}
									style="display:flex; align-items:center; gap:9px; width:100%; border:none; background:none; font-family:inherit; font-size:13px; color:var(--foreground); padding:7px 8px; border-radius:7px; cursor:pointer; text-align:left;"
									onmouseover={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--accent)'; }}
									onmouseout={(e) => { (e.currentTarget as HTMLButtonElement).style.background = ''; }}
								>
									<span style="width:16px; height:16px; border-radius:4px; border:1.5px solid {selectedCats.includes(cat) ? 'var(--primary)' : 'var(--border-strong)'}; background:{selectedCats.includes(cat) ? 'var(--primary)' : 'var(--card)'}; display:grid; place-items:center; flex-shrink:0;">
										{#if selectedCats.includes(cat)}<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>{/if}
									</span>
									{cat}
								</button>
							{/each}
						</div>
					</FilterDropdown>

					<FilterDropdown label="Date" active={!!(dateFrom || dateTo)}>
						{#snippet icon()}<Calendar size={14} />{/snippet}
						<div style="padding:12px 14px;">
							<div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;">
								<div style="font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.04em; color:var(--muted-foreground);">Date range</div>
								{#if dateFrom || dateTo}<button onclick={() => { dateFrom = ''; dateTo = ''; }} style="border:none; background:none; color:var(--primary); cursor:pointer; font-size:11px; font-weight:600; padding:0;">Clear</button>{/if}
							</div>
							<div style="display:flex; flex-direction:column; gap:8px;">
								<label style="font-size:11.5px; color:var(--muted-foreground);">From</label>
								<DatePicker bind:value={dateFrom} placeholder="From date" />
								<label style="font-size:11.5px; color:var(--muted-foreground);">To</label>
								<DatePicker bind:value={dateTo} placeholder="To date" />
							</div>
						</div>
					</FilterDropdown>

					<FilterDropdown label="Amount" active={!!(amountMin || amountMax)} align="right">
						{#snippet icon()}<SlidersHorizontal size={14} />{/snippet}
						<div style="padding:12px 14px; min-width:168px;">
							<div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;">
								<div style="font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.04em; color:var(--muted-foreground);">Amount range</div>
								{#if amountMin || amountMax}<button onclick={() => { amountMin = ''; amountMax = ''; }} style="border:none; background:none; color:var(--primary); cursor:pointer; font-size:11px; font-weight:600; padding:0;">Clear</button>{/if}
							</div>
							<div style="display:flex; align-items:center; gap:8px;">
								<div class="amount-input" style="width:120px;">
									<span class="amount-prefix">RM</span>
									<input class="amount-field" inputmode="decimal" placeholder="Min" bind:value={amountMin} style="width:84px;" />
								</div>
								<span style="color:var(--muted-foreground);">–</span>
								<div class="amount-input" style="width:120px;">
									<span class="amount-prefix">RM</span>
									<input class="amount-field" inputmode="decimal" placeholder="Max" bind:value={amountMax} style="width:84px;" />
								</div>
							</div>
						</div>
					</FilterDropdown>

				</div>
			</div>

			<!-- Result meta -->
			{#if filtered.length > 0 || activeFilterCount > 0}
			<div class="result-meta">
				<span>Showing <b>{filtered.length}</b> of {counts.all}</span>
				<span class="result-total">Filtered total <b class="num">{formatMoneyRM(filteredTotal)}</b></span>
			</div>
			{/if}

			<!-- Table -->
			<div class="table-card">
				<table class="exp-table">
					<thead>
						<tr>
							<th class="td-check">
								<button
									type="button"
									style="width:17px; height:17px; border-radius:5px; border:1.5px solid {allSelected ? 'var(--primary)' : 'var(--border-strong)'}; background:{allSelected || someSelected ? 'var(--primary)' : 'var(--card)'}; display:grid; place-items:center; cursor:pointer; color:var(--primary-foreground); padding:0; flex-shrink:0;"
									onclick={toggleAll}
									aria-label="Select all"
								>
									{#if allSelected}<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><path d="M20 6 9 17l-5-5"/></svg>{:else if someSelected}<span style="width:8px; height:2px; border-radius:2px; background:white; display:block;"></span>{/if}
								</button>
							</th>
							<th class={`sortable ${sort.key === 'itemName' ? 'sorted' : ''}`} onclick={() => onSort('itemName')} style="cursor:pointer; user-select:none;">
								<span class="th-inner">Item {sort.key === 'itemName' ? (sort.dir === 'asc' ? '↑' : '↓') : ''}</span>
							</th>
							<th class="sortable" onclick={() => onSort('supplier')} style="cursor:pointer; user-select:none;">
								<span class="th-inner">Supplier</span>
							</th>
							<th class="sortable" onclick={() => onSort('category')} style="cursor:pointer; user-select:none;">
								<span class="th-inner">Category</span>
							</th>
							<th class="sortable" onclick={() => onSort('status')} style="cursor:pointer; user-select:none;">
								<span class="th-inner">Status</span>
							</th>
							<th class="sortable" onclick={() => onSort('date')} style="cursor:pointer; user-select:none;">
								<span class="th-inner">Date</span>
							</th>
							<th class="sortable ta-right" onclick={() => onSort('amount')} style="cursor:pointer; user-select:none;">
								<span class="th-inner">Amount</span>
							</th>
						</tr>
					</thead>
					<tbody>
						{#each filtered as e}
							<tr
								class="exp-row"
								class:selected={selected.has(e.id)}
								onclick={() => openExpense(e)}
							>
								<td class="td-check" onclick={(ev) => { ev.stopPropagation(); toggleOne(e.id); }}>
									<button
										type="button"
										style="width:17px; height:17px; border-radius:5px; border:1.5px solid {selected.has(e.id) ? 'var(--primary)' : 'var(--border-strong)'}; background:{selected.has(e.id) ? 'var(--primary)' : 'var(--card)'}; display:grid; place-items:center; cursor:pointer; color:var(--primary-foreground); padding:0; flex-shrink:0;"
										aria-label="Select {e.expenseNumber}"
									>
										{#if selected.has(e.id)}<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><path d="M20 6 9 17l-5-5"/></svg>{/if}
									</button>
								</td>
								<td class="td-primary">
									<div class="cell-item">
										<span class="cell-itemname">{e.itemName}</span>
										<span class="cell-itemnum">{e.expenseNumber}</span>
									</div>
								</td>
								<td class="td-supplier" data-label="Supplier">{e.supplier || '—'}</td>
								<td data-label="Category">
									<span style="display:inline-flex; align-items:center; font-size:11.5px; background:var(--secondary); color:var(--secondary-foreground); padding:2px 9px; border-radius:999px; white-space:nowrap;">
										{e.category}
									</span>
								</td>
								<td class="td-status"><StatusBadge status={e.status as 'unpaid'|'pending'|'paid'} /></td>
								<td class="td-date" data-label="Date">
									{formatDateShort(e.date)}<span class="td-year">{e.date.slice(0, 4)}</span>
								</td>
								<td class="td-amount" data-label="Amount">
									<span class="amount-num">RM {formatMoney(e.amount)}</span>
								</td>
							</tr>
						{/each}
						{#if counts.all === 0}
							<tr class="empty-row">
								<td colspan="7">
									<div class="empty">
										<div class="empty-icon"><Wallet size={20} /></div>
										<div class="empty-title">No expenses recorded yet</div>
										<div class="empty-sub">Add your first expense to get started</div>
										<button
											onclick={() => (showNew = true)}
											style="display:inline-flex; align-items:center; gap:6px; height:32px; padding:0 14px; background:var(--primary); color:var(--primary-foreground); border:none; border-radius:8px; font-family:inherit; font-size:13px; font-weight:500; cursor:pointer;"
										>
											<Plus size={14} /> New expense
										</button>
									</div>
								</td>
							</tr>
						{:else if filtered.length === 0}
							<tr class="empty-row">
								<td colspan="7">
									<div class="empty">
										<div class="empty-icon"><Search size={20} /></div>
										<div class="empty-title">No expenses match these filters</div>
										<button class="link-btn" onclick={clearAllFilters}>Clear filters</button>
									</div>
								</td>
							</tr>
						{/if}
					</tbody>
				</table>
			</div>
			<div class="table-foot">
				<span>{filtered.length} of {counts.all} expenses</span>
				<span class="muted">Updated just now</span>
			</div>
		</div>
	</div>

	<!-- Bulk action bar -->
	<div class="bulkbar" class:show={selected.size > 0}>
		<div class="bulkbar-inner">
			<button class="bulk-close" onclick={clearSel} aria-label="Clear selection"><X size={16} /></button>
			<span class="bulk-count"><b>{selected.size}</b> selected</span>
			<span class="bulk-total">· <span class="num">RM {formatMoney(selTotal)}</span></span>
			<div class="bulk-actions">
				<form method="POST" action="?/markPaid" use:enhance={() => () => { clearSel(); }}>
					<input type="hidden" name="ids" value={[...selected].join(',')} />
					<button type="submit" class="bulk-actions-ghost" style="padding:5px 10px; border-radius:6px; font-family:inherit; font-size:13px; cursor:pointer;">
						Mark paid
					</button>
				</form>
				<form method="POST" action="?/createClaim" use:enhance={() => () => { clearSel(); }}>
					<input type="hidden" name="ids" value={[...selected].join(',')} />
					<button
						type="submit"
						disabled={!claimable}
						title={claimable ? '' : 'Only unpaid expenses can be claimed'}
						style="display:inline-flex; align-items:center; gap:6px; height:32px; padding:0 12px; background:var(--primary); color:var(--primary-foreground); border:none; border-radius:8px; font-family:inherit; font-size:13px; font-weight:500; cursor:pointer; opacity:{claimable ? 1 : 0.5};"
					>
						<FileText size={14} /> Create claim
					</button>
				</form>
			</div>
		</div>
	</div>
</div>

<!-- Mobile filter sheet -->
<Sheet.Root bind:open={mobileFilterOpen}>
	<Sheet.Portal>
		<Sheet.Overlay />
		<Sheet.Content side="bottom" style="border-radius:16px 16px 0 0; max-height:85vh; overflow-y:auto; padding:20px 20px calc(20px + env(safe-area-inset-bottom));">
			<div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:16px;">
				<div style="font-size:15px; font-weight:600;">Filters</div>
				<Sheet.Close class="sheet-close"><X size={16} /></Sheet.Close>
			</div>
			<div style="margin-bottom:16px;">
				<div style="font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.04em; color:var(--muted-foreground); margin-bottom:10px; display:flex; align-items:center; justify-content:space-between;">
					<span>Category</span>
					{#if selectedCats.length}<button onclick={() => (selectedCats = [])} style="border:none; background:none; color:var(--primary); cursor:pointer; font-size:11px; font-weight:600;">Clear</button>{/if}
				</div>
				<div style="display:flex; flex-wrap:wrap; gap:7px;">
					{#each data.categories as cat}
						<button
							onclick={() => toggleCat(cat)}
							style="border:1px solid {selectedCats.includes(cat) ? 'var(--primary)' : 'var(--border)'}; background:{selectedCats.includes(cat) ? 'var(--primary-soft)' : 'var(--card)'}; color:{selectedCats.includes(cat) ? 'var(--primary)' : 'var(--foreground)'}; font-family:inherit; font-size:13px; padding:5px 12px; border-radius:999px; cursor:pointer;"
						>{cat}</button>
					{/each}
				</div>
			</div>
			<div style="margin-bottom:16px;">
				<div style="font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.04em; color:var(--muted-foreground); margin-bottom:10px; display:flex; align-items:center; justify-content:space-between;">
					<span>Date range</span>
					{#if dateFrom || dateTo}<button onclick={() => { dateFrom = ''; dateTo = ''; }} style="border:none; background:none; color:var(--primary); cursor:pointer; font-size:11px; font-weight:600;">Clear</button>{/if}
				</div>
				<div style="display:flex; flex-direction:column; gap:8px;">
					<label style="font-size:11.5px; color:var(--muted-foreground);">From</label>
					<DatePicker bind:value={dateFrom} placeholder="From date" />
					<label style="font-size:11.5px; color:var(--muted-foreground);">To</label>
					<DatePicker bind:value={dateTo} placeholder="To date" />
				</div>
			</div>
			<div style="margin-bottom:20px;">
				<div style="font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.04em; color:var(--muted-foreground); margin-bottom:10px; display:flex; align-items:center; justify-content:space-between;">
					<span>Amount range</span>
					{#if amountMin || amountMax}<button onclick={() => { amountMin = ''; amountMax = ''; }} style="border:none; background:none; color:var(--primary); cursor:pointer; font-size:11px; font-weight:600;">Clear</button>{/if}
				</div>
				<div style="display:flex; align-items:center; gap:8px;">
					<div class="amount-input" style="flex:1;">
						<span class="amount-prefix">RM</span>
						<input class="amount-field" inputmode="decimal" placeholder="Min" bind:value={amountMin} style="flex:1;" />
					</div>
					<span style="color:var(--muted-foreground);">–</span>
					<div class="amount-input" style="flex:1;">
						<span class="amount-prefix">RM</span>
						<input class="amount-field" inputmode="decimal" placeholder="Max" bind:value={amountMax} style="flex:1;" />
					</div>
				</div>
			</div>
			<button class="btn-primary" style="width:100%;" onclick={() => (mobileFilterOpen = false)}>
				Show results
			</button>
		</Sheet.Content>
	</Sheet.Portal>
</Sheet.Root>

<!-- Detail sheet -->
<Sheet.Root open={!!detailExpense} onOpenChange={(o) => { if (!o) detailExpense = null; }}>
	<Sheet.Portal>
		<Sheet.Overlay />
		<Sheet.Content side="right" style="width:460px; max-width:95vw; display:flex; flex-direction:column; overflow:hidden;">
			{#if detailExpense}
				<div style="display:flex; align-items:flex-start; justify-content:space-between; padding:22px 22px 16px; border-bottom:1px solid var(--border);">
					<div>
						<div class="sheet-eyebrow">{detailExpense.expenseNumber}</div>
						<div class="sheet-title-text">{detailExpense.itemName}</div>
					</div>
					<Sheet.Close class="sheet-close">
						<X size={16} />
					</Sheet.Close>
				</div>
				<div style="flex:1; overflow-y:auto; padding:20px 22px;">
					<div class="detail-amount">
						<span class="detail-amount-cur">RM</span>
						<span class="detail-amount-val">{formatMoney(detailExpense.amount)}</span>
						{#if detailExpense.claimId}
							<span class="detail-amount-lock" title="Amount locked (linked to a claim)"><Lock size={15} /></span>
						{/if}
					</div>
					<div class="detail-statusrow">
						<StatusBadge status={detailExpense.status as 'unpaid'|'pending'|'paid'} />
						{#if detailExpense.claimId}
							<span style="font-size:11.5px; color:var(--muted-foreground);">Linked to claim</span>
						{/if}
					</div>
					<div class="detail-list">
						{#if detailExpense.supplier}
							<div class="detail-row">
								<div class="detail-key">Supplier</div>
								<div class="detail-val">{detailExpense.supplier}</div>
							</div>
						{/if}
						<div class="detail-row">
							<div class="detail-key">Category</div>
							<div class="detail-val">{detailExpense.category}</div>
						</div>
						<div class="detail-row">
							<div class="detail-key">Date</div>
							<div class="detail-val num">{formatDate(detailExpense.date)}</div>
						</div>
						{#if detailExpense.reference}
							<div class="detail-row">
								<div class="detail-key">Reference</div>
								<div class="detail-val num">{detailExpense.reference}</div>
							</div>
						{/if}
						{#if detailExpense.remark}
							<div class="detail-row">
								<div class="detail-key">Remark</div>
								<div class="detail-val">{detailExpense.remark}</div>
							</div>
						{/if}
					</div>
					<div class="attach-section-header">
						<div class="detail-section-label" style="margin:0;">Attachments</div>
						<button type="button" class="attach-add-btn" onclick={() => expenseFileInput?.click()}>
							<Plus size={11} /> Add
						</button>
					</div>
					<div
						class="attach-drop-area"
						class:drag={expenseDrag}
						ondragover={(e) => { e.preventDefault(); expenseDrag = true; }}
						ondragleave={() => (expenseDrag = false)}
						ondrop={handleExpenseDrop}
					>
						{#if detailExpense.attachments.length > 0}
							<div class="attach-list">
								{#each detailExpense.attachments as att (att.id)}
									<div class="attach-item">
										<div class="attach-thumb"><Paperclip size={14} /></div>
										<div class="attach-meta">
											<a href="/api/files/{att.filename}" target="_blank" rel="noopener" class="attach-name attach-link">{att.displayName}</a>
											<div class="attach-sub">{att.addedDate}</div>
										</div>
										<button type="button" class="attach-del" onclick={() => deleteExpenseAttachment(att.id)}>
											<X size={14} />
										</button>
									</div>
								{/each}
							</div>
						{:else}
							<div class="attach-empty attach-empty-drop" onclick={() => expenseFileInput?.click()}>
								<Paperclip size={14} /> Drop files here or click to add
							</div>
						{/if}
					</div>
					<input bind:this={expenseFileInput} type="file" accept=".pdf,.jpg,.jpeg,.png"
						multiple style="display:none" onchange={handleExpenseFileInput} />
				</div>
			{/if}
		</Sheet.Content>
	</Sheet.Portal>
</Sheet.Root>

<!-- New expense sheet -->
<Sheet.Root bind:open={showNew}>
	<Sheet.Portal>
		<Sheet.Overlay />
		<Sheet.Content side="right" style="width:460px; max-width:95vw; display:flex; flex-direction:column; overflow:hidden;">
			<div style="display:flex; align-items:flex-start; justify-content:space-between; padding:22px 22px 16px; border-bottom:1px solid var(--border);">
				<div>
					<div class="sheet-eyebrow">New</div>
					<div class="sheet-title-text">Add expense</div>
				</div>
				<Sheet.Close class="sheet-close">
					<X size={16} />
				</Sheet.Close>
			</div>
			<form
				method="POST"
				action="?/create"
				use:enhance={() => async ({ result, update }) => {
					if (result.type === 'success' && newExpenseFiles.length > 0) {
						const id = (result.data as Record<string, unknown>)?.id as number | undefined;
						if (id) {
							for (const file of newExpenseFiles) {
								const fd = new FormData();
								fd.append('file', file);
								await fetch(`/api/expenses/${id}/attachments`, { method: 'POST', body: fd });
							}
						}
						newExpenseFiles = [];
					}
					await update();
				}}
				style="flex:1; overflow-y:auto; padding:20px 22px; display:flex; flex-direction:column; gap:0;"
			>
				{#if form?.error}
					<div style="background:var(--red-soft); color:var(--red); border-radius:8px; padding:10px 14px; font-size:13px; margin-bottom:16px;">{form.error}</div>
				{/if}

				<div class="field">
					<label class="field-label" for="itemName">Item name *</label>
					<input id="itemName" name="itemName" type="text" required placeholder="e.g. Office chair" style="width:100%; height:36px; border:1px solid var(--input); background:var(--card); color:var(--foreground); border-radius:8px; padding:0 12px; font-family:inherit; font-size:13.5px; outline:none;" />
				</div>

				<div class="field-grid field">
					<div>
						<label class="field-label" for="date">Date *</label>
						<DatePicker name="date" defaultToday />
					</div>
					<div>
						<label class="field-label" for="amount">Amount (RM) *</label>
						<div class="amount-input">
							<span class="amount-prefix">RM</span>
							<input id="amount" name="amount" class="amount-field" inputmode="decimal" placeholder="0.00" required />
						</div>
					</div>
				</div>

				<div class="field">
					<label class="field-label" for="supplier">Supplier</label>
					<input id="supplier" name="supplier" type="text" placeholder="e.g. IKEA" style="width:100%; height:36px; border:1px solid var(--input); background:var(--card); color:var(--foreground); border-radius:8px; padding:0 12px; font-family:inherit; font-size:13.5px; outline:none;" />
				</div>

				<div class="field">
					<label class="field-label" for="category">Category</label>
					<select id="category" name="category" style="appearance:none; width:100%; height:36px; border:1px solid var(--input); background:var(--card); color:var(--foreground); border-radius:8px; padding:0 12px; font-family:inherit; font-size:13.5px; outline:none; cursor:pointer;">
						{#each data.categories as cat}
							<option value={cat}>{cat}</option>
						{/each}
					</select>
				</div>

				<div class="field">
					<label class="field-label" for="reference">Reference</label>
					<input id="reference" name="reference" type="text" placeholder="e.g. INV-001" style="width:100%; height:36px; border:1px solid var(--input); background:var(--card); color:var(--foreground); border-radius:8px; padding:0 12px; font-family:inherit; font-size:inherit; font-size:13.5px; outline:none;" />
				</div>

				<div class="field">
					<label class="field-label" for="remark">Remark</label>
					<textarea id="remark" name="remark" placeholder="Optional notes…" style="width:100%; min-height:72px; border:1px solid var(--input); background:var(--card); color:var(--foreground); border-radius:8px; padding:8px 12px; font-family:inherit; font-size:13.5px; outline:none; resize:vertical; line-height:1.5;"></textarea>
				</div>

				<div class="field">
					<label class="field-label">Attachments <span style="font-weight:400; color:var(--muted-foreground);">optional</span></label>
					{#if newExpenseFiles.length > 0}
						<div class="attach-list" style="margin-bottom:8px;">
							{#each newExpenseFiles as file, i}
								<div class="attach-item">
									<div class="attach-thumb"><Paperclip size={14} /></div>
									<div class="attach-meta">
										<div class="attach-name">{file.name}</div>
										<div class="attach-sub">{(file.size / 1024).toFixed(0)} KB</div>
									</div>
									<button type="button" class="attach-del" onclick={() => (newExpenseFiles = newExpenseFiles.filter((_, j) => j !== i))}>
										<X size={14} />
									</button>
								</div>
							{/each}
						</div>
					{/if}
					<div
						class="attach-drop-area"
						class:drag={newExpenseDrag}
						ondragover={(e) => { e.preventDefault(); newExpenseDrag = true; }}
						ondragleave={() => (newExpenseDrag = false)}
						ondrop={(e) => { e.preventDefault(); newExpenseDrag = false; if (e.dataTransfer?.files) newExpenseFiles = [...newExpenseFiles, ...Array.from(e.dataTransfer.files)]; }}
						onclick={() => newExpenseFileInput?.click()}
					>
						<div class="attach-empty attach-empty-drop" style="pointer-events:none;">
							<Upload size={14} /> Drop files here or click to browse
						</div>
					</div>
					<input bind:this={newExpenseFileInput} type="file" accept=".pdf,.jpg,.jpeg,.png" multiple style="display:none"
						onchange={(e) => { const f = (e.target as HTMLInputElement).files; if (f) newExpenseFiles = [...newExpenseFiles, ...Array.from(f)]; (e.target as HTMLInputElement).value = ''; }} />
				</div>

				<div style="border-top:1px solid var(--border); padding-top:14px; display:flex; justify-content:flex-end; gap:9px; margin-top:auto;">
					<button type="button" onclick={() => (showNew = false)} style="height:34px; padding:0 14px; border:1px solid var(--border); background:var(--card); color:var(--foreground); border-radius:8px; font-family:inherit; font-size:13px; cursor:pointer;">
						Cancel
					</button>
					<button type="submit" style="height:34px; padding:0 14px; background:var(--primary); color:var(--primary-foreground); border:none; border-radius:8px; font-family:inherit; font-size:13px; font-weight:500; cursor:pointer;">
						Add expense
					</button>
				</div>
			</form>
		</Sheet.Content>
	</Sheet.Portal>
</Sheet.Root>
