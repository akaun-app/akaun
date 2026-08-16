<script lang="ts">
  import { enhance } from "$app/forms";
  import { onMount } from "svelte";
  import { fly } from "svelte/transition";
  import {
    Calendar,
    ChevronDown,
    ChevronRight,
    Lock,
    Plus,
    Search,
    SlidersHorizontal,
    Tag,
    Trash2,
    Wallet,
    X,
  } from "@lucide/svelte";
  import StatusBadge from "$lib/components/ui/StatusBadge.svelte";
  import EmptyState from "$lib/components/ui/EmptyState.svelte";
  import ConfirmDialog from "$lib/components/ui/ConfirmDialog.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import StatCard from "$lib/components/ui/StatCard.svelte";
  import BulkActionBar from "$lib/components/ui/BulkActionBar.svelte";
  import FilterDropdown from "$lib/components/ui/FilterDropdown.svelte";
  import AmountInput from "$lib/components/ui/AmountInput.svelte";
  import DatePicker from "$lib/components/ui/date-picker/DatePicker.svelte";
  import * as Sheet from "$lib/components/ui/sheet/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import RecordSheet from "$lib/components/ledger/RecordSheet.svelte";
  import PaymentSheet from "$lib/components/ledger/PaymentSheet.svelte";
  import { statusLabelFor } from "$lib/components/ledger/record-status.js";
  import {
    formatDateShort,
    formatMinor,
    formatMinorAmount,
  } from "$lib/format.js";
  import {
    mainCurrency,
    mainCurrencySymbol,
  } from "$lib/currency-state.svelte.js";
  import { formatCurrencyAmount } from "$lib/currency.js";
  import { createResourceStream, mergeById } from "$lib/sse.js";
  import { SvelteSet } from "svelte/reactivity";
  import { AccountRole, LedgerRecordKind } from "$lib/enums.js";
  import { goto, pushState } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import type {
    OutstandingItem,
    RecordView,
  } from "$lib/server/ledger/types.js";
  import type { loadLedgerPage } from "$lib/server/loaders/ledger.js";

  /**
   * Money going out.
   *
   * Every row is a record in the one store, and everything the screen says
   * about payment — paid, part paid, still owed — is read off what the server
   * derived from settlements rather than from a status column, so this list and
   * the record's own drawer can never disagree (FR-012).
   *
   * Nothing here uses an accounting word (Principle VII): the question is "what
   * was it for?" and "who paid for it?", never a debit or a credit.
   */
  type PageData = ReturnType<typeof loadLedgerPage>;
  type ActionData = {
    error?: string;
    success?: boolean;
    deleted?: number;
    refusedReason?: string | null;
  } | null;

  let {
    data,
    form,
    openId,
  }: { data: PageData; form: ActionData; openId: number | null } = $props();

  // The list the screen draws: what the server sent, until the stream says
  // otherwise. Writable, so an SSE event edits it in place; derived, so a real
  // navigation or a form action re-syncs it back to the server's answer.
  let records = $derived(data.records);

  // --- Reading one record -----------------------------------------------
  // The two accounts an expense names: what it was for, and where the money
  // came from. A record that someone else paid has "money we owe" on the paying
  // side instead of an account (FR-008), which is what makes it read as owed.
  const CATEGORY_ROLES: number[] = [
    AccountRole.ExpenseCategory,
    AccountRole.Equipment,
  ];

  function categoryOf(record: RecordView) {
    return (
      record.movements.find((m) => CATEGORY_ROLES.includes(m.accountRole)) ??
      record.movements.find((m) => m.amountMinor > 0) ??
      null
    );
  }

  function categoryName(record: RecordView): string {
    return categoryOf(record)?.accountName ?? "";
  }

  // `locked` and `lockedReason` are computed server-side and travel with the
  // record, so the rule in src/lib/server/ledger/locking.ts is read here rather
  // than hand-duplicated — there is nothing for the two copies to disagree on.

  // --- Filter and sort state ---------------------------------------------
  let searchRaw = $state("");
  let search = $state("");
  let statusTab = $state("all");
  let selectedCats = $state<number[]>([]);
  let amountMin = $state("");
  let amountMax = $state("");
  let dateFrom = $state("");
  let dateTo = $state("");
  let sort = $state({ key: "date", dir: "desc" as "asc" | "desc" });
  let selected = new SvelteSet<number>();

  let showNew = $state(false);
  let mobileFilterOpen = $state(false);
  let mobileSearchOpen = $state(false);
  let mobileSearchEl = $state<HTMLInputElement | null>(null);
  let deleteDialogOpen = $state(false);
  let deleteFormEl = $state<HTMLFormElement | null>(null);
  // Shown until it is dismissed or the next action replaces it.
  let actionError = $derived(form?.error ?? form?.refusedReason ?? "");

  $effect(() => {
    if (mobileSearchOpen && mobileSearchEl) mobileSearchEl.focus();
  });

  // Debounced search
  $effect(() => {
    const v = searchRaw;
    const t = setTimeout(() => (search = v), 300);
    return () => clearTimeout(t);
  });

  // --- Derived ------------------------------------------------------------
  const STATUS_TABS = [
    ["all", "All"],
    ["owed", "Owed"],
    ["part-paid", "Part paid"],
    ["paid", "Paid"],
  ] as const;

  const counts = $derived.by(() => {
    const out: Record<string, number> = {
      all: records.length,
      owed: 0,
      "part-paid": 0,
      paid: 0,
    };
    for (const r of records) out[statusLabelFor(r)]++;
    return out;
  });

  const filtered = $derived.by(() => {
    let rows = records.slice();
    if (statusTab !== "all") {
      rows = rows.filter((r) => statusLabelFor(r) === statusTab);
    }
    if (selectedCats.length) {
      rows = rows.filter((r) => {
        const category = categoryOf(r);
        return category !== null && selectedCats.includes(category.accountId);
      });
    }
    const mn = amountMin !== "" ? parseFloat(amountMin) * 100 : null;
    const mx = amountMax !== "" ? parseFloat(amountMax) * 100 : null;
    if (mn != null) rows = rows.filter((r) => r.amountMinor >= mn);
    if (mx != null) rows = rows.filter((r) => r.amountMinor <= mx);
    if (dateFrom) rows = rows.filter((r) => r.date >= dateFrom);
    if (dateTo) rows = rows.filter((r) => r.date <= dateTo);
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.description.toLowerCase().includes(q) ||
          (r.contactName ?? "").toLowerCase().includes(q) ||
          (r.recordNumber ?? "").toLowerCase().includes(q) ||
          r.reference.toLowerCase().includes(q) ||
          categoryName(r).toLowerCase().includes(q),
      );
    }

    const key = sort.key;
    rows.sort((a, b) => {
      const av = sortValue(a, key);
      const bv = sortValue(b, key);
      let cmp = av < bv ? -1 : av > bv ? 1 : 0;
      if (cmp === 0) cmp = a.id - b.id;
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return rows;
  });

  function sortValue(record: RecordView, key: string): string | number {
    switch (key) {
      case "description":
        return record.description.toLowerCase();
      case "contactName":
        return (record.contactName ?? "").toLowerCase();
      case "category":
        return categoryName(record).toLowerCase();
      case "status":
        return statusLabelFor(record);
      case "amount":
        return record.amountMinor;
      default:
        return record.date;
    }
  }

  const filteredTotal = $derived(
    filtered.reduce((sum, r) => sum + r.amountMinor, 0),
  );
  const activeFilterCount = $derived(
    selectedCats.length +
      (amountMin || amountMax ? 1 : 0) +
      (dateFrom || dateTo ? 1 : 0) +
      (search.trim() ? 1 : 0),
  );
  const allSelected = $derived(
    filtered.length > 0 && filtered.every((r) => selected.has(r.id)),
  );
  const someSelected = $derived(
    filtered.some((r) => selected.has(r.id)) && !allSelected,
  );
  const selectedList = $derived(filtered.filter((r) => selected.has(r.id)));
  const selTotal = $derived(
    selectedList.reduce((sum, r) => sum + r.amountMinor, 0),
  );
  // A record a settlement or a bank line still points at refuses deletion, so
  // the bar says so up front rather than after the fact.
  const lockedSelected = $derived(selectedList.filter((r) => r.locked).length);

  const stats = $derived.by(() => {
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const thisMonth = records.filter((r) => r.date.startsWith(monthKey));
    const unpaid = records.filter((r) => !r.paid);
    const paid = records.filter((r) => r.paid);
    return {
      owedTotal: unpaid.reduce((sum, r) => sum + r.outstandingMinor, 0),
      owedCount: unpaid.length,
      paidTotal: paid.reduce((sum, r) => sum + r.amountMinor, 0),
      paidCount: paid.length,
      monthTotal: thisMonth.reduce((sum, r) => sum + r.amountMinor, 0),
      monthCount: thisMonth.length,
      allTotal: records.reduce((sum, r) => sum + r.amountMinor, 0),
    };
  });

  // --- Selection ----------------------------------------------------------
  function toggleAll() {
    if (allSelected) filtered.forEach((r) => selected.delete(r.id));
    else filtered.forEach((r) => selected.add(r.id));
  }

  function toggleOne(id: number) {
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
  }

  function clearSel() {
    selected.clear();
  }

  function onSort(key: string) {
    if (sort.key === key) {
      sort = { key, dir: sort.dir === "asc" ? "desc" : "asc" };
    } else {
      sort = { key, dir: key === "amount" || key === "date" ? "desc" : "asc" };
    }
  }

  function clearAllFilters() {
    selectedCats = [];
    amountMin = "";
    amountMax = "";
    dateFrom = "";
    dateTo = "";
    searchRaw = "";
    statusTab = "all";
  }

  function toggleCat(id: number) {
    selectedCats = selectedCats.includes(id)
      ? selectedCats.filter((x) => x !== id)
      : [...selectedCats, id];
  }

  // --- Detail drawer ------------------------------------------------------
  // The open record is looked up by id rather than copied, so a change arriving
  // over the stream reaches the open drawer without a second fetch.
  let openRecordId = $state<number | null>(null);
  const detailRecord = $derived(
    openRecordId === null
      ? null
      : (records.find((r) => r.id === openRecordId) ?? null),
  );

  function openRecord(record: RecordView, { push = true } = {}) {
    openRecordId = record.id;
    if (push) {
      pushState(resolve("/(app)/expenses/[id]", { id: String(record.id) }), {
        viaPush: true,
      });
    }
  }

  function closeDetail() {
    openRecordId = null;
    if (page.state.viaPush) {
      history.back();
    } else {
      goto(resolve("/expenses"), { replaceState: true, noScroll: true });
    }
  }

  // --- Who is owed, and how much is left ----------------------------------
  // An expense somebody else paid for is money this business owes them until a
  // payment covers it. The figures come from `GET /api/settlements` rather than
  // being added up here, so this panel, a record's own drawer and the reports
  // are all reading one answer to one question (FR-014).
  type OwedGroup = {
    contactId: number;
    contactName: string;
    totalMinor: number;
    items: OutstandingItem[];
  };

  let owedItems = $state<OutstandingItem[]>([]);
  let owedOpen = $state(true);
  let payContactId = $state<number | null>(null);
  let showPayment = $state(false);

  async function loadOwed() {
    const res = await fetch("/api/settlements?direction=we-owe");
    if (!res.ok) return;
    const body = await res.json();
    owedItems = body?.items ?? [];
  }

  const owedGroups = $derived.by(() => {
    const byContact: Record<number, OwedGroup> = {};
    for (const item of owedItems) {
      // A record on a shared owed account always names who it is owed to, so an
      // item without one is a broken row rather than an "unknown" group.
      if (item.contactId === null) continue;
      const group = (byContact[item.contactId] ??= {
        contactId: item.contactId,
        contactName: item.contactName ?? "",
        totalMinor: 0,
        items: [],
      });
      group.totalMinor += item.outstandingMinor;
      group.items.push(item);
    }
    return Object.values(byContact).sort((a, b) => b.totalMinor - a.totalMinor);
  });

  const owedTotal = $derived(
    owedGroups.reduce((sum, g) => sum + g.totalMinor, 0),
  );

  function openOwedItem(item: OutstandingItem) {
    const found = records.find((r) => r.id === item.recordId);
    if (found) openRecord(found);
    else goto(resolve("/(app)/expenses/[id]", { id: String(item.recordId) }));
  }

  function startPayment(group: OwedGroup) {
    payContactId = group.contactId;
    showPayment = true;
  }

  // --- Live updates -------------------------------------------------------
  type LedgerStreamMsg =
    | { type: "record-update"; record: RecordView }
    | { type: "record-deleted"; id: number }
    | { type: "settlement-changed"; recordIds: number[] };

  createResourceStream<LedgerStreamMsg>("/api/expenses/stream", (msg) => {
    if (msg.type === "record-update") {
      // The stream is already filtered to this screen's kind; the check keeps a
      // future change to that filter from quietly pulling other records in.
      if (msg.record.kind !== LedgerRecordKind.Expense) return;
      records = mergeById(records, [msg.record]);
    } else if (msg.type === "record-deleted") {
      records = records.filter((r) => r.id !== msg.id);
      if (openRecordId === msg.id) closeDetail();
    }
    // The record list is patched in place from the event, but what is still
    // owed is derived across records — including payments this screen does not
    // hold — so it is asked for again rather than guessed at.
    void loadOwed();
  });

  onMount(() => {
    void loadOwed();
    if (openId) {
      const found = data.records.find((r) => r.id === openId);
      if (found) openRecord(found, { push: false });
    }
  });
