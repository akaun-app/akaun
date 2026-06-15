<script lang="ts">
	import { enhance } from '$app/forms';
	import { onMount, onDestroy } from 'svelte';
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
		Upload
	} from '@lucide/svelte';
	import * as Sheet from '$lib/components/ui/sheet/index.js';
	import FilterDropdown from '$lib/components/ui/FilterDropdown.svelte';
	import DatePicker from '$lib/components/ui/date-picker/DatePicker.svelte';
	import { formatMoney, formatMoneyRM, formatDate, formatDateShort } from '$lib/format.js';
	import type { PageData, ActionData } from './$types.js';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// Local reactive list — updated by SSE events and re-synced when SvelteKit reloads SSR data
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
	let selected = $state(new Set<number>());
	let incomeDrag = $state(false);
	let incomeFileInput = $state<HTMLInputElement | null>(null);
	let newIncomeFiles = $state<File[]>([]);
	let newIncomeDrag = $state(false);
	let newIncomeFileInput = $state<HTMLInputElement | null>(null);

	// Debounce search
	$effect(() => {
		const raw = searchRaw;
		const t = setTimeout(() => (search = raw), 300);
		return () => clearTimeout(t);
	});

	$effect(() => {
		if (form?.success) showNew = false;
	});
	$effect(() => { if (!showNew) newIncomeFiles = []; });

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
		if (mn != null) list = list.filter((i) => i.amount >= mn);
		if (mx != null) list = list.filter((i) => i.amount <= mx);
		if (dateFrom) list = list.filter((i) => i.date >= dateFrom);
		if (dateTo) list = list.filter((i) => i.date <= dateTo);
		if (search.trim()) {
			const q = search.toLowerCase();
			list = list.filter(
				(i) =>
					i.source.toLowerCase().includes(q) ||
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
		filtered.filter((i) => selected.has(i.id)).reduce((s, i) => s + i.amount, 0)
	);
	const filteredTotal = $derived(filtered.reduce((s, i) => s + i.amount, 0));
	const allSelected = $derived(filtered.length > 0 && selected.size === filtered.length);
	const someSelected = $derived(selected.size > 0 && selected.size < filtered.length);
	const activeFilterCount = $derived(
		selectedCats.length + (dateFrom || dateTo ? 1 : 0) + (amountMin || amountMax ? 1 : 0)
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
			thisMonth: incomes.filter((i) => i.date.startsWith(monthKey)).reduce((s, i) => s + i.amount, 0),
			thisQuarter: incomes.filter((i) => i.date >= qStart).reduce((s, i) => s + i.amount, 0),
			largest: incomes.length > 0 ? Math.max(...incomes.map((i) => i.amount)) : 0,
			allTotal: incomes.reduce((s, i) => s + i.amount, 0),
			count: incomes.length,
		};
	});

	// SSE — real-time updates from server
	let _es: EventSource | null = null;
	onMount(() => {
		_es = new EventSource('/api/income/stream');
		_es.onmessage = (e) => {
			const msg = JSON.parse(e.data);
			if (msg.type === 'income-update') mergeIncomes([msg.item]);
			else if (msg.type === 'income-delete') incomes = incomes.filter((i) => i.id !== msg.id);
		};
	});
	onDestroy(() => _es?.close());

	function mergeIncomes(incoming: typeof data.incomes) {
		const byId = new Map(incoming.map((i) => [i.id, i]));
		const existingIds = new Set(incomes.map((i) => i.id));
		incomes = incomes.map((local) => byId.get(local.id) ?? local);
		const brandNew = incoming.filter((i) => !existingIds.has(i.id));
		if (brandNew.length > 0) incomes = [...brandNew, ...incomes];
	}

	async function openIncome(inc: (typeof data.incomes)[0]) {
		detailIncome = { ...inc, attachments: [] };
		const res = await fetch(`/api/income/${inc.id}`);
		if (res.ok) detailIncome = await res.json();
	}

	async function uploadIncomeFiles(files: FileList) {
		if (!detailIncome) return;
		for (const file of Array.from(files)) {
			const fd = new FormData();
			fd.append('file', file);
			const res = await fetch(`/api/income/${detailIncome.id}/attachments`, { method: 'POST', body: fd });
			if (res.ok) {
				const att: Attachment = await res.json();
				detailIncome = { ...detailIncome, attachments: [...detailIncome.attachments, att] };
			}
		}
	}

	async function deleteIncomeAttachment(attachmentId: number) {
		if (!detailIncome) return;
		await fetch(`/api/income/${detailIncome.id}/attachments/${attachmentId}`, { method: 'DELETE' });
		detailIncome = { ...detailIncome, attachments: detailIncome.attachments.filter((a) => a.id !== attachmentId) };
	}

	function handleIncomeDrop(e: DragEvent) {
		e.preventDefault(); incomeDrag = false;
		if (e.dataTransfer?.files) uploadIncomeFiles(e.dataTransfer.files);
	}
	function handleIncomeFileInput(e: Event) {
		const input = e.target as HTMLInputElement;
		if (input.files) uploadIncomeFiles(input.files);
		input.value = '';
	}
