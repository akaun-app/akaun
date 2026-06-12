<script lang="ts">
	import { enhance } from '$app/forms';
	import {
		TrendingUp,
		Plus,
		Search,
		Tag,
		Calendar,
		SlidersHorizontal,
		X,
		Paperclip
	} from '@lucide/svelte';
	import * as Sheet from '$lib/components/ui/sheet/index.js';
	import FilterDropdown from '$lib/components/ui/FilterDropdown.svelte';
	import { formatMoney, formatMoneyRM, formatDate, formatDateShort } from '$lib/format.js';
	import type { PageData, ActionData } from './$types.js';

	let { data, form }: { data: PageData; form: ActionData } = $props();

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
	let detailIncome = $state<(typeof data.incomes)[0] | null>(null);
	let selected = $state(new Set<number>());

	// Debounce search
	$effect(() => {
		const raw = searchRaw;
		const t = setTimeout(() => (search = raw), 300);
		return () => clearTimeout(t);
	});

	$effect(() => {
		if (form?.success) showNew = false;
	});

	function toggleCat(cat: string) {
		selectedCats = selectedCats.includes(cat)
			? selectedCats.filter((c) => c !== cat)
			: [...selectedCats, cat];
	}

	// Filtered + sorted list
	const filtered = $derived.by(() => {
		let list = data.incomes.slice();
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
</script>

<div class="screen" style="position:relative;">
	<!-- Top bar -->
	<header class="topbar">
		<div class="topbar-left">
			<h1 class="page-title">Income</h1>
			<p class="page-sub">
				{data.stats.count} records · <span class="num">+{formatMoneyRM(data.stats.allTotal)}</span> total
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
			<button
				onclick={() => (showNew = true)}
				style="display:inline-flex; align-items:center; gap:6px; height:32px; padding:0 12px; background:var(--primary); color:var(--primary-foreground); border:none; border-radius:8px; font-family:inherit; font-size:13px; font-weight:500; cursor:pointer;"
			>
				<Plus size={15} /> Record income
			</button>
		</div>
	</header>

	<!-- Stat strip -->
	<div class="stat-strip">
		<div class="stat-card tone-green">
			<div class="stat-label">This month</div>
			<div class="stat-value"><span class="stat-cur">+RM</span>{formatMoney(data.stats.thisMonth)}</div>
		</div>
		<div class="stat-card">
			<div class="stat-label">This quarter</div>
			<div class="stat-value"><span class="stat-cur">+RM</span>{formatMoney(data.stats.thisQuarter)}</div>
		</div>
		<div class="stat-card">
			<div class="stat-label">Largest payment</div>
			<div class="stat-value"><span class="stat-cur">+RM</span>{formatMoney(data.stats.largest)}</div>
		</div>
		<div class="stat-card tone-green">
			<div class="stat-label">All received</div>
			<div class="stat-value"><span class="stat-cur">+RM</span>{formatMoney(data.stats.allTotal)}</div>
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
				<div class="toolbar-filters">
					<FilterDropdown label="Category" active={selectedCats.length > 0} count={selectedCats.length}>
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

					<FilterDropdown label="Date" active={!!(dateFrom || dateTo)} count={dateFrom || dateTo ? 1 : 0}>
						{#snippet icon()}<Calendar size={14} />{/snippet}
						<div style="padding:12px 14px;">
							<div style="font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.04em; color:var(--muted-foreground); margin-bottom:10px;">Date range</div>
							<div style="display:flex; flex-direction:column; gap:8px;">
								<label style="font-size:11.5px; color:var(--muted-foreground);">From</label>
								<input type="date" bind:value={dateFrom} style="height:34px; border:1px solid var(--input); background:var(--card); color:var(--foreground); border-radius:8px; padding:0 10px; font-family:inherit; font-size:13px; outline:none;" />
								<label style="font-size:11.5px; color:var(--muted-foreground);">To</label>
								<input type="date" bind:value={dateTo} style="height:34px; border:1px solid var(--input); background:var(--card); color:var(--foreground); border-radius:8px; padding:0 10px; font-family:inherit; font-size:13px; outline:none;" />
							</div>
						</div>
					</FilterDropdown>

					<FilterDropdown label="Amount" active={!!(amountMin || amountMax)} count={amountMin || amountMax ? 1 : 0} align="right">
						{#snippet icon()}<SlidersHorizontal size={14} />{/snippet}
						<div style="padding:12px 14px; min-width:240px;">
							<div style="font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.04em; color:var(--muted-foreground); margin-bottom:10px;">Amount range</div>
							<div style="display:flex; align-items:center; gap:8px;">
								<div class="amount-input" style="flex:1;">
									<span class="amount-prefix">RM</span>
									<input class="amount-field" inputmode="decimal" placeholder="Min" bind:value={amountMin} />
								</div>
								<span style="color:var(--muted-foreground);">–</span>
								<div class="amount-input" style="flex:1;">
									<span class="amount-prefix">RM</span>
									<input class="amount-field" inputmode="decimal" placeholder="Max" bind:value={amountMax} />
								</div>
							</div>
						</div>
					</FilterDropdown>

					{#if activeFilterCount > 0}
						<button class="clear-filters" onclick={clearAllFilters}>
							<X size={13} /> Clear
						</button>
					{/if}
				</div>
			</div>

			<!-- Result meta -->
			<div class="result-meta">
				<span>Showing <b>{filtered.length}</b> of {data.stats.count}</span>
				<span class="result-total">Filtered total <b class="num">+{formatMoneyRM(filteredTotal)}</b></span>
			</div>

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
								onclick={() => (detailIncome = inc)}
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
								<td>
									<div class="cell-item">
										<span class="cell-itemname">{inc.source}</span>
										<span class="cell-itemnum">{inc.incomeNumber}</span>
									</div>
								</td>
								<td>
									<span style="display:inline-flex; align-items:center; font-size:11.5px; background:var(--secondary); color:var(--secondary-foreground); padding:2px 9px; border-radius:999px; white-space:nowrap;">
										{inc.category}
									</span>
								</td>
								<td style="color:var(--muted-foreground); font-size:13px;">{inc.reference || '—'}</td>
								<td class="td-date">
									{formatDateShort(inc.date)}<span class="td-year">{inc.date.slice(0, 4)}</span>
								</td>
								<td class="td-amount">
									<span class="amount-num" style="color:var(--green);">+RM {formatMoney(inc.amount)}</span>
								</td>
							</tr>
						{/each}
						{#if data.stats.count === 0}
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
				<span>{filtered.length} of {data.stats.count} records</span>
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
					<div class="detail-section-label">Attachments</div>
					<div class="attach-empty">
						<Paperclip size={14} /> No attachments
					</div>
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
				use:enhance
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
						<input id="date" name="date" type="date" value={today} required style="width:100%; height:36px; border:1px solid var(--input); background:var(--card); color:var(--foreground); border-radius:8px; padding:0 12px; font-family:inherit; font-size:13.5px; outline:none;" />
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