</script>

<div class="screen" style="position:relative;">
  <!-- Top bar -->
  <header class="topbar">
    <div class="topbar-left">
      <h1 class="page-title">Expenses</h1>
      <p class="page-sub">
        {counts.all} records ·
        <span class="num">{formatMinor(stats.allTotal)}</span> total
      </p>
    </div>
    <div class="topbar-right">
      <div class="search-box">
        <div style="position:relative; display:flex; align-items:center;">
          <span
            style="position:absolute; left:10px; color:var(--muted-foreground); display:flex; pointer-events:none;"
          >
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
        <div
          class="mobile-search-inline"
          transition:fly={{ x: 12, duration: 180 }}
        >
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
        onclick={() => {
          mobileSearchOpen = !mobileSearchOpen;
          if (!mobileSearchOpen) searchRaw = "";
        }}
      >
        {#if mobileSearchOpen}<X size={16} />{:else}<Search size={16} />{/if}
      </button>
      {#if data.perms.add}
        <button
          onclick={() => (showNew = true)}
          style="display:inline-flex; align-items:center; gap:6px; height:32px; padding:0 12px; background:var(--primary); color:var(--primary-foreground); border:none; border-radius:8px; font-family:inherit; font-size:13px; font-weight:500; cursor:pointer;"
        >
          <Plus size={15} /> <span class="btn-text">New expense</span>
        </button>
      {/if}
    </div>
  </header>

  <!-- Stat strip -->
  <div class="stat-strip">
    <StatCard
      tone="red"
      label="Still owed"
      cur={mainCurrencySymbol()}
      value={formatMinorAmount(stats.owedTotal)}
      sub="{stats.owedCount} not fully paid"
    />
    <StatCard
      tone="green"
      label="Paid"
      cur={mainCurrencySymbol()}
      value={formatMinorAmount(stats.paidTotal)}
      sub="{stats.paidCount} records"
    />
    <StatCard
      label="This month"
      cur={mainCurrencySymbol()}
      value={formatMinorAmount(stats.monthTotal)}
      sub="{stats.monthCount} records"
    />
    <StatCard
      label="All recorded"
      cur={mainCurrencySymbol()}
      value={formatMinorAmount(stats.allTotal)}
      sub="{counts.all} expenses"
    />
  </div>

  <div class="work">
    <div class="work-main layout-standard" style="padding-top:12px;">
      {#if actionError}
        <div class="page-error">
          {actionError}
          <button
            type="button"
            aria-label="Dismiss"
            onclick={() => (actionError = "")}><X size={13} /></button
          >
        </div>
      {/if}

      <!-- Who is owed, and how much is left -->
      {#if owedGroups.length > 0}
        <section class="owed-panel">
          <button
            type="button"
            class="owed-head"
            aria-expanded={owedOpen}
            onclick={() => (owedOpen = !owedOpen)}
          >
            <span class="owed-head-main">
              <span class="owed-head-title">Still owed to people</span>
              <span class="owed-head-sub">
                {owedGroups.length}
                {owedGroups.length === 1 ? "person" : "people"} · paid for things
                on your behalf
              </span>
            </span>
            <span class="owed-head-total num">{formatMinor(owedTotal)}</span>
            {#if owedOpen}<ChevronDown
                size={15}
                color="var(--muted-foreground)"
              />{:else}<ChevronRight
                size={15}
                color="var(--muted-foreground)"
              />{/if}
          </button>

          {#if owedOpen}
            <div class="owed-body">
              {#each owedGroups as group (group.contactId)}
                <div class="owed-group">
                  <div class="owed-group-head">
                    <span class="owed-group-name">{group.contactName}</span>
                    <span class="owed-group-total num"
                      >{formatMinor(group.totalMinor)}</span
                    >
                    {#if data.perms.add}
                      <button
                        type="button"
                        class="owed-pay-btn"
                        onclick={() => startPayment(group)}
                      >
                        Record a payment
                      </button>
                    {/if}
                  </div>
                  {#each group.items as item (item.movementId)}
                    <button
                      type="button"
                      class="owed-row related-link"
                      onclick={() => openOwedItem(item)}
                    >
                      <span class="owed-row-main">
                        <span class="owed-row-name"
                          >{item.description || "Expense"}</span
                        >
                        <span class="owed-row-sub">
                          {formatDateShort(item.date)}{item.recordNumber
                            ? ` · ${item.recordNumber}`
                            : ""}{item.daysOverdue > 0
                            ? ` · ${item.daysOverdue} days`
                            : ""}
                        </span>
                      </span>
                      <span class="owed-row-amt num"
                        >{formatMinor(item.outstandingMinor)}</span
                      >
                      <ChevronRight size={13} color="var(--muted-foreground)" />
                    </button>
                  {/each}
                </div>
              {/each}
            </div>
          {/if}
        </section>
      {/if}

      <!-- Toolbar -->
      <div class="toolbar">
        <div class="status-tabs">
          {#each STATUS_TABS as [id, label] (id)}
            <button
              class="status-tab"
              class:active={statusTab === id}
              onclick={() => (statusTab = id)}
            >
              {label}<span class="tab-count">{counts[id]}</span>
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
            {#if activeFilterCount > 0}<span class="filter-count"
                >{activeFilterCount}</span
              >{/if}
          </button>
          {#if activeFilterCount > 0}
            <button class="clear-filters" onclick={clearAllFilters}
              ><X size={13} /> Clear</button
            >
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
              <div
                style="display:flex; align-items:center; justify-content:space-between; padding:6px 8px 8px; font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.04em; color:var(--muted-foreground);"
              >
                <span>Categories</span>
                {#if selectedCats.length}<button
                    onclick={() => (selectedCats = [])}
                    style="border:none; background:none; color:var(--primary); cursor:pointer; font-size:11px; font-weight:600;"
                    >Clear</button
                  >{/if}
              </div>
              {#each data.categories as cat (cat.id)}
                <button
                  onclick={() => toggleCat(cat.id)}
                  class="cat-option"
                  class:on={selectedCats.includes(cat.id)}
                >
                  <span class="cat-box" aria-hidden="true">
                    {#if selectedCats.includes(cat.id)}<svg
                        width="10"
                        height="10"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="white"
                        stroke-width="3"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        ><path d="M20 6 9 17l-5-5" /></svg
                      >{/if}
                  </span>
                  {cat.name}
                </button>
              {/each}
            </div>
          </FilterDropdown>

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
                {#if dateFrom || dateTo}<button
                    onclick={() => {
                      dateFrom = "";
                      dateTo = "";
                    }}
                    style="border:none; background:none; color:var(--primary); cursor:pointer; font-size:11px; font-weight:600; padding:0;"
                    >Clear</button
                  >{/if}
              </div>
              <div style="display:flex; flex-direction:column; gap:8px;">
                <span style="font-size:11.5px; color:var(--muted-foreground);"
                  >From</span
                >
                <DatePicker bind:value={dateFrom} placeholder="From date" />
                <span style="font-size:11.5px; color:var(--muted-foreground);"
                  >To</span
                >
                <DatePicker bind:value={dateTo} placeholder="To date" />
              </div>
            </div>
          </FilterDropdown>

          <FilterDropdown
            label="Amount"
            active={!!(amountMin || amountMax)}
            align="right"
          >
            {#snippet icon()}<SlidersHorizontal size={14} />{/snippet}
            <div style="padding:12px 14px; min-width:168px;">
              <div
                style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;"
              >
                <div
                  style="font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.04em; color:var(--muted-foreground);"
                >
                  Amount range
                </div>
                {#if amountMin || amountMax}<button
                    onclick={() => {
                      amountMin = "";
                      amountMax = "";
                    }}
                    style="border:none; background:none; color:var(--primary); cursor:pointer; font-size:11px; font-weight:600; padding:0;"
                    >Clear</button
                  >{/if}
              </div>
              <div style="display:flex; align-items:center; gap:8px;">
                <AmountInput
                  wrapperStyle="width:120px;"
                  placeholder="Min"
                  bind:value={amountMin}
                  style="width:84px;"
                />
                <span style="color:var(--muted-foreground);">–</span>
                <AmountInput
                  wrapperStyle="width:120px;"
                  placeholder="Max"
                  bind:value={amountMax}
                  style="width:84px;"
                />
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
            >Filtered total <b class="num">{formatMinor(filteredTotal)}</b
            ></span
          >
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
                  style="width:17px; height:17px; border-radius:5px; border:1.5px solid {allSelected
                    ? 'var(--primary)'
                    : 'var(--border-strong)'}; background:{allSelected ||
                  someSelected
                    ? 'var(--primary)'
                    : 'var(--card)'}; display:grid; place-items:center; cursor:pointer; color:var(--primary-foreground); padding:0; flex-shrink:0;"
                  onclick={toggleAll}
                  aria-label="Select all"
                >
                  {#if allSelected}<svg
                      width="10"
                      height="10"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="white"
                      stroke-width="3"><path d="M20 6 9 17l-5-5" /></svg
                    >{:else if someSelected}<span
                      style="width:8px; height:2px; border-radius:2px; background:white; display:block;"
                    ></span>{/if}
                </button>
              </th>
              <th
                class={`sortable ${sort.key === "description" ? "sorted" : ""}`}
                onclick={() => onSort("description")}
                style="cursor:pointer; user-select:none;"
              >
                <span class="th-inner"
                  >Item {sort.key === "description"
                    ? sort.dir === "asc"
                      ? "↑"
                      : "↓"
                    : ""}</span
                >
              </th>
              <th
                class="sortable"
                onclick={() => onSort("contactName")}
                style="cursor:pointer; user-select:none;"
              >
                <span class="th-inner">Supplier</span>
              </th>
              <th
                class="sortable"
                onclick={() => onSort("category")}
                style="cursor:pointer; user-select:none;"
              >
                <span class="th-inner">Category</span>
              </th>
              <th
                class="sortable"
                onclick={() => onSort("status")}
                style="cursor:pointer; user-select:none;"
              >
                <span class="th-inner">Status</span>
              </th>
              <th
                class="sortable"
                onclick={() => onSort("date")}
                style="cursor:pointer; user-select:none;"
              >
                <span class="th-inner">Date</span>
              </th>
              <th
                class="sortable ta-right"
                onclick={() => onSort("amount")}
                style="cursor:pointer; user-select:none;"
              >
                <span class="th-inner">Amount</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {#each filtered as e (e.id)}
              <tr
                class="exp-row"
                class:selected={selected.has(e.id)}
                onclick={() => openRecord(e)}
              >
                <td
                  class="td-check"
                  onclick={(ev) => {
                    ev.stopPropagation();
                    toggleOne(e.id);
                  }}
                >
                  <button
                    type="button"
                    style="width:17px; height:17px; border-radius:5px; border:1.5px solid {selected.has(
                      e.id,
                    )
                      ? 'var(--primary)'
                      : 'var(--border-strong)'}; background:{selected.has(e.id)
                      ? 'var(--primary)'
                      : 'var(--card)'}; display:grid; place-items:center; cursor:pointer; color:var(--primary-foreground); padding:0; flex-shrink:0;"
                    aria-label="Select {e.recordNumber ?? e.description}"
                  >
                    {#if selected.has(e.id)}<svg
                        width="10"
                        height="10"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="white"
                        stroke-width="3"><path d="M20 6 9 17l-5-5" /></svg
                      >{/if}
                  </button>
                </td>
                <td class="td-primary">
                  <div class="cell-item">
                    <span class="cell-itemname">
                      {e.description}
                      {#if e.locked}<span class="row-lock" title={e.lockedReason}
                          ><Lock size={11} /></span
                        >{/if}
                    </span>
                    <span class="cell-itemnum">{e.recordNumber ?? ""}</span>
                  </div>
                </td>
                <td class="td-supplier" data-label="Supplier"
                  >{e.contactName ?? ""}</td
                >
                <td data-label="Category">
                  <span
                    style="display:inline-flex; align-items:center; font-size:11.5px; background:var(--secondary); color:var(--secondary-foreground); padding:2px 9px; border-radius:999px; white-space:nowrap;"
                  >
                    {categoryName(e)}
                  </span>
                </td>
                <td class="td-status"
                  ><StatusBadge status={statusLabelFor(e)} /></td
                >
                <td class="td-date" data-label="Date">
                  {formatDateShort(e.date)}<span class="td-year"
                    >{e.date.slice(0, 4)}</span
                  >
                </td>
                <td class="td-amount" data-label="Amount">
                  <span class="amount-num"
                    >{mainCurrencySymbol()}
                    {formatMinorAmount(e.amountMinor)}</span
                  >
                  {#if e.currency !== mainCurrency()}
                    <span class="amount-orig"
                      >{e.currency}
                      {formatCurrencyAmount(e.amount, e.currency)}</span
                    >
                  {/if}
                </td>
                <td class="row-break"></td>
              </tr>
            {/each}
            {#if counts.all === 0}
              <tr class="empty-row">
                <td colspan="7">
                  <EmptyState
                    title="No expenses yet"
                    sub="Your expense history will appear here."
                  >
                    {#snippet icon()}<Wallet size={20} />{/snippet}
                  </EmptyState>
                </td>
              </tr>
            {:else if filtered.length === 0}
              <tr class="empty-row">
                <td colspan="7">
                  <EmptyState
                    title="No expenses match your filters"
                    sub="Try adjusting your search or filters."
                  >
                    {#snippet icon()}<Search size={20} />{/snippet}
                    {#snippet action()}<button
                        class="link-btn"
                        onclick={clearAllFilters}>Clear filters</button
                      >{/snippet}
                  </EmptyState>
                </td>
              </tr>
            {/if}
          </tbody>
        </table>
      </div>
      <div class="table-foot">
        <span>{filtered.length} of {counts.all} expenses</span>
        {#if data.total > records.length}
          <span class="muted"
            >Showing the {records.length} most recent of {data.total}</span
          >
        {:else}
          <span class="muted">Updated just now</span>
        {/if}
      </div>
    </div>
  </div>

  <!-- Bulk action bar -->
  <BulkActionBar
    show={selected.size > 0}
    count={selected.size}
    total={`${mainCurrencySymbol()} ${formatMinorAmount(selTotal)}`}
    onclear={clearSel}
  >
    {#snippet actions()}
      <!-- Recording one payment against several of these arrives with the
           payment screen (User Story 3); until then the only action that spans
           a selection is removing it. -->
      {#if data.perms.delete}
        <button
          type="button"
          class="bulk-actions-ghost"
          style="display:inline-flex; align-items:center; gap:6px; padding:5px 10px; border-radius:6px; font-family:inherit; font-size:13px; cursor:pointer;"
          onclick={() => (deleteDialogOpen = true)}
        >
          <Trash2 size={14} /> Delete
        </button>
      {/if}
    {/snippet}
  </BulkActionBar>
</div>

<ConfirmDialog
  bind:open={deleteDialogOpen}
  title={selected.size === 1 ? "Delete this expense?" : "Delete these expenses?"}
  description={lockedSelected > 0
    ? `${lockedSelected} of the ${selected.size} selected can't be deleted while a payment or a bank line still points at them — the rest will be removed. This can't be undone.`
    : `This removes ${selected.size} ${selected.size === 1 ? "expense" : "expenses"} and both sides of each. It can't be undone.`}
  confirmLabel="Delete"
  danger
  onConfirm={() => deleteFormEl?.requestSubmit()}
/>

<form
  method="POST"
  action="?/delete"
  bind:this={deleteFormEl}
  use:enhance={() =>
    async ({ update }) => {
      deleteDialogOpen = false;
      clearSel();
      await update();
    }}
  style="display:none"
>
  <input type="hidden" name="ids" value={[...selected].join(",")} />
</form>

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
          <span>Category</span>
          {#if selectedCats.length}<button
              onclick={() => (selectedCats = [])}
              style="border:none; background:none; color:var(--primary); cursor:pointer; font-size:11px; font-weight:600;"
              >Clear</button
            >{/if}
        </div>
        <div style="display:flex; flex-wrap:wrap; gap:7px;">
          {#each data.categories as cat (cat.id)}
            <button
              onclick={() => toggleCat(cat.id)}
              style="border:1px solid {selectedCats.includes(cat.id)
                ? 'var(--primary)'
                : 'var(--border)'}; background:{selectedCats.includes(cat.id)
                ? 'var(--primary-soft)'
                : 'var(--card)'}; color:{selectedCats.includes(cat.id)
                ? 'var(--primary)'
                : 'var(--foreground)'}; font-family:inherit; font-size:13px; padding:5px 12px; border-radius:999px; cursor:pointer;"
              >{cat.name}</button
            >
          {/each}
        </div>
      </div>
      <div style="margin-bottom:16px;">
        <div
          style="font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.04em; color:var(--muted-foreground); margin-bottom:10px; display:flex; align-items:center; justify-content:space-between;"
        >
          <span>Date range</span>
          {#if dateFrom || dateTo}<button
              onclick={() => {
                dateFrom = "";
                dateTo = "";
              }}
              style="border:none; background:none; color:var(--primary); cursor:pointer; font-size:11px; font-weight:600;"
              >Clear</button
            >{/if}
        </div>
        <div style="display:flex; flex-direction:column; gap:8px;">
          <span style="font-size:11.5px; color:var(--muted-foreground);"
            >From</span
          >
          <DatePicker bind:value={dateFrom} placeholder="From date" />
          <span style="font-size:11.5px; color:var(--muted-foreground);"
            >To</span
          >
          <DatePicker bind:value={dateTo} placeholder="To date" />
        </div>
      </div>
      <div style="margin-bottom:20px;">
        <div
          style="font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.04em; color:var(--muted-foreground); margin-bottom:10px; display:flex; align-items:center; justify-content:space-between;"
        >
          <span>Amount range</span>
          {#if amountMin || amountMax}<button
              onclick={() => {
                amountMin = "";
                amountMax = "";
              }}
              style="border:none; background:none; color:var(--primary); cursor:pointer; font-size:11px; font-weight:600;"
              >Clear</button
            >{/if}
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <AmountInput
            wrapperStyle="flex:1;"
            placeholder="Min"
            bind:value={amountMin}
            style="flex:1;"
          />
          <span style="color:var(--muted-foreground);">–</span>
          <AmountInput
            wrapperStyle="flex:1;"
            placeholder="Max"
            bind:value={amountMax}
            style="flex:1;"
          />
        </div>
      </div>
      <Button class="w-full" onclick={() => (mobileFilterOpen = false)}>
        Show results
      </Button>
    </Sheet.Content>
  </Sheet.Portal>
</Sheet.Root>

<!-- Record detail -->
<RecordSheet
  open={detailRecord !== null}
  record={detailRecord}
  kind="expense"
  accounts={data.accounts}
  categories={data.categories}
  contacts={data.contacts}
  defaultAccountId={data.defaultAccountId}
  lastForeignCurrency={data.lastForeignCurrency}
  canChange={data.perms.change}
  canDelete={data.perms.delete}
  onclose={closeDetail}
/>

<!-- Paying somebody back -->
<PaymentSheet
  open={showPayment}
  direction="we-pay"
  accounts={data.accounts}
  contacts={data.contacts}
  defaultAccountId={data.defaultAccountId}
  contactId={payContactId}
  onclose={() => (showPayment = false)}
  onsaved={() => loadOwed()}
/>

<!-- New expense -->
<RecordSheet
  open={showNew}
  record={null}
  kind="expense"
  accounts={data.accounts}
  categories={data.categories}
  contacts={data.contacts}
  defaultAccountId={data.defaultAccountId}
  lastForeignCurrency={data.lastForeignCurrency}
  canChange={data.perms.change}
  onclose={() => (showNew = false)}
/>

<style>
  .page-error {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    background: var(--red-soft);
    color: var(--red);
    border-radius: 8px;
    padding: 10px 14px;
    font-size: 13px;
    margin-bottom: 12px;
  }
  .page-error button {
    display: flex;
    border: none;
    background: none;
    color: inherit;
    cursor: pointer;
    padding: 0;
  }

  .cat-option {
    display: flex;
    align-items: center;
    gap: 9px;
    width: 100%;
    border: none;
    background: none;
    font-family: inherit;
    font-size: 13px;
    color: var(--foreground);
    padding: 7px 8px;
    border-radius: 7px;
    cursor: pointer;
    text-align: left;
  }
  .cat-option:hover,
  .cat-option:focus-visible {
    background: var(--accent);
  }
  .cat-box {
    width: 16px;
    height: 16px;
    border-radius: 4px;
    border: 1.5px solid var(--border-strong);
    background: var(--card);
    display: grid;
    place-items: center;
    flex-shrink: 0;
  }
  .cat-option.on .cat-box {
    border-color: var(--primary);
    background: var(--primary);
  }

  .row-lock {
    display: inline-flex;
    vertical-align: middle;
    margin-left: 5px;
    color: var(--muted-foreground);
  }

  /* Who is owed, and how much is left */
  .owed-panel {
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--card);
    margin-bottom: 12px;
    overflow: hidden;
  }
  .owed-head {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 12px 14px;
    border: none;
    background: none;
    font-family: inherit;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }
  .owed-head-main {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }
  .owed-head-title {
    font-size: 13.5px;
    font-weight: 600;
  }
  .owed-head-sub {
    font-size: 11.5px;
    color: var(--muted-foreground);
  }
  .owed-head-total {
    font-size: 14px;
    font-weight: 600;
    white-space: nowrap;
  }
  .owed-body {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 0 14px 14px;
  }
  .owed-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .owed-group-head {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .owed-group-name {
    font-size: 12.5px;
    font-weight: 600;
    flex: 1;
    min-width: 0;
  }
  .owed-group-total {
    font-size: 12.5px;
    font-weight: 600;
    white-space: nowrap;
  }
  .owed-pay-btn {
    border: 1px solid var(--border);
    background: var(--card);
    border-radius: 7px;
    padding: 3px 9px;
    font-family: inherit;
    font-size: 11.5px;
    color: var(--foreground);
    cursor: pointer;
    white-space: nowrap;
  }
  .owed-pay-btn:hover {
    border-color: var(--primary);
    color: var(--primary);
  }
  .owed-row {
    display: flex;
    align-items: center;
    gap: 11px;
    width: 100%;
    border: 1px solid var(--border);
    border-radius: 9px;
    padding: 8px 12px;
    background: var(--card);
    font-family: inherit;
    color: inherit;
    text-align: left;
  }
  .owed-row-main {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }
  .owed-row-name {
    font-size: 13px;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .owed-row-sub {
    font-size: 11.5px;
    color: var(--muted-foreground);
  }
  .owed-row-amt {
    font-size: 13px;
    font-weight: 600;
    white-space: nowrap;
  }

  @media (max-width: 767px) {
    /* Status leads, then category chip, then supplier text, then date */
    td[data-label="Category"] {
      order: 6 !important;
    }
    .td-supplier {
      order: 7 !important;
    }
    .td-date {
      order: 8 !important;
    }
  }
</style>