</script>

<svelte:head>
	<title>Income - Akaun</title>
</svelte:head>

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
					<input
						type="search"
						placeholder="Search source, reference…"
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
		<div class="stat-card tone-green">
			<div class="stat-label">This month</div>
			<div class="stat-value"><span class="stat-cur">+RM</span>{formatMoney(stats.thisMonth)}</div>
		</div>
		<div class="stat-card">
			<div class="stat-label">This quarter</div>
			<div class="stat-value"><span class="stat-cur">+RM</span>{formatMoney(stats.thisQuarter)}</div>
		</div>
		<div class="stat-card">
			<div class="stat-label">Largest payment</div>
			<div class="stat-value"><span class="stat-cur">+RM</span>{formatMoney(stats.largest)}</div>
		</div>
		<div class="stat-card tone-green">
			<div class="stat-label">All received</div>
			<div class="stat-value"><span class="stat-cur">+RM</span>{formatMoney(stats.allTotal)}</div>
		</div>
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
							<th class={`sortable ${sort.key === 'source' ? 'sorted' : ''}`} onclick={() => onSort('source')} style="cursor:pointer; user-select:none;">
								<span class="th-inner">Source {sort.key === 'source' ? (sort.dir === 'asc' ? '↑' : '↓') : ''}</span>
							</th>
							<th class="sortable" onclick={() => onSort('category')} style="cursor:pointer; user-select:none;">
								<span class="th-inner">Category {sort.key === 'category' ? (sort.dir === 'asc' ? '↑' : '↓') : ''}</span>
							</th>
							<th>Reference</th>
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
										<span class="cell-itemname">{inc.source}</span>
										<span class="cell-itemnum">{inc.incomeNumber}</span>
									</div>
								</td>
								<td data-label="Category">
									<span style="display:inline-flex; align-items:center; font-size:11.5px; background:var(--secondary); color:var(--secondary-foreground); padding:2px 9px; border-radius:999px; white-space:nowrap;">
										{inc.category}
									</span>
								</td>
								<td data-label="Reference" style="color:var(--muted-foreground); font-size:13px;">{inc.reference || '—'}</td>
								<td class="td-date" data-label="Date">
									{formatDateShort(inc.date)}<span class="td-year">{inc.date.slice(0, 4)}</span>
								</td>
								<td class="td-amount" data-label="Amount">
									<span class="amount-num" style="color:var(--green);">+RM {formatMoney(inc.amount)}</span>
								</td>
							</tr>
						{/each}
						{#if stats.count === 0}
							<tr class="empty-row">
								<td colspan="6">
									<div class="empty">
										<div class="empty-icon"><TrendingUp size={20} /></div>
										<div class="empty-title">No income recorded yet</div>
										<div class="empty-sub">Record your first income entry to get started</div>
										<button
											onclick={() => (showNew = true)}
											style="display:inline-flex; align-items:center; gap:6px; height:32px; padding:0 14px; background:var(--primary); color:var(--primary-foreground); border:none; border-radius:8px; font-family:inherit; font-size:13px; font-weight:500; cursor:pointer;"
										>
											<Plus size={14} /> Record income
										</button>
									</div>
								</td>
							</tr>
						{:else if filtered.length === 0}
							<tr class="empty-row">
								<td colspan="6">
									<div class="empty">
										<div class="empty-icon"><Search size={20} /></div>
										<div class="empty-title">No income matches these filters</div>
										<button class="link-btn" onclick={clearAllFilters}>Clear filters</button>
									</div>
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
	<div class="bulkbar" class:show={selected.size > 0}>
		<div class="bulkbar-inner">
			<button class="bulk-close" onclick={clearSel} aria-label="Clear selection"><X size={16} /></button>
			<span class="bulk-count"><b>{selected.size}</b> selected</span>
			<span class="bulk-total">· <span class="num">+RM {formatMoney(selTotal)}</span></span>
			<div class="bulk-actions">
				<button class="bulk-actions-ghost" onclick={clearSel} style="padding:5px 10px; border-radius:6px; font-family:inherit; font-size:13px; cursor:pointer;">
					Deselect all
				</button>
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
<Sheet.Root open={!!detailIncome} onOpenChange={(o) => { if (!o) detailIncome = null; }}>
	<Sheet.Portal>
		<Sheet.Overlay />
		<Sheet.Content side="right" style="width:460px; max-width:95vw; display:flex; flex-direction:column; overflow:hidden;">
			{#if detailIncome}
				<div style="display:flex; align-items:flex-start; justify-content:space-between; padding:22px 22px 16px; border-bottom:1px solid var(--border);">
					<div>
						<div class="sheet-eyebrow">{detailIncome.incomeNumber}</div>
						<div class="sheet-title-text">{detailIncome.source}</div>
					</div>
					<div style="display:flex; align-items:center; gap:8px;">
						<span class="statusbadge tone-green"><span class="statusdot"></span>Received</span>
						<Sheet.Close class="sheet-close">
							<X size={16} />
						</Sheet.Close>
					</div>
				</div>
				<div style="flex:1; overflow-y:auto; padding:20px 22px;">
					<div class="detail-amount">
						<span class="detail-amount-cur">RM</span>
						<span class="detail-amount-val inc">+{formatMoney(detailIncome.amount)}</span>
					</div>
					<div class="detail-list">
						<div class="detail-row">
							<div class="detail-key">Source</div>
							<div class="detail-val">{detailIncome.source}</div>
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
					<div class="attach-section-header">
						<div class="detail-section-label" style="margin:0;">Attachments</div>
						<button type="button" class="attach-add-btn" onclick={() => incomeFileInput?.click()}>
							<Plus size={11} /> Add
						</button>
					</div>
					<div
						class="attach-drop-area"
						class:drag={incomeDrag}
						ondragover={(e) => { e.preventDefault(); incomeDrag = true; }}
						ondragleave={() => (incomeDrag = false)}
						ondrop={handleIncomeDrop}
					>
						{#if detailIncome.attachments.length > 0}
							<div class="attach-list">
								{#each detailIncome.attachments as att (att.id)}
									<div class="attach-item">
										<div class="attach-thumb"><Paperclip size={14} /></div>
										<div class="attach-meta">
											<a href="/api/files/{att.filename}" target="_blank" rel="noopener" class="attach-name attach-link">{att.displayName}</a>
											<div class="attach-sub">{att.addedDate}</div>
										</div>
										<button type="button" class="attach-del" onclick={() => deleteIncomeAttachment(att.id)}>
											<X size={14} />
										</button>
									</div>
								{/each}
							</div>
						{:else}
							<div class="attach-empty attach-empty-drop" onclick={() => incomeFileInput?.click()}>
								<Paperclip size={14} /> Drop files here or click to add
							</div>
						{/if}
					</div>
					<input bind:this={incomeFileInput} type="file" accept=".pdf,.jpg,.jpeg,.png"
						multiple style="display:none" onchange={handleIncomeFileInput} />
				</div>
			{/if}
		</Sheet.Content>
	</Sheet.Portal>
</Sheet.Root>

<!-- New income sheet -->
<Sheet.Root bind:open={showNew}>
	<Sheet.Portal>
		<Sheet.Overlay />
		<Sheet.Content side="right" style="width:460px; max-width:95vw; display:flex; flex-direction:column; overflow:hidden;">
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
					<label class="field-label" for="source">Source *</label>
					<input id="source" name="source" type="text" required placeholder="e.g. ACME Corp" style="width:100%; height:36px; border:1px solid var(--input); background:var(--card); color:var(--foreground); border-radius:8px; padding:0 12px; font-family:inherit; font-size:13.5px; outline:none;" />
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
					<label class="field-label" for="category">Category</label>
					<select id="category" name="category" style="appearance:none; width:100%; height:36px; border:1px solid var(--input); background:var(--card); color:var(--foreground); border-radius:8px; padding:0 12px; font-family:inherit; font-size:13.5px; outline:none; cursor:pointer;">
						{#each data.categories as cat}
							<option value={cat}>{cat}</option>
						{/each}
					</select>
				</div>

				<div class="field">
					<label class="field-label" for="reference">Reference</label>
					<input id="reference" name="reference" type="text" placeholder="e.g. INV-001" style="width:100%; height:36px; border:1px solid var(--input); background:var(--card); color:var(--foreground); border-radius:8px; padding:0 12px; font-family:inherit; font-size:13.5px; outline:none;" />
				</div>

				<div class="field">
					<label class="field-label" for="descriptionText">Description</label>
					<textarea id="descriptionText" name="descriptionText" placeholder="Optional notes…" style="width:100%; min-height:72px; border:1px solid var(--input); background:var(--card); color:var(--foreground); border-radius:8px; padding:8px 12px; font-family:inherit; font-size:13.5px; outline:none; resize:vertical; line-height:1.5;"></textarea>
				</div>

				<div class="field">
					<label class="field-label">Attachments <span style="font-weight:400; color:var(--muted-foreground);">optional</span></label>
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
						ondragover={(e) => { e.preventDefault(); newIncomeDrag = true; }}
						ondragleave={() => (newIncomeDrag = false)}
						ondrop={(e) => { e.preventDefault(); newIncomeDrag = false; if (e.dataTransfer?.files) newIncomeFiles = [...newIncomeFiles, ...Array.from(e.dataTransfer.files)]; }}
						onclick={() => newIncomeFileInput?.click()}
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
					<button type="submit" style="height:34px; padding:0 14px; background:var(--primary); color:var(--primary-foreground); border:none; border-radius:8px; font-family:inherit; font-size:13px; font-weight:500; cursor:pointer;">
						Record income
					</button>
				</div>
			</form>
		</Sheet.Content>
	</Sheet.Portal>
</Sheet.Root>
