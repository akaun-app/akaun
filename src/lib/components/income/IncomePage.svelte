<script lang="ts">
	import { enhance } from '$app/forms';
	import { useIsMobile } from '$lib/hooks/useIsMobile.svelte.js';
	import { createResourceStream, mergeById } from '$lib/sse.js';
	import { fly } from 'svelte/transition';
	import {
		TrendingUp,
		Plus,
		Search,
		Tag,
		Calendar,
		SlidersHorizontal,
		X,
		Paperclip,
		Upload,
		Trash2
	} from '@lucide/svelte';
	import * as Sheet from '$lib/components/ui/sheet/index.js';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import FilterDropdown from '$lib/components/ui/FilterDropdown.svelte';
	import DatePicker from '$lib/components/ui/date-picker/DatePicker.svelte';
	import ContactSelect from '$lib/components/ui/ContactSelect.svelte';
	import AmountInput from '$lib/components/ui/AmountInput.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import AttachmentManager from '$lib/components/ui/AttachmentManager.svelte';
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import StatCard from '$lib/components/ui/StatCard.svelte';
	import BulkActionBar from '$lib/components/ui/BulkActionBar.svelte';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Role } from '$lib/enums.js';
	import { formatMoney, formatMoneyRM, formatDate, formatDateShort } from '$lib/format.js';
	import { mainCurrency, mainCurrencySymbol } from '$lib/currency-state.svelte.js';
	import { CURRENCIES, currencySymbol, formatCurrencyAmount } from '$lib/currency.js';
	import { goto, pushState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import type { loadIncomePage } from '$lib/server/loaders/income.js';

	type PageData = ReturnType<typeof loadIncomePage>;
	type ActionData = { error?: string; success?: boolean; id?: number } | null;

	let { data, form, openId }: { data: PageData; form: ActionData; openId: number | null } = $props();

	// New-income customer picker state (submitted via hidden inputs).
	let newContactId = $state<number | null>(null);
	let newContactName = $state<string | null>(null);
	let newIncomeCategory = $state<string>('');

	// Local reactive list — updated by SSE events and re-synced when SvelteKit reloads SSR data
	// svelte-ignore state_referenced_locally
	let incomes = $state(data.incomes);
	$effect(() => { incomes = data.incomes; });

	// Search + filter state
	let searchRaw = $state('');
	let search = $state('');
	let selectedCats = $state<string[]>([]);
	let dateFrom = $state('');
	let dateTo = $state('');
	let amountMin = $state('');
	let amountMax = $state('');
	let sort = $state({ key: 'date', dir: 'desc' as 'asc' | 'desc' });

	// UI state
	let showNew = $state(false);
	let mobileFilterOpen = $state(false);
	let mobileSearchOpen = $state(false);
	let mobileSearchEl = $state<HTMLInputElement | null>(null);
	$effect(() => { if (mobileSearchOpen && mobileSearchEl) mobileSearchEl.focus(); });
	type Attachment = { id: number; filename: string; displayName: string; addedDate: string };
	type FullIncome = (typeof data.incomes)[0] & { attachments: Attachment[] };
	let detailIncome = $state<FullIncome | null>(null);
	let deleteDialogOpen = $state(false);
	let deleteFormEl = $state<HTMLFormElement | null>(null);
	let selected = $state(new Set<number>());
	let newIncomeFiles = $state<File[]>([]);
	let newIncomeDrag = $state(false);
	let newIncomeFileInput = $state<HTMLInputElement | null>(null);

	// --- Foreign-currency entry (hidden by default) ---
	const todayISO = () => new Date().toISOString().slice(0, 10);
	let showForeign = $state(false);
	// svelte-ignore state_referenced_locally
	let newCurrency = $state(mainCurrency());
	let newAmount = $state<string>('');
	let newRate = $state<string>('');
	let newDate = $state<string>(todayISO());
	let rateFetching = $state(false);
	let rateError = $state('');

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
	const convertedPreview = $derived.by(() => {
		const a = parseFloat(newAmount);
		const r = parseFloat(newRate);
		if (!isForeign || isNaN(a) || isNaN(r) || r <= 0) return null;
		return a * r;
	});
	const foreignRateMissing = $derived(isForeign && !(parseFloat(newRate) > 0));

	// Mobile panel detection — full-screen bottom sheet on mobile
	const screen = useIsMobile();
	const isMobile = $derived(screen.current);
	const panelSide = $derived(isMobile ? 'bottom' : 'right');

	// Debounce search
	$effect(() => {
		const raw = searchRaw;
		const t = setTimeout(() => (search = raw), 300);
		return () => clearTimeout(t);
	});

	$effect(() => {
		if (form?.success) showNew = false;
	});
	$effect(() => { if (!showNew) { newIncomeFiles = []; newContactId = null; newContactName = null; newIncomeCategory = ''; showForeign = false; newCurrency = mainCurrency(); newAmount = ''; newRate = ''; rateError = ''; newDate = todayISO(); } });

	function toggleCat(cat: string) {
		selectedCats = selectedCats.includes(cat)
			? selectedCats.filter((c) => c !== cat)
			: [...selectedCats, cat];
	}

	// Filtered + sorted list
	const filtered = $derived.by(() => {
		let list = incomes.slice();
		if (selectedCats.length) list = list.filter((i) => selectedCats.includes(i.category));
		const mn = amountMin !== '' ? parseFloat(amountMin) : null;
		const mx = amountMax !== '' ? parseFloat(amountMax) : null;
		if (mn != null) list = list.filter((i) => i.mainAmount >= mn);
		if (mx != null) list = list.filter((i) => i.mainAmount <= mx);
		if (dateFrom) list = list.filter((i) => i.date >= dateFrom);
		if (dateTo) list = list.filter((i) => i.date <= dateTo);
		if (search.trim()) {
			const q = search.toLowerCase();
			list = list.filter(
				(i) =>
					(i.contactName ?? '').toLowerCase().includes(q) ||
					(i.descriptionText ?? '').toLowerCase().includes(q) ||
					(i.reference ?? '').toLowerCase().includes(q) ||
					i.category.toLowerCase().includes(q) ||
					i.incomeNumber.toLowerCase().includes(q)
			);
		}
		list.sort((a, b) => {
			const av = a[sort.key as keyof typeof a] as string | number;
			const bv = b[sort.key as keyof typeof b] as string | number;
			let cmp = av < bv ? -1 : av > bv ? 1 : 0;
			if (cmp === 0) cmp = a.id - b.id;
			return sort.dir === 'asc' ? cmp : -cmp;
		});
		return list;
	});

	function onSort(key: string) {
		sort = sort.key === key
			? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' }
			: { key, dir: 'asc' };
	}

	function toggleOne(id: number) {
		const s = new Set(selected);
		s.has(id) ? s.delete(id) : s.add(id);
		selected = s;
	}

	function toggleAll() {
		if (selected.size === filtered.length) selected = new Set();
		else selected = new Set(filtered.map((i) => i.id));
	}

	const selTotal = $derived(
		filtered.filter((i) => selected.has(i.id)).reduce((s, i) => s + i.mainAmount, 0)
	);
	const filteredTotal = $derived(filtered.reduce((s, i) => s + i.mainAmount, 0));
	const allSelected = $derived(filtered.length > 0 && selected.size === filtered.length);
	const someSelected = $derived(selected.size > 0 && selected.size < filtered.length);
	const activeFilterCount = $derived(
		selectedCats.length + (dateFrom || dateTo ? 1 : 0) + (amountMin || amountMax ? 1 : 0) + (search.trim() ? 1 : 0)
	);

	function clearSel() { selected = new Set(); }
	function clearAllFilters() {
		selectedCats = [];
		dateFrom = '';
		dateTo = '';
		amountMin = '';
		amountMax = '';
		searchRaw = '';
	}

	const today = new Date().toISOString().slice(0, 10);

	// Stats — derived from local state so they update in real-time
	const stats = $derived.by(() => {
		const now = new Date();
		const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
		const qStart = `${now.getFullYear()}-${String(Math.floor(now.getMonth() / 3) * 3 + 1).padStart(2, '0')}-01`;
		return {
			thisMonth: incomes.filter((i) => i.date.startsWith(monthKey)).reduce((s, i) => s + i.mainAmount, 0),
			thisQuarter: incomes.filter((i) => i.date >= qStart).reduce((s, i) => s + i.mainAmount, 0),
			largest: incomes.length > 0 ? Math.max(...incomes.map((i) => i.mainAmount)) : 0,
			allTotal: incomes.reduce((s, i) => s + i.mainAmount, 0),
			count: incomes.length,
		};
	});

	// SSE — real-time updates from server
	type IncomeStreamMsg =
		| { type: 'income-update'; item: (typeof data.incomes)[0] }
		| { type: 'income-delete'; id: number };
	createResourceStream<IncomeStreamMsg>('/api/income/stream', (msg) => {
		if (msg.type === 'income-update') incomes = mergeById(incomes, [msg.item]);
		else if (msg.type === 'income-delete') incomes = incomes.filter((i) => i.id !== msg.id);
	});

	async function openIncome(inc: (typeof data.incomes)[0], { push = true } = {}) {
		detailIncome = { ...inc, attachments: [] };
		if (push) {
			pushState(resolve('/(app)/income/[id]', { id: String(inc.id) }), { viaPush: true });
		}
		const res = await fetch(`/api/income/${inc.id}`);
		if (res.ok) detailIncome = await res.json();
	}

	function closeDetail() {
		detailIncome = null;
		if (page.state.viaPush) {
			history.back();
		} else {
			goto(resolve('/income'), { replaceState: true, noScroll: true });
		}
	}

	onMount(() => {
		if (openId) {
			const found = incomes.find((i) => i.id === openId);
			if (found) openIncome(found, { push: false });
		}
	});

</script>

<div class="screen" style="position:relative;">
	<!-- Top bar -->
	<header class="topbar">
		<div class="topbar-left">
			<h1 class="page-title">Income</h1>
			<p class="page-sub">
				{stats.count} records · <span class="num">+{formatMoneyRM(stats.allTotal)}</span> total
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
						placeholder="Search source, reference…"
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
						placeholder="Search source, reference…"
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
				<Plus size={15} /> <span class="btn-text">Record income</span>
			</button>
		</div>
	</header>

	<!-- Stat strip -->
	<div class="stat-strip">
		<StatCard tone="green" label="This month" cur={'+' + mainCurrencySymbol()} value={formatMoney(stats.thisMonth)} />
		<StatCard label="This quarter" cur={'+' + mainCurrencySymbol()} value={formatMoney(stats.thisQuarter)} />
		<StatCard label="Largest payment" cur={'+' + mainCurrencySymbol()} value={formatMoney(stats.largest)} />
		<StatCard tone="green" label="All received" cur={'+' + mainCurrencySymbol()} value={formatMoney(stats.allTotal)} />
	</div>

	<div class="work">
		<div class="work-main layout-standard" style="padding-top:12px;">
			<!-- Toolbar -->
			<div class="toolbar">
				<div class="toolbar-heading">
					<TrendingUp size={14} />
					All income
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
				<span>Showing <b>{filtered.length}</b> of {stats.count}</span>
				<span class="result-total">Filtered total <b class="num">+{formatMoneyRM(filteredTotal)}</b></span>
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
							<th class={`sortable ${sort.key === 'descriptionText' ? 'sorted' : ''}`} onclick={() => onSort('descriptionText')} style="cursor:pointer; user-select:none;">
								<span class="th-inner">Description {sort.key === 'descriptionText' ? (sort.dir === 'asc' ? '↑' : '↓') : ''}</span>
							</th>
							<th class={`sortable ${sort.key === 'contactName' ? 'sorted' : ''}`} onclick={() => onSort('contactName')} style="cursor:pointer; user-select:none;">
								<span class="th-inner">Source {sort.key === 'contactName' ? (sort.dir === 'asc' ? '↑' : '↓') : ''}</span>
							</th>
							<th class="sortable" onclick={() => onSort('category')} style="cursor:pointer; user-select:none;">
								<span class="th-inner">Category {sort.key === 'category' ? (sort.dir === 'asc' ? '↑' : '↓') : ''}</span>
							</th>
							<th class="sortable" onclick={() => onSort('date')} style="cursor:pointer; user-select:none;">
								<span class="th-inner">Date {sort.key === 'date' ? (sort.dir === 'asc' ? '↑' : '↓') : ''}</span>
							</th>
							<th class="sortable ta-right" onclick={() => onSort('amount')} style="cursor:pointer; user-select:none;">
								<span class="th-inner">Amount {sort.key === 'amount' ? (sort.dir === 'asc' ? '↑' : '↓') : ''}</span>
							</th>
						</tr>
					</thead>
					<tbody>
						{#each filtered as inc (inc.id)}
							<tr
								class="exp-row"
								class:selected={selected.has(inc.id)}
								onclick={() => openIncome(inc)}
							>
								<td class="td-check" onclick={(ev) => { ev.stopPropagation(); toggleOne(inc.id); }}>
									<button
										type="button"
										style="width:17px; height:17px; border-radius:5px; border:1.5px solid {selected.has(inc.id) ? 'var(--primary)' : 'var(--border-strong)'}; background:{selected.has(inc.id) ? 'var(--primary)' : 'var(--card)'}; display:grid; place-items:center; cursor:pointer; color:var(--primary-foreground); padding:0; flex-shrink:0;"
										aria-label="Select {inc.incomeNumber}"
									>
										{#if selected.has(inc.id)}<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><path d="M20 6 9 17l-5-5"/></svg>{/if}
									</button>
								</td>
								<td class="td-primary">
									<div class="cell-item">
										<span class="cell-itemname">{inc.descriptionText || '—'}</span>
										<span class="cell-itemnum">{inc.incomeNumber}</span>
									</div>
								</td>
								<td class="td-supplier" data-label="Source">{inc.contactName || ''}</td>
								<td data-label="Category">
									<span style="display:inline-flex; align-items:center; font-size:11.5px; background:var(--secondary); color:var(--secondary-foreground); padding:2px 9px; border-radius:999px; white-space:nowrap;">
										{inc.category}
									</span>
								</td>
								<td class="td-date" data-label="Date">
									{formatDateShort(inc.date)}<span class="td-year">{inc.date.slice(0, 4)}</span>
								</td>
								<td class="td-amount" data-label="Amount">
									<span class="amount-num" style="color:var(--green);">+{mainCurrencySymbol()} {formatMoney(inc.mainAmount)}</span>
									{#if inc.currency !== mainCurrency()}
										<span class="amount-orig">{inc.currency} {formatCurrencyAmount(inc.amount, inc.currency)}</span>
									{/if}
								</td>
								<td class="row-break"></td>
							</tr>
						{/each}
						{#if stats.count === 0}
							<tr class="empty-row">
								<td colspan="6">
									<EmptyState title="No income yet" sub="Your income history will appear here.">
										{#snippet icon()}<TrendingUp size={20} />{/snippet}
									</EmptyState>
								</td>
							</tr>
						{:else if filtered.length === 0}
							<tr class="empty-row">
								<td colspan="6">
									<EmptyState title="No income matches your filters" sub="Try adjusting your search or filters.">
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
				<span>{filtered.length} of {stats.count} records</span>
				<span class="muted">Updated just now</span>
			</div>
		</div>
	</div>

	<!-- Bulk action bar -->
	<BulkActionBar show={selected.size > 0} count={selected.size} total={`+${mainCurrencySymbol()} ${formatMoney(selTotal)}`} onclear={clearSel}>
		{#snippet actions()}
			<button class="bulk-actions-ghost" onclick={clearSel} style="padding:5px 10px; border-radius:6px; font-family:inherit; font-size:13px; cursor:pointer;">
				Deselect all
			</button>
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
<Sheet.Root open={!!detailIncome} onOpenChange={(o) => { if (!o) closeDetail(); }}>
	<Sheet.Portal>
		<Sheet.Overlay />
		<Sheet.Content side={panelSide} style={isMobile ? 'height:100dvh; border-radius:0; border-top:none; display:flex; flex-direction:column; overflow:hidden; gap:0;' : 'width:500px; max-width:95vw; display:flex; flex-direction:column; overflow:hidden; gap:0;'}>
			{#if detailIncome}
				<div style="display:flex; align-items:flex-start; justify-content:space-between; padding:22px 22px 16px; border-bottom:1px solid var(--border);">
					<div>
						<div class="sheet-eyebrow">{detailIncome.incomeNumber}</div>
						<div class="sheet-title-text">{detailIncome.contactName ?? '—'}</div>
					</div>
					<Sheet.Close class="sheet-close">
						<X size={16} />
					</Sheet.Close>
				</div>
				<div style="flex:1; overflow-y:auto; padding:20px 22px;">
					<div class="detail-amount">
						<span class="detail-amount-cur">{mainCurrencySymbol()}</span>
						<span class="detail-amount-val inc">+{formatMoney(detailIncome.mainAmount)}</span>
					</div>
					{#if detailIncome.currency !== mainCurrency()}
						<div class="detail-orig">
							Original: {detailIncome.currency} {formatCurrencyAmount(detailIncome.amount, detailIncome.currency)}
							· rate {detailIncome.exchangeRate}
						</div>
					{/if}
					<div class="detail-statusrow">
						<StatusBadge status="received" />
					</div>
					<div class="detail-list">
						<div class="detail-row">
							<div class="detail-key">Customer</div>
							<div class="detail-val">{detailIncome.contactName ?? '—'}</div>
						</div>
						<div class="detail-row">
							<div class="detail-key">Category</div>
							<div class="detail-val">{detailIncome.category}</div>
						</div>
						<div class="detail-row">
							<div class="detail-key">Date</div>
							<div class="detail-val num">{formatDate(detailIncome.date)}</div>
						</div>
						{#if detailIncome.reference}
							<div class="detail-row">
								<div class="detail-key">Reference</div>
								<div class="detail-val num">{detailIncome.reference}</div>
							</div>
						{/if}
						{#if detailIncome.descriptionText}
							<div class="detail-row">
								<div class="detail-key">Description</div>
								<div class="detail-val">{detailIncome.descriptionText}</div>
							</div>
						{/if}
						{#if detailIncome.remark}
							<div class="detail-row">
								<div class="detail-key">Remark</div>
								<div class="detail-val">{detailIncome.remark}</div>
							</div>
						{/if}
					</div>
					<AttachmentManager apiBase={`/api/income/${detailIncome.id}`} bind:attachments={detailIncome.attachments} />
				</div>
				<div class="sheet-foot">
					<div class="sheet-foot-actions">
						<button
							type="button"
							class="sheet-btn sheet-btn-delete"
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

{#if detailIncome}
	<ConfirmDialog
		bind:open={deleteDialogOpen}
		title="Delete income record?"
		description={`This will permanently delete ${detailIncome.incomeNumber} and its ${detailIncome.attachments.length} attachment(s). This can't be undone.`}
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
		<input type="hidden" name="id" value={detailIncome.id} />
	</form>
{/if}

<!-- New income sheet -->
<Sheet.Root bind:open={showNew}>
	<Sheet.Portal>
		<Sheet.Overlay />
		<Sheet.Content side={panelSide} style={isMobile ? 'height:100dvh; border-radius:0; border-top:none; display:flex; flex-direction:column; overflow:hidden; gap:0;' : 'width:500px; max-width:95vw; display:flex; flex-direction:column; overflow:hidden; gap:0;'}>
			<div style="display:flex; align-items:flex-start; justify-content:space-between; padding:22px 22px 16px; border-bottom:1px solid var(--border);">
				<div>
					<div class="sheet-eyebrow">New</div>
					<div class="sheet-title-text">Record income</div>
				</div>
				<Sheet.Close class="sheet-close">
					<X size={16} />
				</Sheet.Close>
			</div>
			<form
				method="POST"
				action="?/create"
				use:enhance={() => async ({ result, update }) => {
					if (result.type === 'success' && newIncomeFiles.length > 0) {
						const id = (result.data as Record<string, unknown>)?.id as number | undefined;
						if (id) {
							for (const file of newIncomeFiles) {
								const fd = new FormData();
								fd.append('file', file);
								await fetch(`/api/income/${id}/attachments`, { method: 'POST', body: fd });
							}
						}
						newIncomeFiles = [];
					}
					await update();
				}}
				style="flex:1; overflow-y:auto; padding:20px 22px; display:flex; flex-direction:column; gap:0;"
			>
				{#if form?.error}
					<div style="background:var(--red-soft); color:var(--red); border-radius:8px; padding:10px 14px; font-size:13px; margin-bottom:16px;">{form.error}</div>
				{/if}

				<div class="field">
					<label class="field-label" for="source">Customer *</label>
					<ContactSelect
						role={Role.Customer}
						bind:value={newContactId}
						bind:newName={newContactName}
						placeholder="Search or add a customer…"
					/>
					<input type="hidden" name="contactId" value={newContactId ?? ''} />
					<input type="hidden" name="newContactName" value={newContactName ?? ''} />
				</div>

				<div class="field-grid field">
					<div>
						<label class="field-label" for="date">Date *</label>
						<DatePicker name="date" bind:value={newDate} />
					</div>
					<div>
						<label class="field-label" for="amount">Amount{isForeign ? ` (${newCurrency})` : ''} *</label>
						<AmountInput
							id="amount"
							name="amount"
							placeholder="0.00"
							required
							bind:value={newAmount}
							prefix={isForeign ? currencySymbol(newCurrency) : undefined}
						/>
					</div>
				</div>

				<!-- Foreign currency (advanced, hidden by default) -->
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
								<button type="button" class="foreign-close" onclick={() => { showForeign = false; newCurrency = mainCurrency(); newRate = ''; rateError = ''; }} aria-label="Remove foreign currency">
									<X size={13} />
								</button>
							</div>
							<div class="field-grid">
								<div>
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
									{:else if convertedPreview != null}
										≈ +{mainCurrencySymbol()} {formatMoney(convertedPreview)} in {mainCurrency()}
									{/if}
								</div>
							{/if}
						</div>
					{/if}
				</div>

				<div class="field">
					<label class="field-label" for="category">Category</label>
					<Select.Root type="single" name="category" bind:value={newIncomeCategory}>
						<Select.Trigger id="category" class="w-full">
							{newIncomeCategory || 'Select category'}
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
					<label class="field-label" for="descriptionText">Description</label>
					<Textarea id="descriptionText" name="descriptionText" placeholder="Optional notes…" class="leading-relaxed" />
				</div>

				<div class="field">
					<span class="field-label">Attachments <span style="font-weight:400; color:var(--muted-foreground);">optional</span></span>
					{#if newIncomeFiles.length > 0}
						<div class="attach-list" style="margin-bottom:8px;">
							{#each newIncomeFiles as file, i}
								<div class="attach-item">
									<div class="attach-thumb"><Paperclip size={14} /></div>
									<div class="attach-meta">
										<div class="attach-name">{file.name}</div>
										<div class="attach-sub">{(file.size / 1024).toFixed(0)} KB</div>
									</div>
									<button type="button" class="attach-del" onclick={() => (newIncomeFiles = newIncomeFiles.filter((_, j) => j !== i))}>
										<X size={14} />
									</button>
								</div>
							{/each}
						</div>
					{/if}
					<div
						class="attach-drop-area"
						class:drag={newIncomeDrag}
						role="button"
						tabindex="0"
						aria-label="Attach files"
						ondragover={(e) => { e.preventDefault(); newIncomeDrag = true; }}
						ondragleave={() => (newIncomeDrag = false)}
						ondrop={(e) => { e.preventDefault(); newIncomeDrag = false; if (e.dataTransfer?.files) newIncomeFiles = [...newIncomeFiles, ...Array.from(e.dataTransfer.files)]; }}
						onclick={() => newIncomeFileInput?.click()}
						onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); newIncomeFileInput?.click(); } }}
					>
						<div class="attach-empty attach-empty-drop" style="pointer-events:none;">
							<Upload size={14} /> Drop files here or click to browse
						</div>
					</div>
					<input bind:this={newIncomeFileInput} type="file" accept=".pdf,.jpg,.jpeg,.png" multiple style="display:none"
						onchange={(e) => { const f = (e.target as HTMLInputElement).files; if (f) newIncomeFiles = [...newIncomeFiles, ...Array.from(f)]; (e.target as HTMLInputElement).value = ''; }} />
				</div>

				<div style="border-top:1px solid var(--border); padding-top:14px; display:flex; justify-content:flex-end; gap:9px; margin-top:auto;">
					<button type="button" onclick={() => (showNew = false)} style="height:34px; padding:0 14px; border:1px solid var(--border); background:var(--card); color:var(--foreground); border-radius:8px; font-family:inherit; font-size:13px; cursor:pointer;">
						Cancel
					</button>
					<button type="submit" disabled={foreignRateMissing} title={foreignRateMissing ? 'Enter an exchange rate first' : undefined} style="height:34px; padding:0 14px; background:var(--primary); color:var(--primary-foreground); border:none; border-radius:8px; font-family:inherit; font-size:13px; font-weight:500; cursor:pointer; opacity:{foreignRateMissing ? 0.5 : 1};">
						Record income
					</button>
				</div>
			</form>
		</Sheet.Content>
	</Sheet.Portal>
</Sheet.Root>
