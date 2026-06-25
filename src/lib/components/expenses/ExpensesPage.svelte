<script lang="ts">
	import { enhance } from '$app/forms';
	import { useIsMobile } from '$lib/hooks/useIsMobile.svelte.js';
	import { createResourceStream, mergeById } from '$lib/sse.js';
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
		Upload,
		Trash2,
		Receipt,
		ChevronRight
	} from '@lucide/svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import AttachmentManager from '$lib/components/ui/AttachmentManager.svelte';
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import StatCard from '$lib/components/ui/StatCard.svelte';
	import BulkActionBar from '$lib/components/ui/BulkActionBar.svelte';
	import FilterDropdown from '$lib/components/ui/FilterDropdown.svelte';
	import ContactSelect from '$lib/components/ui/ContactSelect.svelte';
	import AmountInput from '$lib/components/ui/AmountInput.svelte';
	import * as Sheet from '$lib/components/ui/sheet/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { formatMoney, formatMoneyRM, formatDate, formatDateShort } from '$lib/format.js';
	import { mainCurrency, mainCurrencySymbol } from '$lib/currency-state.svelte.js';
	import { CURRENCIES, currencySymbol, currencyDecimals, formatCurrencyAmount } from '$lib/currency.js';
	import DatePicker from '$lib/components/ui/date-picker/DatePicker.svelte';
	import { ExpenseStatus, ClaimStatus, Role } from '$lib/enums.js';
	import { goto, pushState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import type { loadExpensesPage } from '$lib/server/loaders/expenses.js';

	type PageData = ReturnType<typeof loadExpensesPage>;
	type ActionData = { error?: string; success?: boolean; id?: number } | null;

	let { data, form, openId }: { data: PageData; form: ActionData; openId: number | null } = $props();

	// Status tab id → ExpenseStatus INT code.
	const STATUS_CODE: Record<string, number> = {
		unpaid: ExpenseStatus.Unpaid,
		pending: ExpenseStatus.Pending,
		paid: ExpenseStatus.Paid
	};

	// New-expense contact picker state (submitted via hidden inputs).
	let newContactId = $state<number | null>(null);
	let newContactName = $state<string | null>(null);
	let newExpenseCategory = $state<string>('');

	// Local reactive list — updated by SSE events and re-synced when SvelteKit reloads SSR data
	// svelte-ignore state_referenced_locally
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
	type FullExpense = (typeof data.expenses)[0] & {
		attachments: Attachment[];
		claimNumber?: string | null;
		claimStatus?: number | null;
		claimDate?: string | null;
	};
	let detailExpense = $state<FullExpense | null>(null);
	let deleteDialogOpen = $state(false);
	let deleteFormEl = $state<HTMLFormElement | null>(null);
	let showNew = $state(false);
	let mobileFilterOpen = $state(false);
	let mobileSearchOpen = $state(false);
	let mobileSearchEl = $state<HTMLInputElement | null>(null);
	$effect(() => { if (mobileSearchOpen && mobileSearchEl) mobileSearchEl.focus(); });
	let newExpenseFiles = $state<File[]>([]);
	let newExpenseDrag = $state(false);
	let newExpenseFileInput = $state<HTMLInputElement | null>(null);

	// --- Foreign-currency entry (hidden by default) ---
	const todayISO = () => new Date().toISOString().slice(0, 10);
	let showForeign = $state(false);
	// svelte-ignore state_referenced_locally
	let newCurrency = $state(mainCurrency());
	let newAmount = $state<string>('');
	let newForeignAmount = $state<string>('');
	let newRate = $state<string>('');
	let newDate = $state<string>(todayISO());
	let rateFetching = $state(false);
	let rateError = $state('');

	// Auto-fetch the rate when a foreign currency / date is chosen. Editable afterwards;
	// left blank with a hint when no API key or lookup fails (manual entry).
	$effect(() => {
		if (!showForeign) return;
		const cur = newCurrency;
		const d = newDate;
		if (cur === mainCurrency() || !d) { rateError = ''; return; }
		rateFetching = true;
		rateError = '';
		const t = setTimeout(async () => {
			try {
				const res = await fetch(`/api/exchange-rate?from=${cur}&to=${mainCurrency()}&date=${d}`);
				const json = await res.json();
				if (json.rate != null) newRate = String(json.rate);
				else { newRate = ''; rateError = 'No rate found — enter it manually'; }
			} catch {
				newRate = '';
				rateError = 'Could not fetch rate — enter it manually';
			} finally {
				rateFetching = false;
			}
		}, 400);
		return () => clearTimeout(t);
	});

	const isForeign = $derived(showForeign && newCurrency !== mainCurrency());
	// Main-currency value derived from the foreign amount × rate (shown read-only in the
	// main amount field while a foreign currency is active).
	const convertedMain = $derived.by(() => {
		const a = parseFloat(newForeignAmount);
		const r = parseFloat(newRate);
		if (!isForeign || isNaN(a) || isNaN(r) || r <= 0) return null;
		return a * r;
	});
	const convertedDisplay = $derived(
		convertedMain != null ? convertedMain.toFixed(currencyDecimals(mainCurrency())) : ''
	);
	// Foreign entry needs a positive rate before it can be submitted.
	const foreignRateMissing = $derived(isForeign && !(parseFloat(newRate) > 0));

	// Mobile panel detection — full-screen bottom sheet on mobile
	const screen = useIsMobile();
	const isMobile = $derived(screen.current);
	const panelSide = $derived(isMobile ? 'bottom' : 'right');

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
	$effect(() => { if (!showNew) { newExpenseFiles = []; newContactId = null; newContactName = null; newExpenseCategory = ''; showForeign = false; newCurrency = mainCurrency(); newAmount = ''; newForeignAmount = ''; newRate = ''; rateError = ''; newDate = todayISO(); } });

	// --- Derived ---
	const filtered = $derived.by(() => {
		let rows = expenses.slice();
		if (statusTab !== 'all') rows = rows.filter((e) => e.status === STATUS_CODE[statusTab]);
		if (selectedCats.length) rows = rows.filter((e) => selectedCats.includes(e.category));
		const mn = amountMin !== '' ? parseFloat(amountMin) : null;
		const mx = amountMax !== '' ? parseFloat(amountMax) : null;
		if (mn != null) rows = rows.filter((e) => e.mainAmount >= mn);
		if (mx != null) rows = rows.filter((e) => e.mainAmount <= mx);
		if (dateFrom) rows = rows.filter((e) => e.date >= dateFrom);
		if (dateTo) rows = rows.filter((e) => e.date <= dateTo);
		if (search.trim()) {
			const q = search.toLowerCase();
			rows = rows.filter(
				(e) =>
					e.itemName.toLowerCase().includes(q) ||
					(e.contactName ?? '').toLowerCase().includes(q) ||
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

	const filteredTotal = $derived(filtered.reduce((s, e) => s + e.mainAmount, 0));
	const activeFilterCount = $derived(
		selectedCats.length + (amountMin || amountMax ? 1 : 0) + (dateFrom || dateTo ? 1 : 0) + (search.trim() ? 1 : 0)
	);
	const allSelected = $derived(filtered.length > 0 && filtered.every((e) => selected.has(e.id)));
	const someSelected = $derived(filtered.some((e) => selected.has(e.id)) && !allSelected);
	const selectedList = $derived(filtered.filter((e) => selected.has(e.id)));
	const selTotal = $derived(selectedList.reduce((s, e) => s + e.mainAmount, 0));
	const claimable = $derived(selectedList.length > 0 && selectedList.every((e) => e.status === ExpenseStatus.Unpaid));

	const counts = $derived.by(() => ({
		all: expenses.length,
		unpaid: expenses.filter((e) => e.status === ExpenseStatus.Unpaid).length,
		pending: expenses.filter((e) => e.status === ExpenseStatus.Pending).length,
		paid: expenses.filter((e) => e.status === ExpenseStatus.Paid).length,
	}));

	// Stats — derived from local state so they update in real-time
	const stats = $derived.by(() => {
		const unpaid = expenses.filter((e) => e.status === ExpenseStatus.Unpaid);
		const pending = expenses.filter((e) => e.status === ExpenseStatus.Pending);
		const now = new Date();
		const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
		const thisMonth = expenses.filter((e) => e.date.startsWith(monthKey));
		return {
			outstanding: unpaid.reduce((s, e) => s + e.mainAmount, 0),
			outstandingCount: unpaid.length,
			pendingTotal: pending.reduce((s, e) => s + e.mainAmount, 0),
			monthTotal: thisMonth.reduce((s, e) => s + e.mainAmount, 0),
			monthCount: thisMonth.length,
			allTotal: expenses.reduce((s, e) => s + e.mainAmount, 0)
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
	type ExpenseStreamMsg =
		| { type: 'expense-update'; item: (typeof data.expenses)[0] }
		| { type: 'expense-delete'; id: number };
	createResourceStream<ExpenseStreamMsg>('/api/expenses/stream', (msg) => {
		if (msg.type === 'expense-update') expenses = mergeById(expenses, [msg.item]);
		else if (msg.type === 'expense-delete') expenses = expenses.filter((e) => e.id !== msg.id);
	});

	async function openExpense(e: (typeof data.expenses)[0], { push = true } = {}) {
		detailExpense = { ...e, attachments: [] };
		if (push) {
			pushState(resolve('/(app)/expenses/[id]', { id: String(e.id) }), { viaPush: true });
		}
		const res = await fetch(`/api/expenses/${e.id}`);
		if (res.ok) detailExpense = await res.json();
	}

	function closeDetail() {
		detailExpense = null;
		if (page.state.viaPush) {
			history.back();
		} else {
			goto(resolve('/expenses'), { replaceState: true, noScroll: true });
		}
	}

	onMount(() => {
		if (openId) {
			const found = expenses.find((e) => e.id === openId);
			if (found) openExpense(found, { push: false });
		}
	});

</script>

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
					<Input
						type="search"
						placeholder="Search item, supplier, ref…"
						bind:value={searchRaw}
						class="h-[34px] pl-8 text-[13px]"
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
		<StatCard tone="red" label="Outstanding" cur={mainCurrencySymbol()} value={formatMoney(stats.outstanding)} sub="{stats.outstandingCount} unpaid" />
		<StatCard tone="amber" label="Pending claims" cur={mainCurrencySymbol()} value={formatMoney(stats.pendingTotal)} sub="Awaiting reimbursement" />
		<StatCard label="This month" cur={mainCurrencySymbol()} value={formatMoney(stats.monthTotal)} sub="{stats.monthCount} records" />
		<StatCard label="All recorded" cur={mainCurrencySymbol()} value={formatMoney(stats.allTotal)} sub="{counts.all} expenses" />
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
									onfocus={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--accent)'; }}
									onblur={(e) => { (e.currentTarget as HTMLButtonElement).style.background = ''; }}
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
								<span style="font-size:11.5px; color:var(--muted-foreground);">From</span>
								<DatePicker bind:value={dateFrom} placeholder="From date" />
								<span style="font-size:11.5px; color:var(--muted-foreground);">To</span>
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
								<AmountInput wrapperStyle="width:120px;" placeholder="Min" bind:value={amountMin} style="width:84px;" />
								<span style="color:var(--muted-foreground);">–</span>
								<AmountInput wrapperStyle="width:120px;" placeholder="Max" bind:value={amountMax} style="width:84px;" />
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
								<td class="td-supplier" data-label="Supplier">{e.contactName || ''}</td>
								<td data-label="Category">
									<span style="display:inline-flex; align-items:center; font-size:11.5px; background:var(--secondary); color:var(--secondary-foreground); padding:2px 9px; border-radius:999px; white-space:nowrap;">
										{e.category}
									</span>
								</td>
								<td class="td-status"><StatusBadge status={e.status} /></td>
								<td class="td-date" data-label="Date">
									{formatDateShort(e.date)}<span class="td-year">{e.date.slice(0, 4)}</span>
								</td>
								<td class="td-amount" data-label="Amount">
									<span class="amount-num">{mainCurrencySymbol()} {formatMoney(e.mainAmount)}</span>
									{#if e.currency !== mainCurrency()}
										<span class="amount-orig">{e.currency} {formatCurrencyAmount(e.amount, e.currency)}</span>
									{/if}
								</td>
								<td class="row-break"></td>
							</tr>
						{/each}
						{#if counts.all === 0}
							<tr class="empty-row">
								<td colspan="7">
									<EmptyState title="No expenses yet" sub="Your expense history will appear here.">
										{#snippet icon()}<Wallet size={20} />{/snippet}
									</EmptyState>
								</td>
							</tr>
						{:else if filtered.length === 0}
							<tr class="empty-row">
								<td colspan="7">
									<EmptyState title="No expenses match your filters" sub="Try adjusting your search or filters.">
										{#snippet icon()}<Search size={20} />{/snippet}
										{#snippet action()}<button class="link-btn" onclick={clearAllFilters}>Clear filters</button>{/snippet}
									</EmptyState>
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
	<BulkActionBar show={selected.size > 0} count={selected.size} total={`${mainCurrencySymbol()} ${formatMoney(selTotal)}`} onclear={clearSel}>
		{#snippet actions()}
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
		{/snippet}
	</BulkActionBar>
</div>

<!-- Mobile filter sheet -->
<Sheet.Root bind:open={mobileFilterOpen}>
	<Sheet.Portal>
		<Sheet.Overlay />
		<Sheet.Content side="bottom" style="border-radius:16px 16px 0 0; max-height:85vh; overflow-y:auto; padding:20px 20px calc(20px + var(--safe-bottom));">
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
					<span style="font-size:11.5px; color:var(--muted-foreground);">From</span>
					<DatePicker bind:value={dateFrom} placeholder="From date" />
					<span style="font-size:11.5px; color:var(--muted-foreground);">To</span>
					<DatePicker bind:value={dateTo} placeholder="To date" />
				</div>
			</div>
			<div style="margin-bottom:20px;">
				<div style="font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.04em; color:var(--muted-foreground); margin-bottom:10px; display:flex; align-items:center; justify-content:space-between;">
					<span>Amount range</span>
					{#if amountMin || amountMax}<button onclick={() => { amountMin = ''; amountMax = ''; }} style="border:none; background:none; color:var(--primary); cursor:pointer; font-size:11px; font-weight:600;">Clear</button>{/if}
				</div>
				<div style="display:flex; align-items:center; gap:8px;">
					<AmountInput wrapperStyle="flex:1;" placeholder="Min" bind:value={amountMin} style="flex:1;" />
					<span style="color:var(--muted-foreground);">–</span>
					<AmountInput wrapperStyle="flex:1;" placeholder="Max" bind:value={amountMax} style="flex:1;" />
				</div>
			</div>
			<Button class="w-full" onclick={() => (mobileFilterOpen = false)}>
				Show results
			</Button>
		</Sheet.Content>
	</Sheet.Portal>
</Sheet.Root>

<!-- Detail sheet -->
<Sheet.Root open={!!detailExpense} onOpenChange={(o) => { if (!o) closeDetail(); }}>
	<Sheet.Portal>
		<Sheet.Overlay />
		<Sheet.Content side={panelSide} style={isMobile ? 'height:100dvh; border-radius:0; border-top:none; display:flex; flex-direction:column; overflow:hidden; gap:0;' : 'width:500px; max-width:95vw; display:flex; flex-direction:column; overflow:hidden; gap:0;'}>
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
						<span class="detail-amount-cur">{mainCurrencySymbol()}</span>
						<span class="detail-amount-val">{formatMoney(detailExpense.mainAmount)}</span>
						{#if detailExpense.claimId}
							<span class="detail-amount-lock" title="Amount locked (linked to a claim)"><Lock size={15} /></span>
						{/if}
					</div>
					{#if detailExpense.currency !== mainCurrency()}
						<div class="detail-orig">
							Original: {detailExpense.currency} {formatCurrencyAmount(detailExpense.amount, detailExpense.currency)}
							· rate {detailExpense.exchangeRate}
						</div>
					{/if}
					<div class="detail-statusrow">
						<StatusBadge status={detailExpense.status} />
					</div>
					<div class="detail-list">
						{#if detailExpense.contactName}
							<div class="detail-row">
								<div class="detail-key">Supplier</div>
								<div class="detail-val">{detailExpense.contactName}</div>
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
					{#if detailExpense.claimId}
						<div class="detail-section-label">Linked claim</div>
						<button
							type="button"
							class="linked-claim-card related-link"
							onclick={() => goto(resolve('/(app)/claims/[id]', { id: String(detailExpense?.claimId) }))}
						>
							<div class="linked-claim-icon"><Receipt size={16} /></div>
							<div class="linked-claim-meta">
								<div class="linked-claim-title">
									Claim {detailExpense.claimNumber}
									<StatusBadge
										status={detailExpense.claimStatus === ClaimStatus.Done ? 'claimed' : 'pending'}
									/>
								</div>
								{#if detailExpense.claimDate}
									<div class="linked-claim-sub">{formatDate(detailExpense.claimDate)}</div>
								{/if}
							</div>
							<ChevronRight size={14} class="linked-claim-chevron" />
						</button>
					{/if}
					<AttachmentManager apiBase={`/api/expenses/${detailExpense.id}`} bind:attachments={detailExpense.attachments} />
				</div>
				<div class="sheet-foot">
					{#if detailExpense.claimId}
						<div class="sheet-foot-note">
							Linked to claim {detailExpense.claimNumber} — remove it from the claim to delete.
						</div>
					{/if}
					<div class="sheet-foot-actions">
						<button
							type="button"
							class="sheet-btn sheet-btn-delete"
							disabled={!!detailExpense.claimId}
							title={detailExpense.claimId ? `Linked to claim ${detailExpense.claimNumber}` : undefined}
							onclick={() => (deleteDialogOpen = true)}
						>
							<Trash2 size={14} /> Delete
						</button>
					</div>
				</div>
			{/if}
		</Sheet.Content>
	</Sheet.Portal>
</Sheet.Root>

{#if detailExpense}
	<ConfirmDialog
		bind:open={deleteDialogOpen}
		title="Delete expense?"
		description={`This will permanently delete ${detailExpense.expenseNumber} and its ${detailExpense.attachments.length} attachment(s). This can't be undone.`}
		confirmLabel="Delete"
		danger
		onConfirm={() => deleteFormEl?.requestSubmit()}
	/>
	<form
		method="POST"
		action="?/delete"
		bind:this={deleteFormEl}
		use:enhance={() => async ({ result, update }) => {
			if (result.type === 'success') { deleteDialogOpen = false; closeDetail(); }
			await update();
		}}
		style="display:none"
	>
		<input type="hidden" name="id" value={detailExpense.id} />
	</form>
{/if}

<!-- New expense sheet -->
<Sheet.Root bind:open={showNew}>
	<Sheet.Portal>
		<Sheet.Overlay />
		<Sheet.Content side={panelSide} style={isMobile ? 'height:100dvh; border-radius:0; border-top:none; display:flex; flex-direction:column; overflow:hidden; gap:0;' : 'width:500px; max-width:95vw; display:flex; flex-direction:column; overflow:hidden; gap:0;'}>
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
					<Input id="itemName" name="itemName" type="text" required placeholder="e.g. Office chair" />
				</div>

				<div class="field-grid field">
					<div>
						<label class="field-label" for="date">Date *</label>
						<DatePicker name="date" bind:value={newDate} />
					</div>
					<div>
						<label class="field-label" for="amount">Amount{isForeign ? ` (${mainCurrency()})` : ''} *</label>
						{#if isForeign}
							<AmountInput id="amount" placeholder="0.00" readonly value={convertedDisplay} />
						{:else}
							<AmountInput id="amount" placeholder="0.00" required bind:value={newAmount} />
						{/if}
					</div>
				</div>

				<!-- Foreign currency (advanced, hidden by default) -->
				<input type="hidden" name="amount" value={isForeign ? newForeignAmount : newAmount} />
				<input type="hidden" name="currency" value={isForeign ? newCurrency : mainCurrency()} />
				<input type="hidden" name="exchangeRate" value={isForeign ? newRate : '1'} />
				<div class="field">
					{#if !showForeign}
						<button type="button" class="foreign-toggle" onclick={() => (showForeign = true)}>
							<Plus size={13} /> Foreign currency
						</button>
					{:else}
						<div class="foreign-box">
							<div class="foreign-head">
								<span class="field-label" style="margin:0;">Foreign currency</span>
								<button type="button" class="foreign-close" onclick={() => { showForeign = false; newCurrency = mainCurrency(); newForeignAmount = ''; newRate = ''; rateError = ''; }} aria-label="Remove foreign currency">
									<X size={13} />
								</button>
							</div>
							<div class="field" style="margin-bottom:10px;">
								<label class="field-label" for="fx-cur">Currency</label>
								<Select.Root type="single" bind:value={newCurrency}>
									<Select.Trigger id="fx-cur" class="w-full">{newCurrency}</Select.Trigger>
									<Select.Content>
										{#each CURRENCIES as c (c.code)}
											<Select.Item value={c.code} label={`${c.code} — ${c.name}`} />
										{/each}
									</Select.Content>
								</Select.Root>
							</div>
							<div class="field-grid">
								<div>
									<label class="field-label" for="fx-amount">Amount{isForeign ? ` (${newCurrency})` : ''}</label>
									<AmountInput id="fx-amount" placeholder="0.00" required={isForeign} bind:value={newForeignAmount} prefix={currencySymbol(newCurrency)} disabled={!isForeign} />
								</div>
								<div>
									<label class="field-label" for="fx-rate">Rate (1 {newCurrency} = ? {mainCurrency()})</label>
									<Input id="fx-rate" type="text" inputmode="decimal" placeholder="0.0000" bind:value={newRate} disabled={!isForeign} />
								</div>
							</div>
							{#if isForeign}
								<div class="foreign-note">
									{#if rateFetching}
										Fetching rate…
									{:else if rateError}
										{rateError}
									{/if}
								</div>
							{/if}
						</div>
					{/if}
				</div>

				<div class="field">
					<label class="field-label" for="supplier">Supplier</label>
					<ContactSelect
						role={Role.Supplier}
						bind:value={newContactId}
						bind:newName={newContactName}
						placeholder="Search or add a supplier…"
					/>
					<input type="hidden" name="contactId" value={newContactId ?? ''} />
					<input type="hidden" name="newContactName" value={newContactName ?? ''} />
				</div>

				<div class="field">
					<label class="field-label" for="category">Category</label>
					<Select.Root type="single" name="category" bind:value={newExpenseCategory}>
						<Select.Trigger id="category" class="w-full">
							{newExpenseCategory || 'Select category'}
						</Select.Trigger>
						<Select.Content>
							{#each data.categories as cat}
								<Select.Item value={cat} label={cat} />
							{/each}
						</Select.Content>
					</Select.Root>
				</div>

				<div class="field">
					<label class="field-label" for="reference">Reference</label>
					<Input id="reference" name="reference" type="text" placeholder="e.g. INV-001" />
				</div>

				<div class="field">
					<label class="field-label" for="remark">Remark</label>
					<Textarea id="remark" name="remark" placeholder="Optional notes…" class="leading-relaxed" />
				</div>

				<div class="field">
					<span class="field-label">Attachments <span style="font-weight:400; color:var(--muted-foreground);">optional</span></span>
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
						role="button"
						tabindex="0"
						aria-label="Attach files"
						ondragover={(e) => { e.preventDefault(); newExpenseDrag = true; }}
						ondragleave={() => (newExpenseDrag = false)}
						ondrop={(e) => { e.preventDefault(); newExpenseDrag = false; if (e.dataTransfer?.files) newExpenseFiles = [...newExpenseFiles, ...Array.from(e.dataTransfer.files)]; }}
						onclick={() => newExpenseFileInput?.click()}
						onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); newExpenseFileInput?.click(); } }}
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
					<button type="submit" disabled={foreignRateMissing} title={foreignRateMissing ? 'Enter an exchange rate first' : undefined} style="height:34px; padding:0 14px; background:var(--primary); color:var(--primary-foreground); border:none; border-radius:8px; font-family:inherit; font-size:13px; font-weight:500; cursor:pointer; opacity:{foreignRateMissing ? 0.5 : 1};">
						Add expense
					</button>
				</div>
			</form>
		</Sheet.Content>
	</Sheet.Portal>
</Sheet.Root>

<style>
	@media (max-width: 767px) {
		/* Status leads, then category chip, then supplier text, then date */
		td[data-label="Category"] { order: 6 !important; }
		.td-supplier { order: 7 !important; }
		.td-date { order: 8 !important; }
	}
</style>
