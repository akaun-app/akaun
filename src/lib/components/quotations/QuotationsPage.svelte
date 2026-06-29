<script lang="ts">
	import { enhance } from '$app/forms';
	import { useIsMobile } from '$lib/hooks/useIsMobile.svelte.js';
	import { createResourceStream, mergeById } from '$lib/sse.js';
	import { fly } from 'svelte/transition';
	import {
		Search,
		Plus,
		Calendar,
		SlidersHorizontal,
		X,
		FileText,
		Trash2,
		Printer,
		ChevronRight,
		Receipt
	} from '@lucide/svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
	import StatCard from '$lib/components/ui/StatCard.svelte';
	import FilterDropdown from '$lib/components/ui/FilterDropdown.svelte';
	import ContactSelect from '$lib/components/ui/ContactSelect.svelte';
	import LineItemEditor from '$lib/components/ui/LineItemEditor.svelte';
	import * as Sheet from '$lib/components/ui/sheet/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import DatePicker from '$lib/components/ui/date-picker/DatePicker.svelte';
	import { formatMoney, formatMoneyRM, formatDate, formatDateShort } from '$lib/format.js';
	import { mainCurrency, mainCurrencySymbol } from '$lib/currency-state.svelte.js';
	import { CURRENCIES, formatCurrencyAmount } from '$lib/currency.js';
	import { QuotationStatus, QuotationStatusLabels, Role, EntityType } from '$lib/enums.js';
	import { goto, pushState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import type { loadQuotationsPage } from '$lib/server/loaders/quotations.js';

	type PageData = ReturnType<typeof loadQuotationsPage>;
	type ActionData = { error?: string; success?: boolean } | null;

	let {
		data,
		form,
		openId
	}: { data: PageData; form: ActionData; openId: number | null } = $props();

	// Status tab id → QuotationStatus INT code
	const STATUS_CODE: Record<string, number> = {
		draft: QuotationStatus.Draft,
		sent: QuotationStatus.Sent,
		accepted: QuotationStatus.Accepted,
		declined: QuotationStatus.Declined,
		converted: QuotationStatus.Converted
	};

	// Local reactive list — updated by SSE events and re-synced on SvelteKit data reload
	// svelte-ignore state_referenced_locally
	let quotations = $state(data.quotations);
	$effect(() => {
		quotations = data.quotations;
	});

	// --- State ---
	let searchRaw = $state('');
	let search = $state('');
	let statusTab = $state('all');
	let dateFrom = $state('');
	let dateTo = $state('');
	let sort = $state({ key: 'issueDate', dir: 'desc' as 'asc' | 'desc' });
	let mobileFilterOpen = $state(false);
	let mobileSearchOpen = $state(false);
	let mobileSearchEl = $state<HTMLInputElement | null>(null);
	$effect(() => {
		if (mobileSearchOpen && mobileSearchEl) mobileSearchEl.focus();
	});

	// Detail state
	type QuotationLine = {
		id: number;
		quotationId: number;
		description: string;
		quantity: number;
		unitPrice: number;
		lineTotal: number;
		sortOrder: number;
	};
	type FullQuotation = (typeof data.quotations)[0] & { lines: QuotationLine[] };

	let detailQuotation = $state<FullQuotation | null>(null);
	let isEditing = $state(false);
	let deleteDialogOpen = $state(false);
	let deleteFormEl = $state<HTMLFormElement | null>(null);
	let saving = $state(false);
	let saveError = $state('');

	// Edit form state
	type LineInput = { description: string; quantity: number; unitPrice: number };
	let editIssueDate = $state('');
	let editExpiryDate = $state('');
	let editContactId = $state<number | null>(null);
	let editContactName = $state<string | null>(null);
	let editCurrency = $state(mainCurrency());
	let editExchangeRate = $state('1');
	let editNotes = $state('');
	let editTerms = $state('');
	let editReference = $state('');
	let editLines = $state<LineInput[]>([]);

	// Create form state
	const todayISO = () => new Date().toISOString().slice(0, 10);
	let showNew = $state(false);
	let newIssueDate = $state(todayISO());
	let newExpiryDate = $state('');
	let newContactId = $state<number | null>(null);
	let newContactName = $state<string | null>(null);
	let newCurrency = $state(mainCurrency());
	let newExchangeRate = $state('1');
	let newNotes = $state('');
	let newTerms = $state('');
	let newReference = $state('');
	let newLines = $state<LineInput[]>([{ description: '', quantity: 1, unitPrice: 0 }]);
	let newSaving = $state(false);
	let newError = $state('');
	let newRateFetching = $state(false);
	let newRateError = $state('');

	// Mobile panel detection
	const screen = useIsMobile();
	const isMobile = $derived(screen.current);
	const panelSide = $derived(isMobile ? 'bottom' : 'right');

	// Debounced search
	$effect(() => {
		const v = searchRaw;
		const t = setTimeout(() => (search = v), 300);
		return () => clearTimeout(t);
	});

	// Reset new form on close
	$effect(() => {
		if (!showNew) {
			newIssueDate = todayISO();
			newExpiryDate = '';
			newContactId = null;
			newContactName = null;
			newCurrency = mainCurrency();
			newExchangeRate = '1';
			newNotes = '';
			newTerms = '';
			newReference = '';
			newLines = [{ description: '', quantity: 1, unitPrice: 0 }];
			newError = '';
		}
	});

	// Auto-fetch exchange rate for the new form when currency or date changes
	$effect(() => {
		const cur = newCurrency;
		const d = newIssueDate;
		if (cur === mainCurrency() || !d) { newExchangeRate = '1'; newRateError = ''; return; }
		newRateFetching = true;
		newRateError = '';
		const t = setTimeout(async () => {
			try {
				const res = await fetch(`/api/exchange-rate?from=${cur}&to=${mainCurrency()}&date=${d}`);
				const json = await res.json();
				if (json.rate != null) newExchangeRate = String(json.rate);
				else { newRateError = 'No rate found — enter manually'; }
			} catch {
				newRateError = 'Could not fetch rate — enter manually';
			} finally {
				newRateFetching = false;
			}
		}, 400);
		return () => clearTimeout(t);
	});

	// SSE — real-time updates from server
	type QuotationStreamMsg =
		| { type: 'quotation-update'; item: (typeof data.quotations)[0] }
		| { type: 'quotation-delete'; id: number };

	// Derived counts (from local state for real-time accuracy)
	const counts = $derived.by(() => ({
		all: quotations.length,
		draft: quotations.filter((q) => q.status === QuotationStatus.Draft).length,
		sent: quotations.filter((q) => q.status === QuotationStatus.Sent).length,
		accepted: quotations.filter((q) => q.status === QuotationStatus.Accepted).length,
		declined: quotations.filter((q) => q.status === QuotationStatus.Declined).length,
		converted: quotations.filter((q) => q.status === QuotationStatus.Converted).length,
		expired: quotations.filter((q) => q.isExpired).length
	}));

	// Stats
	const stats = $derived.by(() => {
		const accepted = quotations.filter((q) => q.status === QuotationStatus.Accepted);
		const sent = quotations.filter((q) => q.status === QuotationStatus.Sent);
		const now = new Date();
		const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
		const thisMonth = quotations.filter((q) => q.issueDate.startsWith(monthKey));
		return {
			acceptedTotal: accepted.reduce((s, q) => s + q.mainAmount, 0),
			acceptedCount: accepted.length,
			sentTotal: sent.reduce((s, q) => s + q.mainAmount, 0),
			sentCount: sent.length,
			monthTotal: thisMonth.reduce((s, q) => s + q.mainAmount, 0),
			monthCount: thisMonth.length,
			allTotal: quotations.reduce((s, q) => s + q.mainAmount, 0)
		};
	});

	// Filtered + sorted list
	const filtered = $derived.by(() => {
		let rows = quotations.slice();
		if (statusTab === 'expired') {
			rows = rows.filter((q) => q.isExpired);
		} else if (statusTab !== 'all') {
			rows = rows.filter((q) => q.status === STATUS_CODE[statusTab]);
		}
		if (dateFrom) rows = rows.filter((q) => q.issueDate >= dateFrom);
		if (dateTo) rows = rows.filter((q) => q.issueDate <= dateTo);
		if (search.trim()) {
			const s = search.toLowerCase();
			rows = rows.filter(
				(q) =>
					q.quotationNumber.toLowerCase().includes(s) ||
					(q.contactName ?? '').toLowerCase().includes(s) ||
					(q.reference ?? '').toLowerCase().includes(s)
			);
		}
		rows.sort((a, b) => {
			const ak = sort.key as keyof typeof a;
			const av = (a[ak] ?? '') as string | number;
			const bv = (b[ak] ?? '') as string | number;
			let cmp = av < bv ? -1 : av > bv ? 1 : 0;
			if (cmp === 0) cmp = a.id - b.id;
			return sort.dir === 'asc' ? cmp : -cmp;
		});
		return rows;
	});

	const filteredTotal = $derived(filtered.reduce((s, q) => s + q.mainAmount, 0));
	const activeFilterCount = $derived((dateFrom || dateTo ? 1 : 0) + (search.trim() ? 1 : 0));

	function onSort(key: string) {
		if (sort.key === key) {
			sort = { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' };
		} else {
			sort = { key, dir: key === 'issueDate' || key === 'mainAmount' ? 'desc' : 'asc' };
		}
	}

	function clearAllFilters() {
		dateFrom = '';
		dateTo = '';
		searchRaw = '';
		statusTab = 'all';
	}

	// Derive the display status label — 'expired' overrides stored status for Draft/Sent
	function getStatusLabel(q: { status: number; isExpired: boolean }): string {
		if (
			q.isExpired &&
			(q.status === QuotationStatus.Draft || q.status === QuotationStatus.Sent)
		) {
			return 'expired';
		}
		return QuotationStatusLabels[q.status];
	}

	// Editing is allowed unless converted
	function canEdit(q: { status: number }): boolean {
		return q.status !== QuotationStatus.Converted;
	}

	// Deep-link: open a quotation detail sheet
	async function openQuotation(q: (typeof data.quotations)[0], { push = true } = {}) {
		detailQuotation = { ...q, lines: [] };
		isEditing = false;
		if (push) {
			pushState(resolve('/(app)/quotations/[id]', { id: String(q.id) }), { viaPush: true });
		}
		const res = await fetch(`/api/quotations/${q.id}`);
		if (res.ok) detailQuotation = await res.json();
	}

	function closeQuotation() {
		detailQuotation = null;
		isEditing = false;
		if (page.state.viaPush) {
			history.back();
		} else {
			goto(resolve('/quotations'), { replaceState: true, noScroll: true });
		}
	}

	// Enter edit mode — populate edit fields from current detail
	function startEdit() {
		if (!detailQuotation) return;
		editIssueDate = detailQuotation.issueDate;
		editExpiryDate = detailQuotation.expiryDate ?? '';
		editContactId = detailQuotation.contactId;
		editContactName = null;
		editCurrency = detailQuotation.currency;
		editExchangeRate = String(detailQuotation.exchangeRate);
		editNotes = detailQuotation.notes ?? '';
		editTerms = detailQuotation.terms ?? '';
		editReference = detailQuotation.reference ?? '';
		editLines = detailQuotation.lines.map((l) => ({
			description: l.description,
			quantity: l.quantity,
			unitPrice: l.unitPrice
		}));
		saveError = '';
		isEditing = true;
	}

	async function saveEdit() {
		if (!detailQuotation) return;
		saving = true;
		saveError = '';
		try {
			// If user typed a new contact name, create the contact first
			let resolvedContactId = editContactId;
			if (!resolvedContactId && editContactName) {
				const cr = await fetch('/api/contacts', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ entityType: EntityType.Business, legalName: editContactName, roles: [Role.Customer] })
				});
				if (!cr.ok) { saveError = 'Failed to create contact — try again'; saving = false; return; }
				resolvedContactId = (await cr.json()).id;
			}
			const res = await fetch(`/api/quotations/${detailQuotation.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					issueDate: editIssueDate,
					expiryDate: editExpiryDate || null,
					contactId: resolvedContactId,
					currency: editCurrency,
					exchangeRate: parseFloat(editExchangeRate) || 1,
					notes: editNotes || null,
					terms: editTerms || null,
					reference: editReference || null,
					lines: editLines
				})
			});
			if (!res.ok) {
				const err = await res.json();
				saveError = err.error ?? 'Save failed';
			} else {
				detailQuotation = await res.json();
				isEditing = false;
			}
		} catch {
			saveError = 'Network error — try again';
		} finally {
			saving = false;
		}
	}

	// Create a new quotation via JSON API (line items can't be FormData)
	async function handleCreate() {
		if (!newContactId && !newContactName) {
			newError = 'Customer is required';
			return;
		}
		if (!newLines.some((l) => l.description.trim())) {
			newError = 'At least one line item with a description is required';
			return;
		}
		newSaving = true;
		newError = '';
		try {
			// If user typed a new contact name, create the contact first
			let resolvedContactId = newContactId;
			if (!resolvedContactId && newContactName) {
				const cr = await fetch('/api/contacts', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ entityType: EntityType.Business, legalName: newContactName, roles: [Role.Customer] })
				});
				if (!cr.ok) { newError = 'Failed to create contact — try again'; newSaving = false; return; }
				resolvedContactId = (await cr.json()).id;
			}
			const res = await fetch('/api/quotations', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					issueDate: newIssueDate,
					expiryDate: newExpiryDate || null,
					contactId: resolvedContactId,
					currency: newCurrency,
					exchangeRate: parseFloat(newExchangeRate) || 1,
					notes: newNotes || null,
					terms: newTerms || null,
					reference: newReference || null,
					lines: newLines
				})
			});
			if (!res.ok) {
				const err = await res.json();
				newError = err.error ?? 'Failed to create quotation';
			} else {
				showNew = false;
				// SSE will push the new item onto the list
			}
		} catch {
			newError = 'Network error — try again';
		} finally {
			newSaving = false;
		}
	}

	// Convert to invoice and navigate to the new invoice
	async function convertToInvoice(id: number) {
		const res = await fetch(`/api/quotations/${id}/convert`, { method: 'POST' });
		if (res.ok) {
			const json = await res.json();
			goto(resolve('/(app)/invoices/[id]', { id: String(json.invoice.id) }));
		}
	}

	createResourceStream<QuotationStreamMsg>('/api/quotations/stream', (msg) => {
		if (msg.type === 'quotation-update') quotations = mergeById(quotations, [msg.item]);
		else if (msg.type === 'quotation-delete')
			quotations = quotations.filter((q) => q.id !== msg.id);
	});

	onMount(() => {
		// Deep-link: open the quotation if openId was passed via direct navigation
		if (openId) {
			const found = quotations.find((q) => q.id === openId);
			if (found) openQuotation(found, { push: false });
		}
	});
</script>

<div class="screen" style="position:relative;">
	<!-- Top bar -->
	<header class="topbar">
		<div class="topbar-left">
			<h1 class="page-title">Quotations</h1>
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
						placeholder="Search QT#, customer, ref…"
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
						placeholder="Search QT#, customer, ref…"
						bind:value={searchRaw}
						bind:this={mobileSearchEl}
					/>
				</div>
			{/if}
			<button
				class="mobile-search-toggle"
				class:active={mobileSearchOpen}
				onclick={() => {
					mobileSearchOpen = !mobileSearchOpen;
					if (!mobileSearchOpen) searchRaw = '';
				}}
			>
				{#if mobileSearchOpen}<X size={16} />{:else}<Search size={16} />{/if}
			</button>
			<button
				onclick={() => (showNew = true)}
				style="display:inline-flex; align-items:center; gap:6px; height:32px; padding:0 12px; background:var(--primary); color:var(--primary-foreground); border:none; border-radius:8px; font-family:inherit; font-size:13px; font-weight:500; cursor:pointer;"
			>
				<Plus size={15} /> <span class="btn-text">New quotation</span>
			</button>
		</div>
	</header>

	<!-- Stat strip -->
	<div class="stat-strip">
		<StatCard
			tone="amber"
			label="Sent"
			cur={mainCurrencySymbol()}
			value={formatMoney(stats.sentTotal)}
			sub="{stats.sentCount} awaiting response"
		/>
		<StatCard
			tone="green"
			label="Accepted"
			cur={mainCurrencySymbol()}
			value={formatMoney(stats.acceptedTotal)}
			sub="{stats.acceptedCount} won"
		/>
		<StatCard
			label="This month"
			cur={mainCurrencySymbol()}
			value={formatMoney(stats.monthTotal)}
			sub="{stats.monthCount} issued"
		/>
		<StatCard
			label="All recorded"
			cur={mainCurrencySymbol()}
			value={formatMoney(stats.allTotal)}
			sub="{counts.all} quotations"
		/>
	</div>

	<div class="work">
		<div class="work-main layout-standard" style="padding-top:12px;">
			<!-- Toolbar -->
			<div class="toolbar">
				<div class="status-tabs">
					{#each [['all', 'All'], ['draft', 'Draft'], ['sent', 'Sent'], ['accepted', 'Accepted'], ['declined', 'Declined'], ['converted', 'Converted'], ['expired', 'Expired']] as [id, label]}
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
					<FilterDropdown label="Date" active={!!(dateFrom || dateTo)}>
						{#snippet icon()}<Calendar size={14} />{/snippet}
						<div style="padding:12px 14px;">
							<div
								style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;"
							>
								<div
									style="font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.04em; color:var(--muted-foreground);"
								>
									Date range
								</div>
								{#if dateFrom || dateTo}
									<button
										onclick={() => {
											dateFrom = '';
											dateTo = '';
										}}
										style="border:none; background:none; color:var(--primary); cursor:pointer; font-size:11px; font-weight:600; padding:0;"
										>Clear</button
									>
								{/if}
							</div>
							<div style="display:flex; flex-direction:column; gap:8px;">
								<span style="font-size:11.5px; color:var(--muted-foreground);">From</span>
								<DatePicker bind:value={dateFrom} placeholder="From date" />
								<span style="font-size:11.5px; color:var(--muted-foreground);">To</span>
								<DatePicker bind:value={dateTo} placeholder="To date" />
							</div>
						</div>
					</FilterDropdown>
				</div>
			</div>

			<!-- Result meta -->
			{#if filtered.length > 0 || activeFilterCount > 0}
				<div class="result-meta">
					<span>Showing <b>{filtered.length}</b> of {counts.all}</span>
					<span class="result-total"
						>Filtered total <b class="num">{formatMoneyRM(filteredTotal)}</b></span
					>
				</div>
			{/if}

			<!-- Table -->
			<div class="table-card">
				<table class="exp-table">
					<thead>
						<tr>
							<th
								class={`sortable ${sort.key === 'quotationNumber' ? 'sorted' : ''}`}
								onclick={() => onSort('quotationNumber')}
								style="cursor:pointer; user-select:none;"
							>
								<span class="th-inner"
									>Quotation {sort.key === 'quotationNumber'
										? sort.dir === 'asc'
											? '↑'
											: '↓'
										: ''}</span
								>
							</th>
							<th
								class={`sortable ${sort.key === 'status' ? 'sorted' : ''}`}
								onclick={() => onSort('status')}
								style="cursor:pointer; user-select:none;"
							>
								<span class="th-inner"
									>Status {sort.key === 'status'
										? sort.dir === 'asc'
											? '↑'
											: '↓'
										: ''}</span
								>
							</th>
							<th
								class={`sortable ${sort.key === 'issueDate' ? 'sorted' : ''}`}
								onclick={() => onSort('issueDate')}
								style="cursor:pointer; user-select:none;"
							>
								<span class="th-inner"
									>Date {sort.key === 'issueDate'
										? sort.dir === 'asc'
											? '↑'
											: '↓'
										: ''}</span
								>
							</th>
							<th onclick={() => onSort('expiryDate')} style="cursor:pointer; user-select:none;">
								<span class="th-inner"
									>Expires {sort.key === 'expiryDate'
										? sort.dir === 'asc'
											? '↑'
											: '↓'
										: ''}</span
								>
							</th>
							<th
								class={`sortable ta-right ${sort.key === 'mainAmount' ? 'sorted' : ''}`}
								onclick={() => onSort('mainAmount')}
								style="cursor:pointer; user-select:none;"
							>
								<span class="th-inner"
									>Amount {sort.key === 'mainAmount'
										? sort.dir === 'asc'
											? '↑'
											: '↓'
										: ''}</span
								>
							</th>
						</tr>
					</thead>
					<tbody>
						{#each filtered as q}
							<tr class="exp-row" onclick={() => openQuotation(q)}>
								<td class="td-primary">
									<div class="cell-item">
										<span class="cell-itemname">{q.contactName || '—'}</span>
										<span class="cell-itemnum">{q.quotationNumber}</span>
									</div>
								</td>
								<td class="td-status" data-label="Status">
									<StatusBadge status={getStatusLabel(q)} />
								</td>
								<td class="td-date" data-label="Date">
									{formatDateShort(q.issueDate)}<span class="td-year"
										>{q.issueDate.slice(0, 4)}</span
									>
								</td>
								<td class="td-date" data-label="Expires">
									{#if q.expiryDate}
										{formatDateShort(q.expiryDate)}<span class="td-year"
											>{q.expiryDate.slice(0, 4)}</span
										>
									{:else}
										<span style="color:var(--muted-foreground);">—</span>
									{/if}
								</td>
								<td class="td-amount" data-label="Amount">
									<span class="amount-num">{mainCurrencySymbol()} {formatMoney(q.mainAmount)}</span>
									{#if q.currency !== mainCurrency()}
										<span class="amount-orig"
											>{q.currency} {formatCurrencyAmount(q.total, q.currency)}</span
										>
									{/if}
								</td>
							</tr>
						{/each}
						{#if quotations.length === 0}
							<tr class="empty-row">
								<td colspan="5">
									<EmptyState
										title="No quotations yet"
										sub="Your quotations will appear here once created."
									>
										{#snippet icon()}<FileText size={20} />{/snippet}
									</EmptyState>
								</td>
							</tr>
						{:else if filtered.length === 0}
							<tr class="empty-row">
								<td colspan="5">
									<EmptyState
										title="No quotations match your filters"
										sub="Try adjusting your search or filters."
									>
										{#snippet icon()}<Search size={20} />{/snippet}
										{#snippet action()}
											<button class="link-btn" onclick={clearAllFilters}>Clear filters</button>
										{/snippet}
									</EmptyState>
								</td>
							</tr>
						{/if}
					</tbody>
				</table>
			</div>
			<div class="table-foot">
				<span>{filtered.length} of {counts.all} quotations</span>
				<span class="muted">Updated just now</span>
			</div>
		</div>
	</div>
</div>

<!-- Mobile filter sheet -->
<Sheet.Root bind:open={mobileFilterOpen}>
	<Sheet.Portal>
		<Sheet.Overlay />
		<Sheet.Content
			side="bottom"
			style="border-radius:16px 16px 0 0; max-height:85vh; overflow-y:auto; padding:20px 20px calc(20px + var(--safe-bottom));"
		>
			<div
				style="display:flex; align-items:center; justify-content:space-between; margin-bottom:16px;"
			>
				<div style="font-size:15px; font-weight:600;">Filters</div>
				<Sheet.Close class="sheet-close"><X size={16} /></Sheet.Close>
			</div>
			<div style="margin-bottom:16px;">
				<div
					style="font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.04em; color:var(--muted-foreground); margin-bottom:10px; display:flex; align-items:center; justify-content:space-between;"
				>
					<span>Date range</span>
					{#if dateFrom || dateTo}
						<button
							onclick={() => {
								dateFrom = '';
								dateTo = '';
							}}
							style="border:none; background:none; color:var(--primary); cursor:pointer; font-size:11px; font-weight:600;"
							>Clear</button
						>
					{/if}
				</div>
				<div style="display:flex; flex-direction:column; gap:8px;">
					<span style="font-size:11.5px; color:var(--muted-foreground);">From</span>
					<DatePicker bind:value={dateFrom} placeholder="From date" />
					<span style="font-size:11.5px; color:var(--muted-foreground);">To</span>
					<DatePicker bind:value={dateTo} placeholder="To date" />
				</div>
			</div>
			<Button class="w-full" onclick={() => (mobileFilterOpen = false)}>Show results</Button>
		</Sheet.Content>
	</Sheet.Portal>
</Sheet.Root>

<!-- Detail sheet -->
<Sheet.Root
	open={!!detailQuotation}
	onOpenChange={(o) => {
		if (!o) closeQuotation();
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
			{#if detailQuotation}
				<!-- Header -->
				<div
					style="display:flex; align-items:flex-start; justify-content:space-between; padding:22px 22px 16px; border-bottom:1px solid var(--border);"
				>
					<div>
						<div class="sheet-eyebrow">{detailQuotation.quotationNumber}</div>
						<div class="sheet-title-text">{detailQuotation.contactName || 'Quotation'}</div>
					</div>
					<Sheet.Close class="sheet-close">
						<X size={16} />
					</Sheet.Close>
				</div>

				{#if isEditing}
					<!-- Edit mode -->
					<div
						style="flex:1; overflow-y:auto; padding:20px 22px; display:flex; flex-direction:column; gap:0;"
					>
						{#if saveError}
							<div
								style="background:var(--red-soft); color:var(--red); border-radius:8px; padding:10px 14px; font-size:13px; margin-bottom:16px;"
							>
								{saveError}
							</div>
						{/if}

						<div class="field-grid field">
							<div>
								<label class="field-label" for="edit-issue-date">Issue Date *</label>
								<DatePicker name="editIssueDate" bind:value={editIssueDate} />
							</div>
							<div>
								<label class="field-label" for="edit-expiry-date">Expiry Date</label>
								<DatePicker name="editExpiryDate" bind:value={editExpiryDate} placeholder="No expiry" />
							</div>
						</div>

						<div class="field">
							<label class="field-label" for="edit-customer">Customer</label>
							<ContactSelect
								role={Role.Customer}
								bind:value={editContactId}
								bind:newName={editContactName}
								placeholder="Select customer…"
							/>
						</div>

						<div class="field-grid field">
							<div>
								<label class="field-label" for="editCurrency">Currency</label>
								<Select.Root type="single" bind:value={editCurrency}>
									<Select.Trigger id="editCurrency" class="w-full">{editCurrency}</Select.Trigger>
									<Select.Content>
										{#each CURRENCIES as c (c.code)}
											<Select.Item value={c.code} label={`${c.code} — ${c.name}`} />
										{/each}
									</Select.Content>
								</Select.Root>
							</div>
							{#if editCurrency !== mainCurrency()}
								<div>
									<label class="field-label" for="editRate"
										>Rate (1 {editCurrency} = ? {mainCurrency()})</label
									>
									<Input
										id="editRate"
										type="text"
										inputmode="decimal"
										placeholder="1.0"
										bind:value={editExchangeRate}
									/>
								</div>
							{/if}
						</div>

						<div class="field">
							<label class="field-label" for="editReference">Reference</label>
							<Input
								id="editReference"
								type="text"
								placeholder="Optional reference…"
								bind:value={editReference}
							/>
						</div>

						<div class="field">
							<div class="field-label">Line Items *</div>
							<LineItemEditor bind:lines={editLines} currency={editCurrency} />
						</div>

						<div class="field">
							<label class="field-label" for="editNotes">Notes</label>
							<Textarea
								id="editNotes"
								placeholder="Optional notes for the customer…"
								class="leading-relaxed"
								bind:value={editNotes}
							/>
						</div>

						<div class="field">
							<label class="field-label" for="editTerms">Terms &amp; Conditions</label>
							<Textarea
								id="editTerms"
								placeholder="Optional terms…"
								class="leading-relaxed"
								bind:value={editTerms}
							/>
						</div>
					</div>

					<div class="sheet-foot">
						<div class="sheet-foot-actions">
							<button
								type="button"
								class="sheet-btn sheet-btn-delete"
								disabled={detailQuotation.status === QuotationStatus.Converted}
								title={detailQuotation.status === QuotationStatus.Converted
									? 'Converted quotations cannot be deleted'
									: undefined}
								onclick={() => (deleteDialogOpen = true)}
							>
								<Trash2 size={14} /> Delete
							</button>
							<button
								type="button"
								class="sheet-btn"
								style="margin-left:auto;"
								onclick={() => {
									isEditing = false;
								}}
							>
								Cancel
							</button>
							<button
								type="button"
								class="sheet-btn sheet-btn-primary"
								onclick={saveEdit}
								disabled={saving}
							>
								{saving ? 'Saving…' : 'Save'}
							</button>
						</div>
					</div>
				{:else}
					<!-- View mode -->
					<div style="flex:1; overflow-y:auto; padding:20px 22px;">
						<div class="detail-amount">
							<span class="detail-amount-cur">{mainCurrencySymbol()}</span>
							<span class="detail-amount-val">{formatMoney(detailQuotation.mainAmount)}</span>
						</div>
						{#if detailQuotation.currency !== mainCurrency()}
							<div class="detail-orig">
								Original: {detailQuotation.currency}
								{formatCurrencyAmount(detailQuotation.total, detailQuotation.currency)} · rate {detailQuotation.exchangeRate}
							</div>
						{/if}
						<div class="detail-statusrow">
							<StatusBadge status={getStatusLabel(detailQuotation)} />
						</div>

						<div class="detail-list">
							{#if detailQuotation.contactName}
								<div class="detail-row">
									<div class="detail-key">Customer</div>
									<div class="detail-val">{detailQuotation.contactName}</div>
								</div>
							{/if}
							<div class="detail-row">
								<div class="detail-key">Issue Date</div>
								<div class="detail-val num">{formatDate(detailQuotation.issueDate)}</div>
							</div>
							{#if detailQuotation.expiryDate}
								<div class="detail-row">
									<div class="detail-key">Expiry Date</div>
									<div class="detail-val num">{formatDate(detailQuotation.expiryDate)}</div>
								</div>
							{/if}
							{#if detailQuotation.reference}
								<div class="detail-row">
									<div class="detail-key">Reference</div>
									<div class="detail-val num">{detailQuotation.reference}</div>
								</div>
							{/if}
							{#if detailQuotation.currency !== mainCurrency()}
								<div class="detail-row">
									<div class="detail-key">Currency</div>
									<div class="detail-val">
										{detailQuotation.currency} (rate: {detailQuotation.exchangeRate})
									</div>
								</div>
							{/if}
						</div>

						<!-- Linked invoice relation card -->
						{#if detailQuotation?.convertedInvoiceId}
							<button
								type="button"
								class="linked-invoice-card related-link"
								onclick={() => goto(resolve('/(app)/invoices/[id]', { id: String(detailQuotation!.convertedInvoiceId) }))}
							>
								<div class="linked-invoice-icon">
									<Receipt size={16} />
								</div>
								<div class="linked-invoice-body">
									<div class="linked-invoice-title">Invoice</div>
									<div class="linked-invoice-sub">Converted from this quotation</div>
								</div>
								<ChevronRight size={14} style="color:var(--muted-foreground); flex-shrink:0;" />
							</button>
						{/if}

						<!-- Line items (read-only) -->
						{#if detailQuotation.lines.length > 0}
							<div class="detail-section-label">Line Items</div>
							<div class="qt-lines">
								{#each detailQuotation.lines as line}
									<div class="qt-line">
										<div class="qt-line-desc">{line.description}</div>
										<div class="qt-line-meta">
											{line.quantity} × {formatCurrencyAmount(line.unitPrice, detailQuotation.currency)}
										</div>
										<div class="qt-line-total">
											{formatCurrencyAmount(line.lineTotal, detailQuotation.currency)}
										</div>
									</div>
								{/each}
								<div class="qt-lines-total">
									<span class="qt-lines-total-label">Total</span>
									<span class="qt-lines-total-val">
										{detailQuotation.currency}
										{formatCurrencyAmount(detailQuotation.total, detailQuotation.currency)}
									</span>
								</div>
							</div>
						{/if}

						{#if detailQuotation.notes}
							<div class="detail-list" style="margin-top:12px;">
								<div class="detail-row">
									<div class="detail-key">Notes</div>
									<div class="detail-val" style="white-space:pre-wrap;">
										{detailQuotation.notes}
									</div>
								</div>
							</div>
						{/if}
						{#if detailQuotation.terms}
							<div class="detail-list" style="margin-top:4px;">
								<div class="detail-row">
									<div class="detail-key">Terms</div>
									<div class="detail-val" style="white-space:pre-wrap;">
										{detailQuotation.terms}
									</div>
								</div>
							</div>
						{/if}
					</div>

					<div class="sheet-foot">
						<div class="sheet-foot-actions">
							<button
								type="button"
								class="sheet-btn sheet-btn-delete"
								disabled={detailQuotation.status === QuotationStatus.Converted}
								title={detailQuotation.status === QuotationStatus.Converted
									? 'Converted quotations cannot be deleted'
									: undefined}
								onclick={() => (deleteDialogOpen = true)}
							>
								<Trash2 size={14} /> Delete
							</button>
							<a
								href="/api/quotations/{detailQuotation.id}/pdf"
								target="_blank"
								class="sheet-btn"
								style="text-decoration:none;"
							>
								<Printer size={14} /> Print
							</a>
							{#if detailQuotation.status === QuotationStatus.Accepted}
								<button
									type="button"
									class="sheet-btn"
									onclick={() => convertToInvoice(detailQuotation!.id)}
								>
									<FileText size={14} /> Convert
								</button>
							{/if}
							{#if canEdit(detailQuotation)}
								<button
									type="button"
									class="sheet-btn sheet-btn-primary"
									onclick={startEdit}
								>
									Edit
								</button>
							{:else}
								<button
									type="button"
									class="sheet-btn"
									onclick={closeQuotation}
								>
									Close
								</button>
							{/if}
						</div>
					</div>
				{/if}
			{/if}
		</Sheet.Content>
	</Sheet.Portal>
</Sheet.Root>

{#if detailQuotation}
	<ConfirmDialog
		bind:open={deleteDialogOpen}
		title="Delete quotation?"
		description={`This will permanently delete ${detailQuotation.quotationNumber}. This can't be undone.`}
		confirmLabel="Delete"
		danger
		onConfirm={() => deleteFormEl?.requestSubmit()}
	/>
	<form
		method="POST"
		action="?/delete"
		bind:this={deleteFormEl}
		use:enhance={() =>
			async ({ result, update }) => {
				if (result.type === 'success') {
					deleteDialogOpen = false;
					closeQuotation();
				}
				await update();
			}}
		style="display:none"
	>
		<input type="hidden" name="id" value={detailQuotation.id} />
	</form>
{/if}

<!-- Create sheet -->
<Sheet.Root bind:open={showNew}>
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
					<div class="sheet-eyebrow">New</div>
					<div class="sheet-title-text">New quotation</div>
				</div>
				<Sheet.Close class="sheet-close">
					<X size={16} />
				</Sheet.Close>
			</div>

			<div
				style="flex:1; overflow-y:auto; padding:20px 22px; display:flex; flex-direction:column; gap:0;"
			>
				{#if newError}
					<div
						style="background:var(--red-soft); color:var(--red); border-radius:8px; padding:10px 14px; font-size:13px; margin-bottom:16px;"
					>
						{newError}
					</div>
				{/if}

				<div class="field-grid field">
					<div>
						<label class="field-label" for="new-issue-date">Issue Date *</label>
						<DatePicker name="newIssueDate" bind:value={newIssueDate} />
					</div>
					<div>
						<label class="field-label" for="new-expiry-date">Expiry Date</label>
						<DatePicker name="newExpiryDate" bind:value={newExpiryDate} placeholder="No expiry" />
					</div>
				</div>

				<div class="field">
					<label class="field-label" for="new-customer">Customer</label>
					<ContactSelect
						role={Role.Customer}
						bind:value={newContactId}
						bind:newName={newContactName}
						placeholder="Search or select a customer…"
					/>
				</div>

				<div class="field-grid field">
					<div>
						<label class="field-label" for="newCurrency">Currency</label>
						<Select.Root type="single" bind:value={newCurrency}>
							<Select.Trigger id="newCurrency" class="w-full">{newCurrency}</Select.Trigger>
							<Select.Content>
								{#each CURRENCIES as c (c.code)}
									<Select.Item value={c.code} label={`${c.code} — ${c.name}`} />
								{/each}
							</Select.Content>
						</Select.Root>
					</div>
					{#if newCurrency !== mainCurrency()}
						<div>
							<label class="field-label" for="newRate"
								>Rate (1 {newCurrency} = ? {mainCurrency()})</label
							>
							<Input
								id="newRate"
								type="text"
								inputmode="decimal"
								placeholder={newRateFetching ? 'Fetching…' : '1.0'}
								disabled={newRateFetching}
								bind:value={newExchangeRate}
							/>
							{#if newRateFetching || newRateError}
								<p class="foreign-note">{newRateFetching ? 'Fetching rate…' : newRateError}</p>
							{/if}
						</div>
					{/if}
				</div>

				<div class="field">
					<label class="field-label" for="newReference">Reference</label>
					<Input
						id="newReference"
						type="text"
						placeholder="Optional reference number…"
						bind:value={newReference}
					/>
				</div>

				<div class="field">
					<div class="field-label">Line Items *</div>
					<LineItemEditor bind:lines={newLines} currency={newCurrency} />
				</div>

				<div class="field">
					<label class="field-label" for="newNotes">Notes</label>
					<Textarea
						id="newNotes"
						placeholder="Optional notes for the customer…"
						class="leading-relaxed"
						bind:value={newNotes}
					/>
				</div>

				<div class="field">
					<label class="field-label" for="newTerms">Terms &amp; Conditions</label>
					<Textarea
						id="newTerms"
						placeholder="Optional terms…"
						class="leading-relaxed"
						bind:value={newTerms}
					/>
				</div>
			</div>

			<div class="sheet-foot">
				<div class="sheet-foot-actions">
					<button
						type="button"
						class="sheet-btn"
						onclick={() => (showNew = false)}
					>
						Cancel
					</button>
					<button
						type="button"
						class="sheet-btn sheet-btn-primary"
						onclick={handleCreate}
						disabled={newSaving}
					>
						{newSaving ? 'Creating…' : 'Create quotation'}
					</button>
				</div>
			</div>
		</Sheet.Content>
	</Sheet.Portal>
</Sheet.Root>

<style>
	.qt-lines {
		border: 1px solid var(--border);
		border-radius: 8px;
		overflow: hidden;
	}

	.qt-line {
		display: grid;
		grid-template-columns: 1fr auto auto;
		gap: 12px;
		padding: 10px 14px;
		border-bottom: 1px solid var(--border);
		align-items: start;
	}

	.qt-line:last-child {
		border-bottom: none;
	}

	.qt-line-desc {
		font-size: 13.5px;
		color: var(--foreground);
	}

	.qt-line-meta {
		font-size: 12px;
		color: var(--muted-foreground);
		white-space: nowrap;
		text-align: right;
	}

	.qt-line-total {
		font-size: 13px;
		font-weight: 500;
		color: var(--foreground);
		white-space: nowrap;
		text-align: right;
		min-width: 80px;
	}

	.qt-lines-total {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 10px 14px;
		background: var(--accent);
		border-top: 1px solid var(--border);
	}

	.qt-lines-total-label {
		font-size: 12.5px;
		font-weight: 600;
		color: var(--muted-foreground);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.qt-lines-total-val {
		font-size: 14px;
		font-weight: 600;
		color: var(--foreground);
	}

	.linked-invoice-card {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
		padding: 10px 12px;
		margin-top: 12px;
		margin-bottom: 4px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--background);
		text-align: left;
		font-family: inherit;
	}

	.linked-invoice-icon {
		width: 34px;
		height: 34px;
		border-radius: 7px;
		background: var(--accent);
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		color: var(--foreground);
	}

	.linked-invoice-body {
		flex: 1;
		min-width: 0;
	}

	.linked-invoice-title {
		font-size: 13.5px;
		font-weight: 500;
		color: var(--foreground);
	}

	.linked-invoice-sub {
		font-size: 12px;
		color: var(--muted-foreground);
		margin-top: 1px;
	}

	.result-total {
		color: var(--muted-foreground);
	}

	@media (max-width: 767px) {
		td[data-label='Expires'] {
			order: 6 !important;
		}
		td[data-label='Status'] {
			order: 5 !important;
		}
	}
</style>
