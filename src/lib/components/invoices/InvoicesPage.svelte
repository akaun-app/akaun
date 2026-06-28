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
		CreditCard
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
	import { InvoiceStatus, InvoiceStatusLabels, Role, EntityType } from '$lib/enums.js';
	import { goto, pushState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import type { loadInvoicesPage } from '$lib/server/loaders/invoices.js';

	type PageData = ReturnType<typeof loadInvoicesPage>;
	type ActionData = { error?: string; success?: boolean } | null;

	let {
		data,
		form,
		openId
	}: { data: PageData; form: ActionData; openId: number | null } = $props();

	// Status tab id → InvoiceStatus INT code
	const STATUS_CODE: Record<string, number> = {
		draft: InvoiceStatus.Draft,
		sent: InvoiceStatus.Sent,
		paid: InvoiceStatus.Paid,
		cancelled: InvoiceStatus.Cancelled
	};

	// Local reactive list — updated by SSE events and re-synced on SvelteKit data reload
	// svelte-ignore state_referenced_locally
	let invoices = $state(data.invoices);
	$effect(() => {
		invoices = data.invoices;
	});

	// --- State ---
	let searchRaw = $state('');
	let search = $state('');
	let statusTab = $state('all');
	let overdueOnly = $state(false);
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
	type InvoiceLine = {
		id: number;
		invoiceId: number;
		description: string;
		quantity: number;
		unitPrice: number;
		lineTotal: number;
		sortOrder: number;
	};
	type FullInvoice = (typeof data.invoices)[0] & { lines: InvoiceLine[] };

	let detailInvoice = $state<FullInvoice | null>(null);
	let isEditing = $state(false);
	let deleteDialogOpen = $state(false);
	let deleteFormEl = $state<HTMLFormElement | null>(null);
	let saving = $state(false);
	let saveError = $state('');
	let markingPaid = $state(false);
	let payConfirmOpen = $state(false);

	// Edit form state
	type LineInput = { description: string; quantity: number; unitPrice: number };
	let editIssueDate = $state('');
	let editDueDate = $state('');
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
	let newDueDate = $state('');
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
			newDueDate = '';
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
	type InvoiceStreamMsg =
		| { type: 'invoice-update'; item: (typeof data.invoices)[0] }
		| { type: 'invoice-delete'; id: number };

	// Derived counts (from local state for real-time accuracy)
	const counts = $derived.by(() => ({
		all: invoices.length,
		draft: invoices.filter((inv) => inv.status === InvoiceStatus.Draft).length,
		sent: invoices.filter((inv) => inv.status === InvoiceStatus.Sent).length,
		paid: invoices.filter((inv) => inv.status === InvoiceStatus.Paid).length,
		cancelled: invoices.filter((inv) => inv.status === InvoiceStatus.Cancelled).length
	}));

	// Stats
	const stats = $derived.by(() => {
		const sent = invoices.filter((inv) => inv.status === InvoiceStatus.Sent);
		const paid = invoices.filter((inv) => inv.status === InvoiceStatus.Paid);
		const overdue = invoices.filter((inv) => inv.isOverdue);
		const now = new Date();
		const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
		const thisMonth = invoices.filter((inv) => inv.issueDate.startsWith(monthKey));
		return {
			sentTotal: sent.reduce((s, inv) => s + inv.mainAmount, 0),
			sentCount: sent.length,
			paidTotal: paid.reduce((s, inv) => s + inv.mainAmount, 0),
			paidCount: paid.length,
			overdueTotal: overdue.reduce((s, inv) => s + inv.mainAmount, 0),
			overdueCount: overdue.length,
			monthTotal: thisMonth.reduce((s, inv) => s + inv.mainAmount, 0),
			monthCount: thisMonth.length,
			allTotal: invoices.reduce((s, inv) => s + inv.mainAmount, 0)
		};
	});

	// Filtered + sorted list
	const filtered = $derived.by(() => {
		let rows = invoices.slice();
		if (overdueOnly) {
			rows = rows.filter((inv) => inv.isOverdue);
		} else if (statusTab !== 'all') {
			rows = rows.filter((inv) => inv.status === STATUS_CODE[statusTab]);
		}
		if (dateFrom) rows = rows.filter((inv) => inv.issueDate >= dateFrom);
		if (dateTo) rows = rows.filter((inv) => inv.issueDate <= dateTo);
		if (search.trim()) {
			const s = search.toLowerCase();
			rows = rows.filter(
				(inv) =>
					inv.invoiceNumber.toLowerCase().includes(s) ||
					(inv.contactName ?? '').toLowerCase().includes(s) ||
					(inv.reference ?? '').toLowerCase().includes(s)
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

	const filteredTotal = $derived(filtered.reduce((s, inv) => s + inv.mainAmount, 0));
	const activeFilterCount = $derived(
		(dateFrom || dateTo ? 1 : 0) + (search.trim() ? 1 : 0) + (overdueOnly ? 1 : 0)
	);

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
		overdueOnly = false;
	}

	// Derive the display status label — 'overdue' overrides stored status for Draft/Sent
	function getStatusLabel(inv: { status: number; isOverdue: boolean }): string {
		if (
			inv.isOverdue &&
			(inv.status === InvoiceStatus.Draft || inv.status === InvoiceStatus.Sent)
		) {
			return 'overdue';
		}
		return InvoiceStatusLabels[inv.status] ?? 'draft';
	}

	// Editing is allowed unless paid or cancelled
	function canEdit(inv: { status: number }): boolean {
		return inv.status !== InvoiceStatus.Paid && inv.status !== InvoiceStatus.Cancelled;
	}

	// Deep-link: open an invoice detail sheet
	async function openInvoice(inv: (typeof data.invoices)[0], { push = true } = {}) {
		detailInvoice = { ...inv, lines: [] };
		isEditing = false;
		if (push) {
			pushState(resolve('/(app)/invoices/[id]', { id: String(inv.id) }), { viaPush: true });
		}
		const res = await fetch(`/api/invoices/${inv.id}`);
		if (res.ok) detailInvoice = await res.json();
	}

	function closeInvoice() {
		detailInvoice = null;
		isEditing = false;
		if (page.state.viaPush) {
			history.back();
		} else {
			goto(resolve('/invoices'), { replaceState: true, noScroll: true });
		}
	}

	// Enter edit mode — populate edit fields from current detail
	function startEdit() {
		if (!detailInvoice) return;
		editIssueDate = detailInvoice.issueDate;
		editDueDate = detailInvoice.dueDate ?? '';
		editContactId = detailInvoice.contactId;
		editContactName = null;
		editCurrency = detailInvoice.currency;
		editExchangeRate = String(detailInvoice.exchangeRate);
		editNotes = detailInvoice.notes ?? '';
		editTerms = detailInvoice.terms ?? '';
		editReference = detailInvoice.reference ?? '';
		editLines = detailInvoice.lines.map((l) => ({
			description: l.description,
			quantity: l.quantity,
			unitPrice: l.unitPrice
		}));
		saveError = '';
		isEditing = true;
	}

	async function saveEdit() {
		if (!detailInvoice) return;
		saving = true;
		saveError = '';
		try {
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
			const res = await fetch(`/api/invoices/${detailInvoice.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					issueDate: editIssueDate,
					dueDate: editDueDate || null,
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
				detailInvoice = await res.json();
				isEditing = false;
			}
		} catch {
			saveError = 'Network error — try again';
		} finally {
			saving = false;
		}
	}

	// Create a new invoice via JSON API (line items can't be FormData)
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
			const res = await fetch('/api/invoices', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					issueDate: newIssueDate,
					dueDate: newDueDate || null,
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
				newError = err.error ?? 'Failed to create invoice';
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

	// Mark invoice as paid via JSON API
	async function markPaid(id: number) {
		markingPaid = true;
		try {
			const res = await fetch(`/api/invoices/${id}/pay`, { method: 'POST' });
			if (res.ok) {
				// SSE will update the invoice row; also re-fetch lines for the detail
				const updated = await fetch(`/api/invoices/${id}`).then((r) => r.json());
				if (updated) detailInvoice = updated;
			}
		} finally {
			markingPaid = false;
		}
	}

	onMount(() => {
		// Deep-link: open the invoice if openId was passed via direct navigation
		if (openId) {
			const found = invoices.find((inv) => inv.id === openId);
			if (found) openInvoice(found, { push: false });
		}
		// SSE subscription — cleanup is handled internally by createResourceStream
		createResourceStream<InvoiceStreamMsg>('/api/invoices/stream', (msg) => {
			if (msg.type === 'invoice-update') invoices = mergeById(invoices, [msg.item]);
			else if (msg.type === 'invoice-delete')
				invoices = invoices.filter((inv) => inv.id !== msg.id);
		});
	});
</script>

<div class="screen" style="position:relative;">
	<!-- Top bar -->
	<header class="topbar">
		<div class="topbar-left">
			<h1 class="page-title">Invoices</h1>
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
						placeholder="Search IV#, customer, ref…"
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
						placeholder="Search IV#, customer, ref…"
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
				<Plus size={15} /> <span class="btn-text">New invoice</span>
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
			sub="{stats.sentCount} awaiting payment"
		/>
		<StatCard
			tone="red"
			label="Overdue"
			cur={mainCurrencySymbol()}
			value={formatMoney(stats.overdueTotal)}
			sub="{stats.overdueCount} overdue"
		/>
		<StatCard
			tone="green"
			label="Paid"
			cur={mainCurrencySymbol()}
			value={formatMoney(stats.paidTotal)}
			sub="{stats.paidCount} collected"
		/>
		<StatCard
			label="All recorded"
			cur={mainCurrencySymbol()}
			value={formatMoney(stats.allTotal)}
			sub="{counts.all} invoices"
		/>
	</div>

	<div class="work">
		<div class="work-main layout-standard" style="padding-top:12px;">
			<!-- Toolbar -->
			<div class="toolbar">
				<div class="status-tabs">
					{#each [['all', 'All'], ['draft', 'Draft'], ['sent', 'Sent'], ['paid', 'Paid'], ['cancelled', 'Cancelled']] as [id, label]}
						<button
							class="status-tab"
							class:active={statusTab === id && !overdueOnly}
							onclick={() => {
								statusTab = id;
								overdueOnly = false;
							}}
						>
							{label}<span class="tab-count">{counts[id as keyof typeof counts]}</span>
						</button>
					{/each}
					<button
						class="status-tab"
						class:active={overdueOnly}
						onclick={() => {
							overdueOnly = !overdueOnly;
							if (overdueOnly) statusTab = 'all';
						}}
					>
						Overdue<span class="tab-count">{stats.overdueCount}</span>
					</button>
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
								class={`sortable ${sort.key === 'invoiceNumber' ? 'sorted' : ''}`}
								onclick={() => onSort('invoiceNumber')}
								style="cursor:pointer; user-select:none;"
							>
								<span class="th-inner"
									>Invoice {sort.key === 'invoiceNumber'
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
							<th onclick={() => onSort('dueDate')} style="cursor:pointer; user-select:none;">
								<span class="th-inner"
									>Due {sort.key === 'dueDate'
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
						{#each filtered as inv}
							<tr class="exp-row" onclick={() => openInvoice(inv)}>
								<td class="td-primary">
									<div class="cell-item">
										<span class="cell-itemname">{inv.contactName || '—'}</span>
										<span class="cell-itemnum">{inv.invoiceNumber}</span>
									</div>
								</td>
								<td class="td-status" data-label="Status">
									<StatusBadge status={getStatusLabel(inv)} />
								</td>
								<td class="td-date" data-label="Date">
									{formatDateShort(inv.issueDate)}<span class="td-year"
										>{inv.issueDate.slice(0, 4)}</span
									>
								</td>
								<td class="td-date" data-label="Due">
									{#if inv.dueDate}
										{formatDateShort(inv.dueDate)}<span class="td-year"
											>{inv.dueDate.slice(0, 4)}</span
										>
									{:else}
										<span style="color:var(--muted-foreground);">—</span>
									{/if}
								</td>
								<td class="td-amount" data-label="Amount">
									<span class="amount-num">{mainCurrencySymbol()} {formatMoney(inv.mainAmount)}</span>
									{#if inv.currency !== mainCurrency()}
										<span class="amount-orig"
											>{inv.currency} {formatCurrencyAmount(inv.total, inv.currency)}</span
										>
									{/if}
								</td>
							</tr>
						{/each}
						{#if invoices.length === 0}
							<tr class="empty-row">
								<td colspan="5">
									<EmptyState
										title="No invoices yet"
										sub="Your invoices will appear here once created."
									>
										{#snippet icon()}<FileText size={20} />{/snippet}
									</EmptyState>
								</td>
							</tr>
						{:else if filtered.length === 0}
							<tr class="empty-row">
								<td colspan="5">
									<EmptyState
										title="No invoices match your filters"
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
				<span>{filtered.length} of {counts.all} invoices</span>
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
	open={!!detailInvoice}
	onOpenChange={(o) => {
		if (!o) closeInvoice();
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
			{#if detailInvoice}
				<!-- Header -->
				<div
					style="display:flex; align-items:flex-start; justify-content:space-between; padding:22px 22px 16px; border-bottom:1px solid var(--border);"
				>
					<div>
						<div class="sheet-eyebrow">{detailInvoice.invoiceNumber}</div>
						<div class="sheet-title-text">{detailInvoice.contactName || 'Invoice'}</div>
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
								<label class="field-label" for="edit-due-date">Due Date</label>
								<DatePicker name="editDueDate" bind:value={editDueDate} placeholder="No due date" />
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
								disabled={!canEdit(detailInvoice)}
								title={!canEdit(detailInvoice)
									? 'Paid or cancelled invoices cannot be deleted'
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
							<span class="detail-amount-val">{formatMoney(detailInvoice.mainAmount)}</span>
						</div>
						{#if detailInvoice.currency !== mainCurrency()}
							<div class="detail-orig">
								Original: {detailInvoice.currency}
								{formatCurrencyAmount(detailInvoice.total, detailInvoice.currency)} · rate {detailInvoice.exchangeRate}
							</div>
						{/if}
						<div class="detail-statusrow">
							<StatusBadge status={getStatusLabel(detailInvoice)} />
						</div>

						<div class="detail-list">
							{#if detailInvoice.contactName}
								<div class="detail-row">
									<div class="detail-key">Customer</div>
									<div class="detail-val">{detailInvoice.contactName}</div>
								</div>
							{/if}
							<div class="detail-row">
								<div class="detail-key">Issue Date</div>
								<div class="detail-val num">{formatDate(detailInvoice.issueDate)}</div>
							</div>
							{#if detailInvoice.dueDate}
								<div class="detail-row">
									<div class="detail-key">Due Date</div>
									<div
										class="detail-val num"
										style={detailInvoice.isOverdue ? 'color:var(--red); font-weight:600;' : ''}
									>
										{formatDate(detailInvoice.dueDate)}
										{#if detailInvoice.isOverdue}<span style="font-size:11px; margin-left:4px;">OVERDUE</span>{/if}
									</div>
								</div>
							{/if}
							{#if detailInvoice.reference}
								<div class="detail-row">
									<div class="detail-key">Reference</div>
									<div class="detail-val num">{detailInvoice.reference}</div>
								</div>
							{/if}
							{#if detailInvoice.currency !== mainCurrency()}
								<div class="detail-row">
									<div class="detail-key">Currency</div>
									<div class="detail-val">
										{detailInvoice.currency} (rate: {detailInvoice.exchangeRate})
									</div>
								</div>
							{/if}
						</div>

						<!-- Source quotation link -->
						{#if detailInvoice.sourceQuotationId}
							<div style="margin-top:12px;">
								<button
									type="button"
									class="linked-claim-card related-link"
									onclick={() => goto(resolve('/(app)/quotations/[id]', { id: String(detailInvoice!.sourceQuotationId) }))}
								>
									<span class="rel-card-icon"><FileText size={16} /></span>
									<span class="rel-card-body">
										<span class="rel-card-title">Source Quotation</span>
									</span>
									<ChevronRight size={13} color="var(--muted-foreground)" />
								</button>
							</div>
						{/if}

						<!-- Linked income record -->
						{#if detailInvoice.resultIncomeId}
							<div style="margin-top:8px;">
								<button
									type="button"
									class="linked-claim-card related-link"
									onclick={() => goto(resolve('/(app)/income/[id]', { id: String(detailInvoice!.resultIncomeId) }))}
								>
									<span class="rel-card-icon"><CreditCard size={16} /></span>
									<span class="rel-card-body">
										<span class="rel-card-title">Income Record</span>
									</span>
									<ChevronRight size={13} color="var(--muted-foreground)" />
								</button>
							</div>
						{/if}

						<!-- Line items (read-only) -->
						{#if detailInvoice.lines.length > 0}
							<div class="detail-section-label">Line Items</div>
							<div class="qt-lines">
								{#each detailInvoice.lines as line}
									<div class="qt-line">
										<div class="qt-line-desc">{line.description}</div>
										<div class="qt-line-meta">
											{line.quantity} × {formatCurrencyAmount(line.unitPrice, detailInvoice.currency)}
										</div>
										<div class="qt-line-total">
											{formatCurrencyAmount(line.lineTotal, detailInvoice.currency)}
										</div>
									</div>
								{/each}
								<div class="qt-lines-total">
									<span class="qt-lines-total-label">Total</span>
									<span class="qt-lines-total-val">
										{detailInvoice.currency}
										{formatCurrencyAmount(detailInvoice.total, detailInvoice.currency)}
									</span>
								</div>
							</div>
						{/if}

						{#if detailInvoice.notes}
							<div class="detail-list" style="margin-top:12px;">
								<div class="detail-row">
									<div class="detail-key">Notes</div>
									<div class="detail-val" style="white-space:pre-wrap;">
										{detailInvoice.notes}
									</div>
								</div>
							</div>
						{/if}
						{#if detailInvoice.terms}
							<div class="detail-list" style="margin-top:4px;">
								<div class="detail-row">
									<div class="detail-key">Terms</div>
									<div class="detail-val" style="white-space:pre-wrap;">
										{detailInvoice.terms}
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
								disabled={!canEdit(detailInvoice)}
								title={!canEdit(detailInvoice)
									? 'Paid or cancelled invoices cannot be deleted'
									: undefined}
								onclick={() => (deleteDialogOpen = true)}
							>
								<Trash2 size={14} /> Delete
							</button>
							<a
								href="/print/invoices/{detailInvoice.id}"
								target="_blank"
								class="sheet-btn"
								style="text-decoration:none;"
							>
								<Printer size={14} /> Print
							</a>
							{#if detailInvoice.status === InvoiceStatus.Sent}
								<button
									type="button"
									class="sheet-btn"
									onclick={() => (payConfirmOpen = true)}
									disabled={markingPaid}
								>
									<CreditCard size={14} /> {markingPaid ? 'Marking…' : 'Record Payment'}
								</button>
							{/if}
							{#if canEdit(detailInvoice)}
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
									onclick={closeInvoice}
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

{#if detailInvoice}
	<ConfirmDialog
		bind:open={deleteDialogOpen}
		title="Delete invoice?"
		description={`This will permanently delete ${detailInvoice.invoiceNumber}. This can't be undone.`}
		confirmLabel="Delete"
		danger
		onConfirm={() => deleteFormEl?.requestSubmit()}
	/>
	<ConfirmDialog
		bind:open={payConfirmOpen}
		title="Record payment?"
		description={`Mark ${detailInvoice.invoiceNumber} as paid? This will create a linked income record and cannot be undone.`}
		confirmLabel="Record Payment"
		onConfirm={() => markPaid(detailInvoice!.id)}
	/>
	<form
		method="POST"
		action="?/delete"
		bind:this={deleteFormEl}
		use:enhance={() =>
			async ({ result, update }) => {
				if (result.type === 'success') {
					deleteDialogOpen = false;
					closeInvoice();
				}
				await update();
			}}
		style="display:none"
	>
		<input type="hidden" name="id" value={detailInvoice.id} />
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
					<div class="sheet-title-text">New invoice</div>
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
						<label class="field-label" for="new-due-date">Due Date</label>
						<DatePicker name="newDueDate" bind:value={newDueDate} placeholder="No due date" />
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
						{newSaving ? 'Creating…' : 'Create invoice'}
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

	.result-total {
		color: var(--muted-foreground);
	}

	.rel-card-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 34px;
		height: 34px;
		border-radius: 7px;
		background: var(--accent);
		color: var(--muted-foreground);
		flex-shrink: 0;
	}

	.rel-card-body {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.rel-card-title {
		font-size: 13.5px;
		font-weight: 500;
		color: var(--foreground);
	}

	@media (max-width: 767px) {
		td[data-label='Due'] {
			order: 6 !important;
		}
		td[data-label='Status'] {
			order: 5 !important;
		}
	}
</style>
