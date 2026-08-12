<script lang="ts">
  import {
    beforeNavigate,
    goto,
    invalidateAll,
    replaceState,
  } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import { SvelteURLSearchParams } from "svelte/reactivity";
  import {
    ArrowDownLeft,
    ArrowUpRight,
    Banknote,
    Check,
    ChevronRight,
    CircleDollarSign,
    FileText,
    ExternalLink,
    Plus,
    Search,
    SlidersHorizontal,
    Trash2,
    Upload,
    X,
  } from "@lucide/svelte";
  import { toast } from "svelte-sonner";
  import * as Sheet from "$lib/components/ui/sheet/index.js";
  import ConfirmDialog from "$lib/components/ui/ConfirmDialog.svelte";
  import EmptyState from "$lib/components/ui/EmptyState.svelte";
  import StatCard from "$lib/components/ui/StatCard.svelte";
  import StatusBadge from "$lib/components/ui/StatusBadge.svelte";
  import {
    ReconItemType,
    ReconItemTypeLabels,
    StatementDirection,
    StatementExtractionState,
  } from "$lib/enums.js";
  import { mainCurrencySymbol } from "$lib/currency-state.svelte.js";
  import { formatDate, formatMoney } from "$lib/format.js";
  import { useIsMobile } from "$lib/hooks/useIsMobile.svelte.js";
  import { createResourceStream } from "$lib/sse.js";
  import type { loadReconciliationPage } from "$lib/server/loaders/reconciliation.js";

  type Data = ReturnType<typeof loadReconciliationPage>;
  type RecordRow = Data["records"][number];
  type Statement = Data["statements"][number];
  type StatementLine = Data["lines"][number];
  type Draft = { lineId: number; amount: number };
  type Tab = "records" | "statements";
  type RecordFilter = "review" | "matched";
  type StatementFilter = "active" | "completed";

  let { data }: { data: Data } = $props();
  const screen = useIsMobile();
  const isMobile = $derived(screen.current);
  const workspaceScreen = useIsMobile("(max-width: 1000px)");
  const compactWorkspace = $derived(workspaceScreen.current);
  const panelSide = $derived(isMobile ? "bottom" : "right");
  let tab = $state<Tab>(
    page.url.searchParams.get("tab") === "statements"
      ? "statements"
      : "records",
  );
  let recordFilter = $state<RecordFilter>(
    page.url.searchParams.get("filter") === "matched" ? "matched" : "review",
  );
  let statementFilter = $state<StatementFilter>(
    page.url.searchParams.get("status") === "completed"
      ? "completed"
      : "active",
  );
  let query = $state(page.url.searchParams.get("q") ?? "");
  let from = $state(page.url.searchParams.get("from") ?? "");
  let to = $state(page.url.searchParams.get("to") ?? "");
  let selectedKey = $state(page.url.searchParams.get("record") ?? "");
  let selectedRecord = $state<RecordRow | null>(null);
  let selectedStatementId = $state(
    Number(page.url.searchParams.get("statement")) || null,
  );
  let drafts = $state<Draft[]>([]);
  let savedDrafts = $state<Draft[]>([]);
  let saving = $state(false);
  let uploadInput = $state<HTMLInputElement | null>(null);
  let deleteStatementOpen = $state(false);
  let deleteLineOpen = $state(false);
  let pendingLineId = $state<number | null>(null);
  let discardOpen = $state(false);
  let deferredAction = $state<(() => void) | null>(null);
  let editingLineId = $state<number | null>(null);

  const selectedStatement = $derived(
    data.statements.find((statement) => statement.id === selectedStatementId) ??
      null,
  );
  const selectedStatementLines = $derived(
    data.lines.filter((line) => line.statementId === selectedStatementId),
  );
  const reviewRecords = $derived(
    data.records.filter(
      (record) => Math.abs(record.remainingAmount ?? 0) >= 0.005,
    ),
  );
  const matchedRecords = $derived(
    data.records.filter(
      (record) => Math.abs(record.remainingAmount ?? 0) < 0.005,
    ),
  );
  const partialCount = $derived(
    reviewRecords.filter((record) => (record.allocatedAmount ?? 0) >= 0.005)
      .length,
  );
  const activeStatements = $derived(
    data.statements.filter((statement) => !statement.completed),
  );
  const bankRemaining = $derived(
    data.lines.reduce(
      (sum, line) => sum + Math.max(0, line.remainingAmount),
      0,
    ),
  );
  const visibleRecords = $derived.by(() => {
    const source = recordFilter === "matched" ? matchedRecords : reviewRecords;
    const normalized = query.trim().toLocaleLowerCase();
    return source.filter(
      (record) =>
        !normalized ||
        `${record.label} ${record.contactName ?? ""} ${typeLabel(record.itemType)}`
          .toLocaleLowerCase()
          .includes(normalized),
    );
  });
  const visibleStatements = $derived.by(() => {
    const source =
      statementFilter === "completed"
        ? data.statements.filter((statement) => statement.completed)
        : activeStatements;
    const normalized = query.trim().toLocaleLowerCase();
    return source.filter(
      (statement) =>
        !normalized ||
        statement.originalFilename.toLocaleLowerCase().includes(normalized),
    );
  });
  const savedAllocations = $derived.by(() => {
    const record = selectedRecord;
    return record
      ? data.allocations.filter(
          (allocation) =>
            allocation.itemType === record.itemType &&
            allocation.itemId === record.itemId,
        )
      : [];
  });
  const compatibleLines = $derived.by(() => {
    if (!selectedRecord) return [];
    const direction =
      selectedRecord.itemType === ReconItemType.Income
        ? StatementDirection.In
        : StatementDirection.Out;
    const savedIds = new Set(
      savedAllocations.map((allocation) => allocation.lineId),
    );
    return data.lines.filter(
      (line) =>
        line.direction === direction &&
        (line.remainingAmount >= 0.005 || savedIds.has(line.id)),
    );
  });
  const availableLines = $derived.by(() => {
    if (!selectedRecord) return [];
    const savedIds = new Set(
      savedAllocations.map((allocation) => allocation.lineId),
    );
    const compatibleIds = new Set(compatibleLines.map((line) => line.id));
    return data.lines
      .filter((line) => line.remainingAmount >= 0.005 || savedIds.has(line.id))
      .toSorted((left, right) => {
        const directionRank =
          Number(compatibleIds.has(right.id)) -
          Number(compatibleIds.has(left.id));
        return directionRank || right.date.localeCompare(left.date);
      });
  });
  const draftTotal = $derived(
    Math.round(
      drafts.reduce((sum, draft) => sum + Number(draft.amount || 0), 0) * 100,
    ) / 100,
  );
  const recordTotal = $derived(
    selectedRecord
      ? Math.round(selectedRecord.amount * selectedRecord.exchangeRate * 100) /
          100
      : 0,
  );
  const draftRemaining = $derived(
    Math.round((recordTotal - draftTotal) * 100) / 100,
  );
  const dirty = $derived(
    JSON.stringify(normalizeDrafts(drafts)) !==
      JSON.stringify(normalizeDrafts(savedDrafts)),
  );
  const hasSuggestion = $derived(
    !!selectedRecord?.suggestedLineIds.length && savedAllocations.length === 0,
  );

  $effect(() => {
    const records = data.records;
    const key = selectedKey;
    if (!key) return;
    const refreshed = records.find((record) => recordKey(record) === key);
    if (refreshed) selectedRecord = refreshed;
  });

  createResourceStream<{ type: string }>(
    "/api/reconciliation/stream",
    (event) => {
      if (event.type !== "snapshot") void invalidateAll();
    },
  );

  function recordKey(record: Pick<RecordRow, "itemType" | "itemId">) {
    return `${record.itemType}:${record.itemId}`;
  }
  function typeLabel(type: number) {
    const value = ReconItemTypeLabels[type] ?? "record";
    return value[0].toUpperCase() + value.slice(1);
  }
  function normalizeDrafts(value: Draft[]) {
    return value
      .map((draft) => ({ lineId: draft.lineId, amount: Number(draft.amount) }))
      .sort((a, b) => a.lineId - b.lineId);
  }
  function statusLabel(statement: Statement) {
    if (statement.extractionState === StatementExtractionState.Extracting)
      return "extracting";
    if (statement.extractionState === StatementExtractionState.Failed)
      return "failed";
    return statement.completed ? "matched" : "active";
  }
  function updateUrl() {
    const params = new SvelteURLSearchParams({
      tab,
      filter: recordFilter,
      status: statementFilter,
    });
    if (query) params.set("q", query);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (selectedKey) params.set("record", selectedKey);
    if (selectedStatementId)
      params.set("statement", String(selectedStatementId));
    // eslint-disable-next-line svelte/no-navigation-without-resolve -- route is resolved; only query state is appended.
    replaceState(`${resolve("/reconciliation")}?${params}`, page.state);
  }
  function guard(action: () => void) {
    if (!dirty) return action();
    deferredAction = action;
    discardOpen = true;
  }
  function confirmDiscard() {
    drafts = [...savedDrafts];
    discardOpen = false;
    const action = deferredAction;
    deferredAction = null;
    action?.();
  }
  function loadRecord(record: RecordRow) {
    selectedKey = recordKey(record);
    selectedRecord = record;
    const saved = data.allocations
      .filter(
        (allocation) =>
          allocation.itemType === record.itemType &&
          allocation.itemId === record.itemId,
      )
      .map((allocation) => ({
        lineId: allocation.lineId,
        amount: allocation.amount,
      }));
    drafts = saved;
    savedDrafts = [...saved];
    updateUrl();
  }
  function chooseRecord(record: RecordRow) {
    guard(() => loadRecord(record));
  }
  function closeRecord() {
    guard(() => {
      selectedKey = "";
      selectedRecord = null;
      drafts = [];
      savedDrafts = [];
      updateUrl();
    });
  }
  function chooseStatement(statement: Statement) {
    selectedStatementId = statement.id;
    editingLineId = null;
    updateUrl();
  }
  function closeStatement() {
    selectedStatementId = null;
    editingLineId = null;
    updateUrl();
  }
  function setTab(value: Tab) {
    guard(() => {
      tab = value;
      query = "";
      selectedKey = "";
      selectedRecord = null;
      drafts = [];
      savedDrafts = [];
      selectedStatementId = null;
      updateUrl();
    });
  }
  function toggleLine(line: StatementLine) {
    const existing = drafts.find((draft) => draft.lineId === line.id);
    if (existing) {
      drafts = drafts.filter((draft) => draft.lineId !== line.id);
      return;
    }
    const savedHere =
      savedAllocations.find((allocation) => allocation.lineId === line.id)
        ?.amount ?? 0;
    const available = line.remainingAmount + savedHere;
    const remaining = Math.max(0, recordTotal - draftTotal);
    drafts = [
      ...drafts,
      { lineId: line.id, amount: Math.min(available, remaining || available) },
    ];
  }
  function updateDraft(lineId: number, value: string) {
    drafts = drafts.map((draft) =>
      draft.lineId === lineId ? { ...draft, amount: Number(value) } : draft,
    );
  }
  function applySuggestion() {
    if (!selectedRecord) return;
    let remaining = recordTotal;
    drafts = selectedRecord.suggestedLineIds.map((lineId) => {
      const line = compatibleLines.find(
        (candidate) => candidate.id === lineId,
      )!;
      const amount = Math.min(line.remainingAmount, remaining);
      remaining = Math.round((remaining - amount) * 100) / 100;
      return { lineId, amount };
    });
  }
  async function saveAllocations() {
    if (!selectedRecord || saving || draftRemaining < -0.005) return;
    saving = true;
    const response = await fetch(
      `/api/reconciliation/records/${selectedRecord.itemType}/${selectedRecord.itemId}/allocations`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ allocations: drafts }),
      },
    ).catch(() => null);
    saving = false;
    if (!response?.ok) {
      const result = await response?.json().catch(() => null);
      toast.error(
        result?.error ??
          "Allocations could not be saved. Check the available amounts and try again.",
      );
      return;
    }
    savedDrafts = [...drafts];
    toast.success("Allocations saved");
    await invalidateAll();
  }
  async function upload(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    const form = new FormData();
    form.set("file", file);
    const response = await fetch("/api/reconciliation/statements", {
      method: "POST",
      body: form,
    }).catch(() => null);
    if (!response?.ok) {
      const result = await response?.json().catch(() => null);
      toast.error(
        result?.error ??
          "Statement upload failed. Choose a PDF, JPEG, or PNG under 15 MB.",
      );
      return;
    }
    toast.success("Statement extraction started");
    tab = "statements";
    statementFilter = "active";
    updateUrl();
    await invalidateAll();
  }
  async function editLine(line: StatementLine, field: string, value: string) {
    const numeric = field === "amount" || field === "direction";
    const response = await fetch(`/api/reconciliation/lines/${line.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ [field]: numeric ? Number(value) : value }),
    });
    if (!response.ok) {
      const result = await response.json().catch(() => null);
      toast.error(result?.error ?? "Statement line could not be updated.");
      return;
    }
    toast.success("Statement line updated");
    await invalidateAll();
  }
  async function deleteStatement() {
    if (!selectedStatementId) return;
    const response = await fetch(
      `/api/reconciliation/statements/${selectedStatementId}`,
      { method: "DELETE" },
    );
    if (!response.ok)
      return toast.error("Statement could not be deleted. Try again.");
    deleteStatementOpen = false;
    closeStatement();
    toast.success("Statement deleted");
    await invalidateAll();
  }
  async function deleteLine() {
    if (!pendingLineId) return;
    const response = await fetch(`/api/reconciliation/lines/${pendingLineId}`, {
      method: "DELETE",
    });
    if (!response.ok)
      return toast.error("Statement line could not be deleted. Try again.");
    deleteLineOpen = false;
    pendingLineId = null;
    toast.success("Statement line deleted");
    await invalidateAll();
  }

  beforeNavigate((navigation) => {
    if (dirty) {
      navigation.cancel();
      if (navigation.to?.url) {
        const destination = navigation.to.url;
        // eslint-disable-next-line svelte/no-navigation-without-resolve -- destination already comes from SvelteKit's resolved navigation target.
        deferredAction = () => void goto(destination);
      }
      discardOpen = true;
    }
  });
</script>

<svelte:window
  onbeforeunload={(event) => {
    if (dirty) event.preventDefault();
  }}
/>
<svelte:head><title>Reconciliation - Akaun</title></svelte:head>

<div class="screen reconciliation-screen">
  <header class="topbar">
    <div class="topbar-left">
      <h1 class="page-title">Reconciliation</h1>
      <p class="page-sub">
        {reviewRecords.length} record{reviewRecords.length === 1 ? "" : "s"} need
        review · <span class="num">{formatMoney(bankRemaining)}</span> unallocated
      </p>
    </div>
    <div class="topbar-right">
      <div class="search-box recon-search">
        <Search size={15} aria-hidden="true" /><input
          name="reconciliation-search"
          type="search"
          autocomplete="off"
          placeholder={tab === "records"
            ? "Search Akaun records…"
            : "Search statements…"}
          bind:value={query}
          oninput={updateUrl}
          aria-label={tab === "records"
            ? "Search Akaun records"
            : "Search bank statements"}
        />
      </div>
      {#if data.permissions.add}<input
          bind:this={uploadInput}
          class="sr-only"
          type="file"
          accept="application/pdf,image/png,image/jpeg"
          onchange={upload}
          aria-label="Choose bank statement"
        /><button
          class="primary-action"
          type="button"
          onclick={() => uploadInput?.click()}
          ><Upload size={15} aria-hidden="true" /><span>Upload Statement</span
          ></button
        >{/if}
    </div>
  </header>

  <div class="stat-strip recon-stats">
    <StatCard
      tone="amber"
      label="Needs Review"
      value={String(reviewRecords.length)}
      sub="Unmatched or partial"
    />
    <StatCard
      label="Partially Matched"
      value={String(partialCount)}
      sub="Allocation started"
    />
    <StatCard
      tone="green"
      label="Active Statements"
      value={String(activeStatements.length)}
      sub="With remaining lines"
    />
    <StatCard
      label="Unallocated Bank"
      cur={mainCurrencySymbol()}
      value={formatMoney(bankRemaining)}
      sub={`${data.lines.filter((line) => line.remainingAmount >= 0.005).length} statement lines`}
    />
  </div>

  <div class="module-tabs" role="tablist" aria-label="Reconciliation areas">
    <button
      type="button"
      role="tab"
      aria-selected={tab === "records"}
      class:active={tab === "records"}
      onclick={() => setTab("records")}
      ><CircleDollarSign size={15} aria-hidden="true" />Akaun Records</button
    ><button
      type="button"
      role="tab"
      aria-selected={tab === "statements"}
      class:active={tab === "statements"}
      onclick={() => setTab("statements")}
      ><FileText size={15} aria-hidden="true" />Bank Statements</button
    >
  </div>

  <div class="work">
    <div class="work-main recon-work">
      {#if tab === "records"}
        <div class="toolbar">
          <div class="status-tabs">
            <button
              class="status-tab"
              class:active={recordFilter === "review"}
              type="button"
              onclick={() => {
                recordFilter = "review";
                updateUrl();
              }}
              >Needs Review <span class="tab-count">{reviewRecords.length}</span
              ></button
            ><button
              class="status-tab"
              class:active={recordFilter === "matched"}
              type="button"
              onclick={() => {
                recordFilter = "matched";
                updateUrl();
              }}
              >Matched <span class="tab-count">{matchedRecords.length}</span
              ></button
            >
          </div>
          <div class="date-filters">
            <SlidersHorizontal size={14} aria-hidden="true" /><label
              >From <input
                name="reconciliation-from"
                type="date"
                autocomplete="off"
                bind:value={from}
                onchange={() => {
                  updateUrl();
                  void invalidateAll();
                }}
              /></label
            ><label
              >To <input
                name="reconciliation-to"
                type="date"
                autocomplete="off"
                bind:value={to}
                onchange={() => {
                  updateUrl();
                  void invalidateAll();
                }}
              /></label
            >{#if from || to}<button
                class="clear-filter"
                type="button"
                onclick={() => {
                  from = "";
                  to = "";
                  updateUrl();
                  void invalidateAll();
                }}><X size={13} aria-hidden="true" />Clear</button
              >{/if}
          </div>
        </div>
        <div class="split-workspace">
          <div class="record-pane">
            <div class="table-card">
              <table class="exp-table">
                <thead
                  ><tr
                    ><th>Record</th><th>Type</th><th>Date</th><th
                      class="ta-right">Total</th
                    ><th class="ta-right">Remaining</th><th aria-label="Open"
                    ></th></tr
                  ></thead
                ><tbody
                  >{#each visibleRecords as record (recordKey(record))}<tr
                      class="exp-row"
                      class:selected={recordKey(record) === selectedKey}
                      tabindex="0"
                      onclick={() => chooseRecord(record)}
                      onkeydown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          chooseRecord(record);
                        }
                      }}
                      ><td class="td-primary"
                        ><div class="cell-item">
                          <span class="cell-itemname">{record.label}</span><span
                            class="cell-itemnum"
                            >{record.contactName || "No contact"}</span
                          >
                        </div></td
                      ><td data-label="Type"
                        ><span class="type-chip"
                          >{typeLabel(record.itemType)}</span
                        ></td
                      ><td class="td-date" data-label="Date"
                        >{formatDate(record.date)}</td
                      ><td class="td-amount" data-label="Total"
                        ><span class="amount-num"
                          >{formatMoney(
                            record.amount * record.exchangeRate,
                          )}</span
                        ></td
                      ><td class="td-amount remaining" data-label="Remaining"
                        ><span class="amount-num"
                          >{formatMoney(record.remainingAmount ?? 0)}</span
                        ></td
                      ><td class="td-chevron"
                        ><ChevronRight size={15} aria-hidden="true" /></td
                      ><td class="row-break"></td></tr
                    >{/each}{#if visibleRecords.length === 0}<tr
                      class="empty-row"
                      ><td colspan="6"
                        ><EmptyState
                          title={recordFilter === "review"
                            ? "All records are matched"
                            : "No matched records yet"}
                          sub={recordFilter === "review"
                            ? "Every eligible Akaun record in this date range is fully allocated."
                            : "Fully allocated records will appear here for audit and correction."}
                          >{#snippet icon()}{#if recordFilter === "review"}<Check
                                size={20}
                              />{:else}<Banknote
                                size={20}
                              />{/if}{/snippet}</EmptyState
                        ></td
                      ></tr
                    >{/if}</tbody
                >
              </table>
            </div>
            <div class="table-foot">
              <span
                >Showing <b>{visibleRecords.length}</b> of {recordFilter ===
                "review"
                  ? reviewRecords.length
                  : matchedRecords.length}</span
              >
            </div>
          </div>
          <div class="desktop-composer">
            {#if selectedRecord}{@render AllocationComposer()}{:else}<EmptyState
                title="Select an Akaun record"
                sub="Choose a record to review compatible bank transactions and stage allocations."
                >{#snippet icon()}<CircleDollarSign
                    size={20}
                  />{/snippet}</EmptyState
              >{/if}
          </div>
        </div>
      {:else}
        <div class="toolbar">
          <div class="status-tabs">
            <button
              class="status-tab"
              class:active={statementFilter === "active"}
              type="button"
              onclick={() => {
                statementFilter = "active";
                updateUrl();
              }}
              >Active <span class="tab-count">{activeStatements.length}</span
              ></button
            ><button
              class="status-tab"
              class:active={statementFilter === "completed"}
              type="button"
              onclick={() => {
                statementFilter = "completed";
                updateUrl();
              }}
              >Completed <span class="tab-count"
                >{data.statements.length - activeStatements.length}</span
              ></button
            >
          </div>
        </div>
        <div class="table-card">
          <table class="exp-table">
            <thead
              ><tr
                ><th>Statement</th><th>Date Range</th><th>Status</th><th
                  >Matched</th
                ><th class="ta-right">Remaining</th><th aria-label="Open"
                ></th></tr
              ></thead
            ><tbody
              >{#each visibleStatements as statement (statement.id)}<tr
                  class="exp-row"
                  tabindex="0"
                  onclick={() => chooseStatement(statement)}
                  onkeydown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      chooseStatement(statement);
                    }
                  }}
                  ><td class="td-primary"
                    ><div class="cell-item">
                      <span
                        class="cell-itemname filename"
                        title={statement.originalFilename}
                        >{statement.originalFilename}</span
                      ><span class="cell-itemnum"
                        >Uploaded {formatDate(
                          statement.createdAt.slice(0, 10),
                        )}</span
                      >
                    </div></td
                  ><td class="td-date" data-label="Date Range"
                    >{statement.dateFrom && statement.dateTo
                      ? `${formatDate(statement.dateFrom)} – ${formatDate(statement.dateTo)}`
                      : "No transactions"}</td
                  ><td data-label="Status"
                    ><StatusBadge status={statusLabel(statement)} /></td
                  ><td data-label="Matched"
                    ><span class="num"
                      >{statement.matchedCount} / {statement.totalLines}</span
                    ></td
                  ><td class="td-amount" data-label="Remaining"
                    ><span class="amount-num"
                      >{formatMoney(statement.remainingAmount)}</span
                    ></td
                  ><td class="td-chevron"
                    ><ChevronRight size={15} aria-hidden="true" /></td
                  ><td class="row-break"></td></tr
                >{/each}{#if visibleStatements.length === 0}<tr
                  class="empty-row"
                  ><td colspan="6"
                    ><EmptyState
                      title={statementFilter === "active"
                        ? "No active statements"
                        : "No completed statements"}
                      sub={statementFilter === "active"
                        ? "Upload a bank statement to extract transactions and start matching."
                        : "Statements move here automatically when every line is fully allocated."}
                      >{#snippet icon()}<FileText
                          size={20}
                        />{/snippet}{#snippet action()}{#if statementFilter === "active" && data.permissions.add}<button
                            class="sheet-btn-primary compact"
                            type="button"
                            onclick={() => uploadInput?.click()}
                            ><Plus size={14} />Upload Statement</button
                          >{/if}{/snippet}</EmptyState
                    ></td
                  ></tr
                >{/if}</tbody
            >
          </table>
        </div>
        <div class="table-foot">
          <span
            >{visibleStatements.length} statement{visibleStatements.length === 1
              ? ""
              : "s"}</span
          >
        </div>
      {/if}
    </div>
  </div>
</div>

{#snippet AllocationComposer()}
  {#if selectedRecord}<section
      class="composer"
      aria-label={`Allocate ${selectedRecord.label}`}
    >
      <header class="composer-head">
        <div
          class="type-icon"
          class:income={selectedRecord.itemType === ReconItemType.Income}
        >
          {#if selectedRecord.itemType === ReconItemType.Income}<ArrowDownLeft
              size={17}
            />{:else}<ArrowUpRight size={17} />{/if}
        </div>
        <div class="composer-title">
          <span>{typeLabel(selectedRecord.itemType)}</span>
          <h2>{selectedRecord.label}</h2>
          <p>{selectedRecord.contactName || formatDate(selectedRecord.date)}</p>
        </div>
        {#if compactWorkspace}<button
            class="icon-btn"
            type="button"
            aria-label="Close allocation composer"
            onclick={closeRecord}><X size={16} /></button
          >{/if}
      </header>
      <div class="amount-strip">
        <div><span>Total</span><strong>{formatMoney(recordTotal)}</strong></div>
        <div><span>Staged</span><strong>{formatMoney(draftTotal)}</strong></div>
        <div
          class:balanced={Math.abs(draftRemaining) < 0.005}
          class:error={draftRemaining < -0.005}
        >
          <span>Remaining</span><strong>{formatMoney(draftRemaining)}</strong>
        </div>
      </div>
      <div class="composer-body">
        {#if hasSuggestion}<div class="suggestion">
            <div>
              <strong>Exact Match Found</strong><span
                >{selectedRecord.suggestedLineIds.length} transaction{selectedRecord
                  .suggestedLineIds.length === 1
                  ? ""
                  : "s"} total exactly {formatMoney(recordTotal)}.</span
              >
            </div>
            <button type="button" onclick={applySuggestion}
              >Apply Suggestion</button
            >
          </div>{/if}
        <div class="section-heading">
          <div>
            <h3>Compatible Statement Lines</h3>
            <p>
              {selectedRecord.itemType === ReconItemType.Income
                ? "Money In"
                : "Money Out"} transactions with available balance
            </p>
          </div>
          <span>{availableLines.length}</span>
        </div>
        <div class="line-list">
          {#each availableLines as line (line.id)}{@const draft = drafts.find(
              (item) => item.lineId === line.id,
            )}{@const savedHere =
              savedAllocations.find(
                (allocation) => allocation.lineId === line.id,
              )?.amount ?? 0}{@const compatible = compatibleLines.some(
              (candidate) => candidate.id === line.id,
            )}
            <div
              class="allocation-line"
              class:selected={!!draft}
              class:incompatible={!compatible}
            >
              <label class="line-select"
                ><input
                  type="checkbox"
                  checked={!!draft}
                  disabled={!compatible}
                  onchange={() => toggleLine(line)}
                /><span class="fake-check"
                  >{#if draft}<Check size={12} />{/if}</span
                ><span class="line-copy"
                  ><strong title={line.description}
                    >{line.description || "Statement transaction"}</strong
                  ><small
                    ><span title={line.statementFilename}
                      >{line.statementFilename}</span
                    >
                    · {formatDate(line.date)}{#if !compatible}
                      · Wrong money direction
                    {/if}</small
                  ></span
                ></label
              >
              <div class="line-money">
                <small
                  >{formatMoney(line.remainingAmount + savedHere)} available</small
                >{#if draft}<label
                    ><span class="sr-only"
                      >Allocation amount for {line.description}</span
                    ><span>{mainCurrencySymbol()}</span><input
                      name={`allocation-${line.id}`}
                      type="number"
                      inputmode="decimal"
                      min="0.01"
                      step="0.01"
                      max={line.remainingAmount + savedHere}
                      value={draft.amount}
                      onchange={(event) =>
                        updateDraft(line.id, event.currentTarget.value)}
                    /></label
                  >{:else}<strong>{formatMoney(line.amount)}</strong>{/if}
              </div>
            </div>{/each}{#if availableLines.length === 0}<EmptyState
              title="No statement transactions"
              sub="Upload a statement containing transactions with an available balance."
              >{#snippet icon()}<Banknote size={20} />{/snippet}</EmptyState
            >{/if}
        </div>
      </div>
      <footer class="composer-foot">
        <div>
          <span>Staged total</span><strong>{formatMoney(draftTotal)}</strong
          ><small class:error={draftRemaining < -0.005}
            >{draftRemaining < -0.005
              ? `${formatMoney(Math.abs(draftRemaining))} over record total`
              : `${formatMoney(draftRemaining)} remaining`}</small
          >
        </div>
        <div class="composer-actions">
          <button
            class="sheet-btn"
            type="button"
            disabled={!dirty || saving}
            onclick={() => (drafts = [...savedDrafts])}>Reset</button
          ><button
            class="sheet-btn-primary"
            type="button"
            disabled={!data.permissions.change ||
              saving ||
              !dirty ||
              draftRemaining < -0.005}
            onclick={saveAllocations}
            >{saving ? "Saving…" : "Save Allocations"}</button
          >
        </div>
      </footer>
    </section>{/if}
{/snippet}

<Sheet.Root
  open={compactWorkspace && !!selectedRecord}
  onOpenChange={(open) => {
    if (!open) closeRecord();
  }}
  ><Sheet.Content
    side={panelSide}
    class="recon-sheet mobile-composer-sheet"
    style="gap:0; width:500px; max-width:95vw; height:100dvh; border-radius:0;"
    >{@render AllocationComposer()}</Sheet.Content
  ></Sheet.Root
>

<Sheet.Root
  open={!!selectedStatement}
  onOpenChange={(open) => {
    if (!open) closeStatement();
  }}
  ><Sheet.Content
    side={panelSide}
    class="recon-sheet statement-sheet"
    style="gap:0; width:560px; max-width:95vw; height:100dvh; border-radius:0;"
    ><div class="sheet-head">
      <div>
        <span class="sheet-eyebrow"><FileText size={13} />Bank Statement</span>
        <h2
          class="sheet-title-text"
          title={selectedStatement?.originalFilename}
        >
          {selectedStatement?.originalFilename}
        </h2>
      </div>
      <Sheet.Close class="sheet-close" aria-label="Close statement"
        ><X size={16} /></Sheet.Close
      >
    </div>
    {#if selectedStatement}<div class="statement-body">
        <div class="statement-status">
          <StatusBadge status={statusLabel(selectedStatement)} /><span
            >{selectedStatement.dateFrom && selectedStatement.dateTo
              ? `${formatDate(selectedStatement.dateFrom)} – ${formatDate(selectedStatement.dateTo)}`
              : "Waiting for transactions"}</span
          >
        </div>
        <div class="statement-stats">
          <div>
            <strong>{selectedStatement.totalLines}</strong><span
              >Total Lines</span
            >
          </div>
          <a
            class="source-link related-link"
            href={resolve("/api/files/[...path]", {
              path: selectedStatement.storedFilePath,
            })}
            target="_blank"
            rel="noreferrer"
            ><FileText size={14} aria-hidden="true" /><span
              ><strong>Source File</strong><small
                title={selectedStatement.originalFilename}
                >{selectedStatement.originalFilename}</small
              ></span
            ><ExternalLink size={13} aria-hidden="true" /></a
          >
          <div>
            <strong>{selectedStatement.matchedCount}</strong><span>Matched</span
            >
          </div>
          <div>
            <strong>{selectedStatement.remainingCount}</strong><span
              >Remaining</span
            >
          </div>
          <div>
            <strong>{formatMoney(selectedStatement.remainingAmount)}</strong
            ><span>Unallocated</span>
          </div>
        </div>
        {#if selectedStatement.extractionError}<div
            class="error-banner"
            role="alert"
          >
            <strong>Extraction Failed</strong><span
              >{selectedStatement.extractionError} Delete this statement and upload
              a clearer PDF or image.</span
            >
          </div>{/if}
        <div class="detail-section-label">
          Extracted Transactions ({selectedStatementLines.length})
        </div>
        <div class="statement-lines">
          {#each selectedStatementLines as line (line.id)}<div
              class="statement-line"
            >
              <button
                class="statement-line-summary related-link"
                type="button"
                onclick={() =>
                  (editingLineId = editingLineId === line.id ? null : line.id)}
                ><span
                  class="direction-icon"
                  class:money-in={line.direction === StatementDirection.In}
                  >{#if line.direction === StatementDirection.In}<ArrowDownLeft
                      size={14}
                    />{:else}<ArrowUpRight size={14} />{/if}</span
                ><span class="statement-line-copy"
                  ><strong title={line.description}
                    >{line.description || "Statement transaction"}</strong
                  ><small
                    >{formatDate(line.date)} · {formatMoney(
                      line.remainingAmount,
                    )} remaining</small
                  ></span
                ><span class="line-total">{formatMoney(line.amount)}</span><span
                  class:rotated={editingLineId === line.id}
                  class="line-chevron"><ChevronRight size={14} /></span
                ></button
              >{#if editingLineId === line.id}<div class="line-edit">
                  <label
                    ><span>Date</span><input
                      name={`line-date-${line.id}`}
                      type="date"
                      value={line.date}
                      disabled={!data.permissions.change}
                      onchange={(event) =>
                        editLine(line, "date", event.currentTarget.value)}
                    /></label
                  ><label class="wide"
                    ><span>Description</span><input
                      name={`line-description-${line.id}`}
                      autocomplete="off"
                      value={line.description}
                      disabled={!data.permissions.change}
                      onchange={(event) =>
                        editLine(
                          line,
                          "description",
                          event.currentTarget.value,
                        )}
                    /></label
                  ><label
                    ><span>Amount</span><input
                      name={`line-amount-${line.id}`}
                      type="number"
                      inputmode="decimal"
                      min="0.01"
                      step="0.01"
                      value={line.amount}
                      disabled={!data.permissions.change}
                      onchange={(event) =>
                        editLine(line, "amount", event.currentTarget.value)}
                    /></label
                  ><label
                    ><span>Direction</span><select
                      name={`line-direction-${line.id}`}
                      value={line.direction}
                      disabled={!data.permissions.change}
                      onchange={(event) =>
                        editLine(line, "direction", event.currentTarget.value)}
                      ><option value={StatementDirection.In}>Money In</option
                      ><option value={StatementDirection.Out}>Money Out</option
                      ></select
                    ></label
                  ><label class="wide"
                    ><span>Note</span><input
                      name={`line-note-${line.id}`}
                      autocomplete="off"
                      value={line.note}
                      disabled={!data.permissions.change}
                      onchange={(event) =>
                        editLine(line, "note", event.currentTarget.value)}
                    /></label
                  >{#if data.permissions.delete}<button
                      class="line-delete"
                      type="button"
                      onclick={() => {
                        pendingLineId = line.id;
                        deleteLineOpen = true;
                      }}><Trash2 size={13} />Delete Transaction</button
                    >{/if}
                </div>{/if}
            </div>{/each}{#if selectedStatementLines.length === 0}<EmptyState
              title={selectedStatement.extractionState ===
              StatementExtractionState.Extracting
                ? "Extracting transactions…"
                : "No transactions found"}
              sub={selectedStatement.extractionState ===
              StatementExtractionState.Extracting
                ? "This view updates automatically when extraction completes."
                : "Delete this statement and upload a clearer file."}
              >{#snippet icon()}<FileText size={20} />{/snippet}</EmptyState
            >{/if}
        </div>
      </div>
      <div class="sheet-foot">
        <div class="sheet-foot-note">
          Status is derived from the remaining balance across all extracted
          lines.
        </div>
        <div class="sheet-foot-actions">
          {#if data.permissions.delete}<button
              class="sheet-btn sheet-btn-delete"
              type="button"
              onclick={() => (deleteStatementOpen = true)}
              ><Trash2 size={14} />Delete</button
            >{/if}<Sheet.Close class="sheet-btn">Close</Sheet.Close>
        </div>
      </div>{/if}</Sheet.Content
  ></Sheet.Root
>

<ConfirmDialog
  bind:open={discardOpen}
  title="Discard Allocation Changes?"
  description="Your staged allocation changes have not been saved. Discard them and continue?"
  confirmLabel="Discard Changes"
  danger
  onConfirm={confirmDiscard}
/>
<ConfirmDialog
  bind:open={deleteStatementOpen}
  title="Delete Bank Statement?"
  description={`Delete ${selectedStatement?.originalFilename ?? "this statement"}, all extracted transactions, and their allocations? Affected Akaun records will return to Needs Review.`}
  confirmLabel="Delete Statement"
  danger
  onConfirm={deleteStatement}
/>
<ConfirmDialog
  bind:open={deleteLineOpen}
  title="Delete Statement Transaction?"
  description="This removes the transaction and its allocations. Affected Akaun records may return to Needs Review."
  confirmLabel="Delete Transaction"
  danger
  onConfirm={deleteLine}
/>

<style>
  .reconciliation-screen {
    min-width: 0;
  }
  .recon-search {
    position: relative;
    display: flex;
    align-items: center;
  }
  .recon-search :global(svg) {
    position: absolute;
    left: 10px;
    color: var(--muted-foreground);
    pointer-events: none;
  }
  .recon-search input {
    width: 240px;
    height: 34px;
    padding: 0 10px 0 32px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--card);
    color: var(--foreground);
    font: inherit;
    font-size: 13px;
  }
  .recon-search input:focus-visible,
  input:focus-visible,
  select:focus-visible,
  button:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }
  .primary-action {
    height: 34px;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 0 13px;
    border: 0;
    border-radius: 8px;
    background: var(--primary);
    color: var(--primary-foreground);
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    touch-action: manipulation;
  }
  .primary-action:hover,
  .sheet-btn-primary:hover {
    filter: brightness(0.96);
  }
  .module-tabs {
    display: flex;
    gap: 4px;
    padding: 16px 28px 0;
    border-bottom: 1px solid var(--border);
  }
  .module-tabs button {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 9px 12px;
    border: 0;
    border-bottom: 2px solid transparent;
    background: transparent;
    color: var(--muted-foreground);
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }
  .module-tabs button:hover {
    color: var(--foreground);
  }
  .module-tabs button.active {
    color: var(--primary);
    border-bottom-color: var(--primary);
  }
  .recon-work {
    padding-top: 12px;
  }
  .date-filters {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--muted-foreground);
    font-size: 12px;
  }
  .date-filters label {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .date-filters input {
    height: 30px;
    padding: 0 8px;
    border: 1px solid var(--border);
    border-radius: 7px;
    background: var(--card);
    color: var(--foreground);
    font: inherit;
    font-size: 12px;
    color-scheme: light dark;
  }
  .clear-filter {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    border: 0;
    background: transparent;
    color: var(--primary);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .split-workspace {
    min-height: 0;
    flex: 1;
    display: grid;
    grid-template-columns: minmax(480px, 1.15fr) minmax(390px, 0.85fr);
    gap: 14px;
  }
  .record-pane {
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .desktop-composer {
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--card);
    box-shadow: var(--shadow-sm);
  }
  .filename {
    display: block;
    max-width: 360px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .num,
  .amount-num,
  .line-total,
  .amount-strip strong,
  .composer-foot strong,
  .statement-stats strong {
    font-variant-numeric: tabular-nums;
  }
  .remaining {
    color: var(--amber);
  }
  .type-chip {
    display: inline-flex;
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--secondary);
    color: var(--secondary-foreground);
    font-size: 11.5px;
    font-weight: 500;
  }
  .td-chevron {
    color: var(--muted-foreground);
  }
  .exp-row:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: -2px;
  }
  .composer {
    height: 100%;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: var(--card);
  }
  .composer-head,
  .sheet-head {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 18px 20px 15px;
    border-bottom: 1px solid var(--border);
  }
  .composer-title {
    min-width: 0;
    flex: 1;
  }
  .composer-title > span,
  .sheet-eyebrow {
    display: flex;
    align-items: center;
    gap: 5px;
    margin-bottom: 3px;
    color: var(--muted-foreground);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.07em;
    text-transform: uppercase;
  }
  .composer-title h2,
  .sheet-title-text {
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 16px;
    font-weight: 650;
  }
  .composer-title p {
    margin: 3px 0 0;
    color: var(--muted-foreground);
    font-size: 12px;
  }
  .type-icon,
  .direction-icon {
    display: grid;
    place-items: center;
    flex: 0 0 auto;
    color: var(--red);
    background: var(--red-soft);
  }
  .type-icon {
    width: 36px;
    height: 36px;
    border-radius: 9px;
  }
  .type-icon.income,
  .direction-icon.money-in {
    color: var(--green);
    background: var(--green-soft);
  }
  .icon-btn,
  :global(.sheet-close) {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border: 1px solid var(--border);
    border-radius: 7px;
    background: var(--card);
    color: var(--muted-foreground);
    cursor: pointer;
  }
  .amount-strip {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    border-bottom: 1px solid var(--border);
    background: var(--muted);
  }
  .amount-strip div {
    padding: 12px 16px;
    border-right: 1px solid var(--border);
  }
  .amount-strip div:last-child {
    border: 0;
  }
  .amount-strip span,
  .composer-foot span {
    display: block;
    color: var(--muted-foreground);
    font-size: 10px;
    font-weight: 650;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .amount-strip strong {
    display: block;
    margin-top: 3px;
    font-size: 15px;
  }
  .amount-strip .balanced strong {
    color: var(--green);
  }
  .amount-strip .error strong,
  .error {
    color: var(--red) !important;
  }
  .composer-body,
  .statement-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 16px 18px;
  }
  .suggestion {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 16px;
    padding: 12px;
    border: 1px solid color-mix(in srgb, var(--green) 35%, var(--border));
    border-radius: 9px;
    background: var(--green-soft);
  }
  .suggestion div {
    min-width: 0;
  }
  .suggestion strong,
  .suggestion span {
    display: block;
  }
  .suggestion span {
    margin-top: 2px;
    color: var(--muted-foreground);
    font-size: 11.5px;
  }
  .suggestion button {
    flex: none;
    padding: 7px 9px;
    border: 1px solid var(--green);
    border-radius: 7px;
    background: var(--card);
    color: var(--green);
    font: inherit;
    font-size: 11px;
    font-weight: 650;
    cursor: pointer;
  }
  .section-heading {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 9px;
  }
  .section-heading h3 {
    margin: 0;
    font-size: 13px;
  }
  .section-heading p {
    margin: 2px 0 0;
    color: var(--muted-foreground);
    font-size: 11px;
  }
  .section-heading > span {
    display: grid;
    place-items: center;
    width: 23px;
    height: 23px;
    border-radius: 50%;
    background: var(--muted);
    color: var(--muted-foreground);
    font-size: 11px;
  }
  .line-list,
  .statement-lines {
    border: 1px solid var(--border);
    border-radius: 9px;
    overflow: hidden;
  }
  .allocation-line {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 11px 12px;
    border-bottom: 1px solid var(--border);
  }
  .allocation-line:last-child {
    border-bottom: 0;
  }
  .allocation-line:hover {
    background: var(--accent);
  }
  .allocation-line.selected {
    background: var(--primary-soft);
  }
  .allocation-line.incompatible {
    background: var(--muted);
  }
  .allocation-line.incompatible .line-select {
    cursor: not-allowed;
  }
  .allocation-line.incompatible .line-copy,
  .allocation-line.incompatible .line-money {
    opacity: 0.65;
  }
  .line-select {
    min-width: 0;
    flex: 1;
    display: flex;
    align-items: center;
    gap: 9px;
    cursor: pointer;
  }
  .line-select > input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }
  .fake-check {
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    flex: none;
    border: 1.5px solid var(--border-strong);
    border-radius: 5px;
    background: var(--card);
    color: var(--primary-foreground);
  }
  .selected .fake-check {
    border-color: var(--primary);
    background: var(--primary);
  }
  .line-select:focus-within .fake-check {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }
  .line-copy,
  .statement-line-copy {
    min-width: 0;
    flex: 1;
  }
  .line-copy strong,
  .line-copy small,
  .statement-line-copy strong,
  .statement-line-copy small {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .line-copy strong,
  .statement-line-copy strong {
    font-size: 12px;
  }
  .line-copy small,
  .statement-line-copy small,
  .line-money small {
    color: var(--muted-foreground);
    font-size: 10.5px;
  }
  .line-money {
    flex: none;
    text-align: right;
  }
  .line-money > strong {
    display: block;
    margin-top: 2px;
    font-size: 12px;
  }
  .line-money label {
    display: flex;
    align-items: center;
    gap: 3px;
    margin-top: 3px;
    padding: 2px 5px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--card);
    font-size: 11px;
  }
  .line-money input {
    width: 72px;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--foreground);
    text-align: right;
    font: inherit;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
  .composer-foot {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 13px 18px;
    border-top: 1px solid var(--border);
    background: var(--card);
  }
  .composer-foot strong {
    display: inline-block;
    margin: 2px 8px 0 0;
    font-size: 15px;
  }
  .composer-foot small {
    color: var(--muted-foreground);
    font-size: 10.5px;
  }
  .composer-actions {
    display: flex;
    gap: 7px;
  }
  .sheet-btn,
  .sheet-btn-primary {
    min-height: 34px;
    padding: 0 12px;
    border-radius: 8px;
    font: inherit;
    font-size: 12.5px;
    font-weight: 550;
    cursor: pointer;
  }
  .sheet-btn {
    border: 1px solid var(--border);
    background: var(--card);
    color: var(--foreground);
  }
  .sheet-btn-primary {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    border: 0;
    background: var(--primary);
    color: var(--primary-foreground);
  }
  .sheet-btn:disabled,
  .sheet-btn-primary:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .compact {
    padding: 7px 10px;
  }
  :global(.recon-sheet) {
    overflow: hidden;
  }
  .sheet-head {
    justify-content: space-between;
    padding: 22px 22px 16px;
  }
  .sheet-head > div {
    min-width: 0;
  }
  .statement-status {
    display: flex;
    align-items: center;
    gap: 9px;
    color: var(--muted-foreground);
    font-size: 12px;
  }
  .statement-stats {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 1px;
    margin: 14px 0 20px;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 9px;
    background: var(--border);
  }
  .statement-stats div {
    padding: 12px;
    background: var(--card);
  }
  .statement-stats strong,
  .statement-stats span {
    display: block;
  }
  .statement-stats strong {
    font-size: 16px;
  }
  .statement-stats span {
    margin-top: 2px;
    color: var(--muted-foreground);
    font-size: 10.5px;
  }
  .detail-section-label {
    margin: 18px 0 8px;
    color: var(--muted-foreground);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .source-link {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 10px 11px;
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--foreground);
    text-decoration: none;
  }
  .source-link > span {
    min-width: 0;
    flex: 1;
  }
  .source-link strong,
  .source-link small {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .source-link strong {
    font-size: 12px;
  }
  .source-link small {
    margin-top: 2px;
    color: var(--muted-foreground);
    font-size: 10.5px;
  }
  .error-banner {
    display: grid;
    gap: 3px;
    padding: 11px 12px;
    border: 1px solid color-mix(in srgb, var(--red) 35%, var(--border));
    border-radius: 8px;
    background: var(--red-soft);
    color: var(--red);
    font-size: 12px;
  }
  .statement-line {
    border-bottom: 1px solid var(--border);
  }
  .statement-line:last-child {
    border: 0;
  }
  .statement-line-summary {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 10px;
    border: 0;
    background: var(--card);
    color: var(--foreground);
    text-align: left;
    cursor: pointer;
  }
  .direction-icon {
    width: 28px;
    height: 28px;
    border-radius: 7px;
  }
  .line-total {
    flex: none;
    font-size: 12px;
    font-weight: 650;
  }
  .line-chevron {
    display: flex;
    color: var(--muted-foreground);
    transition: transform 0.15s;
  }
  .line-chevron.rotated {
    transform: rotate(90deg);
  }
  .line-edit {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    padding: 12px;
    border-top: 1px solid var(--border);
    background: var(--muted);
  }
  .line-edit label {
    display: grid;
    gap: 4px;
    color: var(--muted-foreground);
    font-size: 10.5px;
    font-weight: 600;
  }
  .line-edit label.wide {
    grid-column: 1/-1;
  }
  .line-edit input,
  .line-edit select {
    width: 100%;
    min-width: 0;
    height: 32px;
    padding: 0 8px;
    border: 1px solid var(--border);
    border-radius: 7px;
    background: var(--card);
    color: var(--foreground);
    font: inherit;
    font-size: 12px;
  }
  .line-delete {
    grid-column: 1/-1;
    justify-self: start;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--red);
    font: inherit;
    font-size: 11.5px;
    cursor: pointer;
  }
  .sheet-btn-delete {
    margin-right: auto;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: var(--red);
  }

  @media (max-width: 1000px) {
    .split-workspace {
      grid-template-columns: 1fr;
    }
    .desktop-composer {
      display: none;
    }
  }
  @media (max-width: 767px) {
    .recon-stats {
      display: none;
    }
    .module-tabs {
      padding: 8px 16px 0;
      overflow-x: auto;
    }
    .recon-work {
      padding-top: 10px;
    }
    .date-filters {
      width: 100%;
      overflow-x: auto;
      padding-bottom: 2px;
    }
    .date-filters > :global(svg) {
      display: none;
    }
    .topbar-right .primary-action span {
      display: none;
    }
    .primary-action {
      width: 34px;
      padding: 0;
      justify-content: center;
    }
    .recon-search {
      display: none;
    }
    .record-pane .table-card {
      overflow: visible;
    }
    .filename {
      max-width: 210px;
    }
    :global(.mobile-composer-sheet),
    :global(.statement-sheet) {
      width: 100vw !important;
      max-width: 100vw !important;
    }
    .composer-head {
      padding-top: calc(18px + env(safe-area-inset-top));
    }
    .composer-foot,
    :global(.statement-sheet .sheet-foot) {
      padding-bottom: calc(13px + env(safe-area-inset-bottom));
    }
    .amount-strip div {
      padding: 10px 12px;
    }
    .allocation-line {
      align-items: flex-start;
    }
    .line-money {
      padding-top: 2px;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .line-chevron {
      transition: none;
    }
  }
</style>
