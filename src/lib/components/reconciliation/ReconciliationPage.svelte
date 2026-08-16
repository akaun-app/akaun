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
    ArrowLeftRight,
    ArrowUpRight,
    Banknote,
    Calendar,
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
    Wallet,
    X,
  } from "@lucide/svelte";
  import { toast } from "svelte-sonner";
  import * as Sheet from "$lib/components/ui/sheet/index.js";
  import ConfirmDialog from "$lib/components/ui/ConfirmDialog.svelte";
  import DatePicker from "$lib/components/ui/date-picker/DatePicker.svelte";
  import EmptyState from "$lib/components/ui/EmptyState.svelte";
  import FilterDropdown from "$lib/components/ui/FilterDropdown.svelte";
  import StatusBadge from "$lib/components/ui/StatusBadge.svelte";
  import {
    LedgerRecordKindLabels,
    StatementDirection,
    StatementExtractionState,
  } from "$lib/enums.js";
  import { mainCurrencySymbol } from "$lib/currency-state.svelte.js";
  import { formatDate, formatMoney } from "$lib/format.js";
  import { useIsMobile } from "$lib/hooks/useIsMobile.svelte.js";
  import { createResourceStream } from "$lib/sse.js";
  import type { loadReconciliationPage } from "$lib/server/loaders/reconciliation.js";

  type Data = ReturnType<typeof loadReconciliationPage>;
  /** One side of a record, on the account a statement belongs to. */
  type MovementRow = Data["movements"][number];
  type Statement = Data["statements"][number];
  type StatementLine = Data["lines"][number];
  type Draft = { lineId: number; amount: number };
  type Tab = "records" | "statements";
  type RecordStatus = "review" | "matched";
  type StatementStatus = "active" | "completed";
  /** Must not exceed the `movementIds` array cap in /api/reconciliation/auto-match. */
  const BULK_MATCH_CHUNK = 500;
  /** Half a cent — the point where a decimal remainder stops being a rounding artefact. */
  const CENT = 0.005;

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
  let recordStatuses = $state<RecordStatus[]>(
    page.url.searchParams.has("filter")
      ? (page.url.searchParams
          .get("filter")!
          .split(",")
          .filter(Boolean) as RecordStatus[])
      : ["review"],
  );
  let statementStatuses = $state<StatementStatus[]>(
    page.url.searchParams.has("status")
      ? (page.url.searchParams
          .get("status")!
          .split(",")
          .filter(Boolean) as StatementStatus[])
      : ["active"],
  );
  let query = $state(page.url.searchParams.get("q") ?? "");
  let from = $state(page.url.searchParams.get("from") ?? "");
  let to = $state(page.url.searchParams.get("to") ?? "");
  let mobileFilterOpen = $state(false);
  let selectedMovementId = $state(
    Number(page.url.searchParams.get("movement")) || null,
  );
  let selectedMovement = $state<MovementRow | null>(null);
  let selectedStatementId = $state(
    Number(page.url.searchParams.get("statement")) || null,
  );
  let drafts = $state<Draft[]>([]);
  let savedDrafts = $state<Draft[]>([]);
  let initialDrafts = $state<Draft[]>([]);
  let saving = $state(false);
  let bulkOpen = $state(false);
  let bulkSaving = $state(false);
  let retrying = $state(false);
  let deleteStatementOpen = $state(false);
  let deleteLineOpen = $state(false);
  let pendingLineId = $state<number | null>(null);
  let discardOpen = $state(false);
  let deferredAction = $state<(() => void) | null>(null);
  let editingLineId = $state<number | null>(null);
  // Upload now needs two answers, not one: which file, and which account the
  // statement belongs to (FR-021). The file itself stays out of `$state` — a
  // `File` is not a plain object.
  let uploadOpen = $state(false);
  let uploadAccountId = $state<number | null>(null);
  let uploadFileName = $state("");
  let uploading = $state(false);
  let uploadInput = $state<HTMLInputElement | null>(null);
  let pendingUpload: File | null = null;
  // "Record this as a transfer from another account" (FR-023).
  let transferLineId = $state<number | null>(null);
  let transferAccountId = $state<number | null>(null);
  let transferDescription = $state("");
  let transferSaving = $state(false);

  const selectedStatement = $derived(
    data.statements.find((statement) => statement.id === selectedStatementId) ??
      null,
  );
  const selectedStatementLines = $derived(
    data.lines.filter((line) => line.statementId === selectedStatementId),
  );
  const reviewMovements = $derived(
    data.movements.filter(
      (movement) => Math.abs(movement.remainingAmount ?? 0) >= CENT,
    ),
  );
  const matchedMovements = $derived(
    data.movements.filter(
      (movement) => Math.abs(movement.remainingAmount ?? 0) < CENT,
    ),
  );
  const activeStatements = $derived(
    data.statements.filter((statement) => !statement.completed),
  );
  const completedStatements = $derived(
    data.statements.filter((statement) => statement.completed),
  );
  const bankRemaining = $derived(
    data.lines.reduce(
      (sum, line) => sum + Math.max(0, line.remainingAmount),
      0,
    ),
  );
  const includeReview = $derived(
    recordStatuses.length === 0 || recordStatuses.includes("review"),
  );
  const includeMatched = $derived(
    recordStatuses.length === 0 || recordStatuses.includes("matched"),
  );
  const recordStatusTotal = $derived(
    (includeReview ? reviewMovements.length : 0) +
      (includeMatched ? matchedMovements.length : 0),
  );
  const singleRecordStatus = $derived(
    recordStatuses.length === 1 ? recordStatuses[0] : null,
  );
  const includeActiveStatements = $derived(
    statementStatuses.length === 0 || statementStatuses.includes("active"),
  );
  const includeCompletedStatements = $derived(
    statementStatuses.length === 0 || statementStatuses.includes("completed"),
  );
  const singleStatementStatus = $derived(
    statementStatuses.length === 1 ? statementStatuses[0] : null,
  );
  const recordStatusActive = $derived(
    !(recordStatuses.length === 1 && recordStatuses[0] === "review"),
  );
  const statementStatusActive = $derived(
    !(statementStatuses.length === 1 && statementStatuses[0] === "active"),
  );
  const dateRangeActive = $derived(!!(from || to));
  const activeFilterCount = $derived(
    tab === "records"
      ? (recordStatusActive ? 1 : 0) + (dateRangeActive ? 1 : 0)
      : statementStatusActive
        ? 1
        : 0,
  );
  const visibleMovements = $derived.by(() => {
    let source: MovementRow[] = [];
    if (includeReview) source = source.concat(reviewMovements);
    if (includeMatched) source = source.concat(matchedMovements);
    const normalized = query.trim().toLocaleLowerCase();
    return source
      .filter(
        (movement) =>
          !normalized ||
          `${movement.label} ${movement.contactName ?? ""} ${movement.accountName ?? ""} ${kindLabel(movement.kind)}`
            .toLocaleLowerCase()
            .includes(normalized),
      )
      .toSorted((left, right) => matchRank(left) - matchRank(right));
  });
  const visibleStatements = $derived.by(() => {
    let source: Statement[] = [];
    if (includeActiveStatements) source = source.concat(activeStatements);
    if (includeCompletedStatements) source = source.concat(completedStatements);
    const normalized = query.trim().toLocaleLowerCase();
    return source.filter(
      (statement) =>
        !normalized ||
        `${statement.originalFilename} ${statement.accountName ?? ""}`
          .toLocaleLowerCase()
          .includes(normalized),
    );
  });
  const bulkMatchable = $derived(
    visibleMovements.filter(
      (movement) => matchStatus(movement) === "exact-match",
    ),
  );
  const savedAllocations = $derived.by(() => {
    const movement = selectedMovement;
    return movement
      ? data.allocations.filter(
          (allocation) => allocation.movementId === movement.movementId,
        )
      : [];
  });
  /**
   * The lines this movement could be. Only lines from a statement on the
   * movement's own account are ever offered — that is FR-021, and it is why a
   * wallet purchase can no longer appear against a bank statement.
   */
  const compatibleLines = $derived.by(() => {
    const movement = selectedMovement;
    if (!movement) return [];
    const direction =
      movement.amountMinor > 0 ? StatementDirection.In : StatementDirection.Out;
    const savedIds = new Set(
      savedAllocations.map((allocation) => allocation.lineId),
    );
    return data.lines.filter(
      (line) =>
        line.accountId === movement.accountId &&
        line.direction === direction &&
        (line.remainingAmount >= CENT || savedIds.has(line.id)),
    );
  });
  const availableLines = $derived(
    compatibleLines.toSorted((left, right) =>
      right.date.localeCompare(left.date),
    ),
  );
  const draftTotal = $derived(
    Math.round(
      drafts.reduce((sum, draft) => sum + Number(draft.amount || 0), 0) * 100,
    ) / 100,
  );
  const movementTotal = $derived(selectedMovement?.amount ?? 0);
  const draftRemaining = $derived(
    Math.round((movementTotal - draftTotal) * 100) / 100,
  );
  const dirty = $derived(
    JSON.stringify(normalizeDrafts(drafts)) !==
      JSON.stringify(normalizeDrafts(savedDrafts)),
  );
  const manuallyEdited = $derived(
    JSON.stringify(normalizeDrafts(drafts)) !==
      JSON.stringify(normalizeDrafts(initialDrafts)),
  );
  const hasSuggestion = $derived(
    !!selectedMovement?.suggestedLineIds.length &&
      savedAllocations.length === 0,
  );
  const suggestionApplied = $derived(
    !!selectedMovement &&
      drafts.length === selectedMovement.suggestedLineIds.length &&
      selectedMovement.suggestedLineIds.every((id) =>
        drafts.some((draft) => draft.lineId === id),
      ),
  );
  /** A line with nothing allocated to it yet is the only kind a transfer can explain. */
  const transferLine = $derived(
    data.lines.find((line) => line.id === transferLineId) ?? null,
  );
  const transferTargets = $derived(
    data.accounts.filter(
      (account) => account.id !== selectedStatement?.accountId,
    ),
  );

  // Which movement's allocations `drafts` currently holds. Deliberately a plain
  // `let`, not `$state`: the effect below writes it, and making it reactive
  // would feed that write straight back in as a dependency.
  let hydratedId: number | null = null;

  // Two jobs, and the difference matters:
  //   1. `?movement=…` in the URL (refresh, pasted link) opens a movement
  //      without going through `loadMovement`, so its saved allocations have to
  //      be staged here — otherwise Save would replace them with whatever the
  //      empty composer holds.
  //   2. After an invalidation, re-point `selectedMovement` at the fresh loader
  //      object so the composer shows current amounts. This must NOT re-stage
  //      drafts: an SSE event from another tab would wipe edits in progress.
  $effect(() => {
    const movements = data.movements;
    const id = selectedMovementId;
    if (!id) {
      hydratedId = null;
      return;
    }
    const refreshed = movements.find((movement) => movement.movementId === id);
    if (!refreshed) return;
    selectedMovement = refreshed;
    if (hydratedId === id) return;
    hydratedId = id;
    stageSavedAllocations(refreshed);
  });

  createResourceStream<{ type: string }>(
    "/api/reconciliation/stream",
    (event) => {
      if (event.type !== "snapshot") void invalidateAll();
    },
  );

  function kindLabel(kind: number | undefined) {
    const value = (kind && LedgerRecordKindLabels[kind]) || "record";
    const words = value.replace(/_/g, " ");
    return words[0].toUpperCase() + words.slice(1);
  }
  function matchStatus(
    movement: MovementRow,
  ): "matched" | "exact-match" | "partial-match" | "no-match" {
    if (Math.abs(movement.remainingAmount ?? 0) < CENT) return "matched";
    if ((movement.allocatedAmount ?? 0) >= CENT) return "partial-match";
    return movement.suggestedLineIds.length ? "exact-match" : "no-match";
  }
  function matchRank(movement: MovementRow) {
    const status = matchStatus(movement);
    return status === "exact-match"
      ? 0
      : status === "partial-match"
        ? 1
        : status === "no-match"
          ? 2
          : 3;
  }
  function buildSuggestionDrafts(movement: MovementRow): Draft[] {
    if (!movement.suggestedLineIds.length) return [];
    let remaining = movement.amount;
    const result: Draft[] = [];
    for (const lineId of movement.suggestedLineIds) {
      const line = data.lines.find((candidate) => candidate.id === lineId);
      if (!line) continue;
      const amount = Math.min(line.remainingAmount, remaining);
      remaining = Math.round((remaining - amount) * 100) / 100;
      result.push({ lineId, amount });
    }
    return result;
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
      filter: recordStatuses.join(","),
      status: statementStatuses.join(","),
    });
    if (query) params.set("q", query);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (selectedMovementId) params.set("movement", String(selectedMovementId));
    if (selectedStatementId)
      params.set("statement", String(selectedStatementId));
    // eslint-disable-next-line svelte/no-navigation-without-resolve -- route is resolved; only query state is appended.
    replaceState(`${resolve("/reconciliation")}?${params}`, page.state);
  }
  function guard(action: () => void) {
    if (!manuallyEdited) return action();
    deferredAction = action;
    discardOpen = true;
  }
  function confirmDiscard() {
    drafts = [...initialDrafts];
    discardOpen = false;
    const action = deferredAction;
    deferredAction = null;
    action?.();
  }
  /**
   * Fill the composer for `movement`: its saved allocations if it has any, the
   * suggested set otherwise. Shared by the in-app row click and the
   * URL-restore effect so both open a movement in the same state.
   */
  function stageSavedAllocations(movement: MovementRow) {
    const saved = data.allocations
      .filter((allocation) => allocation.movementId === movement.movementId)
      .map((allocation) => ({
        lineId: allocation.lineId,
        amount: allocation.amount,
      }));
    drafts = saved.length ? saved : buildSuggestionDrafts(movement);
    savedDrafts = [...saved];
    initialDrafts = [...drafts];
  }
  function loadMovement(movement: MovementRow) {
    selectedMovementId = movement.movementId;
    // Staged here and now, so the effect above treats this movement as hydrated
    // and leaves the drafts alone on the next invalidation.
    hydratedId = movement.movementId;
    selectedMovement = movement;
    stageSavedAllocations(movement);
    updateUrl();
  }
  function chooseMovement(movement: MovementRow) {
    guard(() => loadMovement(movement));
  }
  function closeMovement() {
    guard(clearSelection);
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
      selectedMovementId = null;
      selectedMovement = null;
      drafts = [];
      savedDrafts = [];
      initialDrafts = [];
      selectedStatementId = null;
      updateUrl();
    });
  }
  function toggleRecordStatus(status: RecordStatus) {
    recordStatuses = recordStatuses.includes(status)
      ? recordStatuses.filter((value) => value !== status)
      : [...recordStatuses, status];
    updateUrl();
  }
  function toggleStatementStatus(status: StatementStatus) {
    statementStatuses = statementStatuses.includes(status)
      ? statementStatuses.filter((value) => value !== status)
      : [...statementStatuses, status];
    updateUrl();
  }
  function clearFilters() {
    if (tab === "records") {
      recordStatuses = ["review"];
      from = "";
      to = "";
    } else {
      statementStatuses = ["active"];
    }
    updateUrl();
    void invalidateAll();
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
    const remaining = Math.max(0, movementTotal - draftTotal);
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
    if (!selectedMovement) return;
    drafts = buildSuggestionDrafts(selectedMovement);
  }
  async function saveAllocations(): Promise<boolean> {
    if (!selectedMovement || saving || draftRemaining < -CENT) return false;
    saving = true;
    const response = await fetch(
      `/api/reconciliation/records/${selectedMovement.movementId}/allocations`,
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
      return false;
    }
    savedDrafts = [...drafts];
    toast.success("Allocations saved");
    await invalidateAll();
    return true;
  }
  async function saveAndAdvance() {
    if (!selectedMovement) return;
    const queue = visibleMovements;
    const index = queue.findIndex(
      (movement) => movement.movementId === selectedMovementId,
    );
    const nextId =
      index >= 0 && index + 1 < queue.length
        ? queue[index + 1].movementId
        : null;
    const ok = await saveAllocations();
    if (!ok) return;
    const nextMovement =
      (nextId &&
        data.movements.find(
          (movement) =>
            movement.movementId === nextId &&
            Math.abs(movement.remainingAmount ?? 0) >= CENT,
        )) ||
      visibleMovements.find(
        (movement) => Math.abs(movement.remainingAmount ?? 0) >= CENT,
      );
    if (nextMovement) {
      loadMovement(nextMovement);
      return;
    }
    clearSelection();
  }
  function clearSelection() {
    selectedMovementId = null;
    selectedMovement = null;
    drafts = [];
    savedDrafts = [];
    initialDrafts = [];
    updateUrl();
  }
  async function runAutoMatch() {
    bulkOpen = false;
    if (bulkSaving || saving) return;
    // Hand edits on the open movement outrank its suggestion, so persist them
    // first — that also takes the movement out of the batch, since the server
    // skips anything already allocated.
    if (selectedMovement && manuallyEdited && !(await saveAllocations()))
      return;
    const targets = bulkMatchable.map((movement) => movement.movementId);
    if (!targets.length) return;
    bulkSaving = true;
    let matched = 0;
    let skipped = 0;
    // The endpoint caps a batch at BULK_MATCH_CHUNK movements; each request
    // re-reads the live line balances, so chunking stays consistent.
    for (let start = 0; start < targets.length; start += BULK_MATCH_CHUNK) {
      const response = await fetch("/api/reconciliation/auto-match", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          movementIds: targets.slice(start, start + BULK_MATCH_CHUNK),
        }),
      }).catch(() => null);
      const result = await response?.json().catch(() => null);
      if (!response?.ok) {
        bulkSaving = false;
        toast.error(
          result?.error ??
            "Exact matches could not be saved. Check the available amounts and try again.",
        );
        // Earlier chunks are already saved; reload so the list reflects them.
        await invalidateAll();
        return;
      }
      matched += Number(result?.matched ?? 0);
      skipped += Number(result?.skipped ?? 0);
    }
    bulkSaving = false;
    toast.success(
      `${matched} record${matched === 1 ? "" : "s"} matched${
        skipped ? ` · ${skipped} skipped` : ""
      }`,
    );
    await invalidateAll();
    const next = visibleMovements.find((movement) => {
      const status = matchStatus(movement);
      return status === "partial-match" || status === "no-match";
    });
    if (next) {
      loadMovement(next);
      return;
    }
    clearSelection();
  }
  function openUpload() {
    pendingUpload = null;
    uploadFileName = "";
    uploadAccountId = data.accounts[0]?.id ?? null;
    uploadOpen = true;
  }
  function chooseUploadFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    pendingUpload = input.files?.[0] ?? null;
    uploadFileName = pendingUpload?.name ?? "";
  }
  async function upload() {
    if (!pendingUpload || !uploadAccountId || uploading) return;
    uploading = true;
    const form = new FormData();
    form.set("file", pendingUpload);
    form.set("accountId", String(uploadAccountId));
    const response = await fetch("/api/reconciliation/statements", {
      method: "POST",
      body: form,
    }).catch(() => null);
    uploading = false;
    if (!response?.ok) {
      const result = await response?.json().catch(() => null);
      toast.error(
        result?.error ??
          "Statement upload failed. Choose a PDF, JPEG, or PNG under 15 MB.",
      );
      return;
    }
    toast.success("Statement extraction started");
    uploadOpen = false;
    pendingUpload = null;
    uploadFileName = "";
    tab = "statements";
    statementStatuses = ["active"];
    updateUrl();
    await invalidateAll();
  }
  /** Move a statement to the account it really belongs to (FR-034a). */
  async function reassignStatement(accountId: number) {
    if (!selectedStatementId) return;
    const response = await fetch(
      `/api/reconciliation/statements/${selectedStatementId}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accountId }),
      },
    ).catch(() => null);
    if (!response?.ok) {
      const result = await response?.json().catch(() => null);
      toast.error(
        result?.error ?? "This statement could not be moved to that account.",
      );
      await invalidateAll();
      return;
    }
    toast.success("Statement account updated");
    await invalidateAll();
  }
  function openTransfer(line: StatementLine) {
    transferLineId = line.id;
    transferAccountId = transferTargets[0]?.id ?? null;
    transferDescription = line.description;
  }
  function closeTransfer() {
    transferLineId = null;
    transferAccountId = null;
    transferDescription = "";
  }
  /**
   * Record a line as money moved between two of the user's own accounts, and
   * match it in the same action (FR-023). Nothing was earned or spent, so there
   * was never a record to find — this creates the one that was missing.
   */
  async function saveTransfer() {
    if (!transferLineId || !transferAccountId || transferSaving) return;
    transferSaving = true;
    const response = await fetch(
      `/api/reconciliation/lines/${transferLineId}/transfer`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          otherAccountId: transferAccountId,
          description: transferDescription,
        }),
      },
    ).catch(() => null);
    transferSaving = false;
    if (!response?.ok) {
      const result = await response?.json().catch(() => null);
      toast.error(
        result?.error ??
          "This transaction could not be recorded as a transfer.",
      );
      return;
    }
    toast.success("Transfer recorded and matched");
    closeTransfer();
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
  async function retryExtraction() {
    if (!selectedStatementId || retrying) return;
    retrying = true;
    const response = await fetch(
      `/api/reconciliation/statements/${selectedStatementId}/retry`,
      { method: "POST" },
    ).catch(() => null);
    retrying = false;
    if (!response?.ok) {
      const result = await response?.json().catch(() => null);
      toast.error(
        result?.error ?? "Extraction could not be restarted. Try again.",
      );
      return;
    }
    toast.success("Statement extraction restarted");
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
        {reviewMovements.length} record{reviewMovements.length === 1 ? "" : "s"}
        need review · <span class="num">{formatMoney(bankRemaining)}</span> unallocated
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
      {#if data.permissions.add}<button
          class="primary-action"
          type="button"
          onclick={openUpload}
          ><Upload size={15} aria-hidden="true" /><span>Upload Statement</span
          ></button
        >{/if}
    </div>
  </header>

  <div class="work">
    <div class="work-main recon-work">
      <div class="toolbar">
        <div class="status-tabs">
          <button
            class="status-tab"
            class:active={tab === "records"}
            type="button"
            onclick={() => setTab("records")}>Akaun Records</button
          ><button
            class="status-tab"
            class:active={tab === "statements"}
            type="button"
            onclick={() => setTab("statements")}>Statements</button
          >
        </div>
        <div class="mobile-filter-row">
          <button
            class="btn-outline btn-sm"
            style="display:inline-flex; align-items:center; gap:6px;"
            type="button"
            onclick={() => (mobileFilterOpen = true)}
            ><SlidersHorizontal size={13} aria-hidden="true" /> Filters{#if activeFilterCount > 0}<span
                class="filter-count">{activeFilterCount}</span
              >{/if}</button
          >{#if activeFilterCount > 0}<button
              class="clear-filters"
              type="button"
              onclick={clearFilters}
              ><X size={13} aria-hidden="true" /> Clear</button
            >{/if}{@render BulkMatchButton()}
        </div>
        <div class="toolbar-filters">
          {@render BulkMatchButton()}
          {#if activeFilterCount > 0}<button
              class="clear-filters"
              type="button"
              onclick={clearFilters}
              ><X size={13} aria-hidden="true" />Clear</button
            >{/if}
          {#if tab === "records"}
            <FilterDropdown label="Status" active={recordStatusActive}>
              {#snippet icon()}<SlidersHorizontal
                  size={14}
                  aria-hidden="true"
                />{/snippet}
              <div class="filter-checklist">
                <button
                  type="button"
                  class="filter-check"
                  class:checked={recordStatuses.includes("review")}
                  onclick={() => toggleRecordStatus("review")}
                  ><span class="filter-checkbox"
                    >{#if recordStatuses.includes("review")}<Check
                        size={11}
                      />{/if}</span
                  >Needs Review
                  <span class="tab-count">{reviewMovements.length}</span
                  ></button
                ><button
                  type="button"
                  class="filter-check"
                  class:checked={recordStatuses.includes("matched")}
                  onclick={() => toggleRecordStatus("matched")}
                  ><span class="filter-checkbox"
                    >{#if recordStatuses.includes("matched")}<Check
                        size={11}
                      />{/if}</span
                  >Matched
                  <span class="tab-count">{matchedMovements.length}</span
                  ></button
                >
              </div>
            </FilterDropdown>
            <FilterDropdown label="Date" active={dateRangeActive} align="right">
              {#snippet icon()}<Calendar
                  size={14}
                  aria-hidden="true"
                />{/snippet}
              <div class="filter-daterange">
                <div class="filter-daterange-head">
                  <span>Date range</span>
                  {#if from || to}<button
                      type="button"
                      onclick={() => {
                        from = "";
                        to = "";
                        updateUrl();
                        void invalidateAll();
                      }}>Clear</button
                    >{/if}
                </div>
                <span class="mini-label">From</span>
                <DatePicker
                  value={from}
                  placeholder="From date"
                  onchange={(value) => {
                    from = value;
                    updateUrl();
                    void invalidateAll();
                  }}
                />
                <span class="mini-label">To</span>
                <DatePicker
                  value={to}
                  placeholder="To date"
                  onchange={(value) => {
                    to = value;
                    updateUrl();
                    void invalidateAll();
                  }}
                />
              </div>
            </FilterDropdown>
          {:else}
            <FilterDropdown label="Status" active={statementStatusActive}>
              {#snippet icon()}<SlidersHorizontal
                  size={14}
                  aria-hidden="true"
                />{/snippet}
              <div class="filter-checklist">
                <button
                  type="button"
                  class="filter-check"
                  class:checked={statementStatuses.includes("active")}
                  onclick={() => toggleStatementStatus("active")}
                  ><span class="filter-checkbox"
                    >{#if statementStatuses.includes("active")}<Check
                        size={11}
                      />{/if}</span
                  >Active
                  <span class="tab-count">{activeStatements.length}</span
                  ></button
                ><button
                  type="button"
                  class="filter-check"
                  class:checked={statementStatuses.includes("completed")}
                  onclick={() => toggleStatementStatus("completed")}
                  ><span class="filter-checkbox"
                    >{#if statementStatuses.includes("completed")}<Check
                        size={11}
                      />{/if}</span
                  >Completed
                  <span class="tab-count">{completedStatements.length}</span
                  ></button
                >
              </div>
            </FilterDropdown>
          {/if}
        </div>
      </div>
      {#if tab === "records"}
        <div class="split-workspace">
          <div class="record-pane">
            <div class="table-card">
              <table class="exp-table">
                <thead
                  ><tr
                    ><th>Record</th><th>Account</th><th>Date</th><th
                      class="ta-right">Total</th
                    ><th>Match</th><th class="ta-right">Remaining</th><th
                      aria-label="Open"
                    ></th></tr
                  ></thead
                ><tbody
                  >{#each visibleMovements as movement (movement.movementId)}<tr
                      class="exp-row"
                      class:selected={movement.movementId ===
                        selectedMovementId}
                      tabindex="0"
                      onclick={() => chooseMovement(movement)}
                      onkeydown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          chooseMovement(movement);
                        }
                      }}
                      ><td class="td-primary"
                        ><div class="cell-item">
                          <span class="cell-itemname">{movement.label}</span
                          ><span class="cell-itemnum"
                            >{kindLabel(movement.kind)} · {movement.contactName ||
                              "No contact"}</span
                          >
                        </div></td
                      ><td data-label="Account"
                        ><span class="type-chip"
                          >{movement.accountName ?? "No account"}</span
                        ></td
                      ><td class="td-date" data-label="Date"
                        >{formatDate(movement.date)}</td
                      ><td class="td-amount" data-label="Total"
                        ><span class="amount-num"
                          >{formatMoney(movement.amount)}</span
                        ></td
                      ><td data-label="Match"
                        ><StatusBadge status={matchStatus(movement)} /></td
                      ><td class="td-amount remaining" data-label="Remaining"
                        ><span class="amount-num"
                          >{formatMoney(movement.remainingAmount ?? 0)}</span
                        ></td
                      ><td class="td-chevron"
                        ><ChevronRight size={15} aria-hidden="true" /></td
                      ><td class="row-break"></td></tr
                    >{/each}{#if visibleMovements.length === 0}<tr
                      class="empty-row"
                      ><td colspan="7"
                        ><EmptyState
                          title={singleRecordStatus === "matched"
                            ? "No matched records yet"
                            : "All records are matched"}
                          sub={singleRecordStatus === "matched"
                            ? "Fully allocated records will appear here for audit and correction."
                            : singleRecordStatus === "review"
                              ? "Every eligible Akaun record in this date range is fully allocated."
                              : "Try adjusting the status or date filters."}
                          >{#snippet icon()}{#if singleRecordStatus === "matched"}<Banknote
                                size={20}
                              />{:else}<Check
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
                >Showing <b>{visibleMovements.length}</b> of {recordStatusTotal}</span
              >
            </div>
          </div>
          <div class="desktop-composer">
            {#if selectedMovement}{@render AllocationComposer()}{:else if reviewMovements.length === 0}<EmptyState
                title="You're all caught up"
                sub="Every eligible Akaun record in this date range is fully allocated."
                >{#snippet icon()}<Check size={20} />{/snippet}</EmptyState
              >{:else}<EmptyState
                title="Select an Akaun record"
                sub="Choose a record to review compatible bank transactions and stage allocations."
                >{#snippet icon()}<CircleDollarSign
                    size={20}
                  />{/snippet}</EmptyState
              >{/if}
          </div>
        </div>
      {:else}
        <div class="statement-pane">
          <div class="table-card">
            <table class="exp-table">
              <thead
                ><tr
                  ><th>Statement</th><th>Account</th><th>Date Range</th><th
                    >Status</th
                  ><th>Matched</th><th class="ta-right">Remaining</th><th
                    aria-label="Open"
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
                    ><td data-label="Account"
                      ><span class="type-chip"
                        >{statement.accountName ?? "No account"}</span
                      ></td
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
                    ><td colspan="7"
                      ><EmptyState
                        title={singleStatementStatus === "completed"
                          ? "No completed statements"
                          : "No active statements"}
                        sub={singleStatementStatus === "completed"
                          ? "Statements move here automatically when every line is fully allocated."
                          : singleStatementStatus === "active"
                            ? "Upload a bank statement to extract transactions and start matching."
                            : "Try adjusting the status filter."}
                        >{#snippet icon()}<FileText
                            size={20}
                          />{/snippet}{#snippet action()}{#if singleStatementStatus !== "completed" && data.permissions.add}<button
                              class="sheet-btn-primary compact"
                              type="button"
                              onclick={openUpload}
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
              >{visibleStatements.length} statement{visibleStatements.length ===
              1
                ? ""
                : "s"}</span
            >
          </div>
        </div>
      {/if}
    </div>
  </div>
</div>

{#snippet BulkMatchButton()}
  {#if tab === "records" && data.permissions.change && bulkMatchable.length > 0}
    <button
      class="bulk-match-btn"
      type="button"
      disabled={bulkSaving || saving}
      onclick={() => (bulkOpen = true)}
      ><Check size={13} aria-hidden="true" />{bulkSaving
        ? "Saving…"
        : `Save ${bulkMatchable.length} exact match${
            bulkMatchable.length === 1 ? "" : "es"
          }`}</button
    >
  {/if}
{/snippet}

{#snippet AllocationComposer()}
  {#if selectedMovement}{@const movesIn = selectedMovement.amountMinor > 0}
    <section class="composer" aria-label={`Allocate ${selectedMovement.label}`}>
      <header class="composer-head">
        <div class="type-icon" class:income={movesIn}>
          {#if movesIn}<ArrowDownLeft size={17} />{:else}<ArrowUpRight
              size={17}
            />{/if}
        </div>
        <div class="composer-title">
          <span
            >{kindLabel(selectedMovement.kind)} · {selectedMovement.accountName ??
              "No account"}</span
          >
          <h2>{selectedMovement.label}</h2>
          <p>
            {selectedMovement.contactName || formatDate(selectedMovement.date)}
          </p>
        </div>
        {#if compactWorkspace}<button
            class="icon-btn"
            type="button"
            aria-label="Close allocation composer"
            onclick={closeMovement}><X size={16} /></button
          >{/if}
      </header>
      <div class="amount-strip">
        <div>
          <span>Total</span><strong>{formatMoney(movementTotal)}</strong>
        </div>
        <div><span>Staged</span><strong>{formatMoney(draftTotal)}</strong></div>
        <div
          class:balanced={Math.abs(draftRemaining) < CENT}
          class:error={draftRemaining < -CENT}
        >
          <span>Remaining</span><strong>{formatMoney(draftRemaining)}</strong>
        </div>
      </div>
      <div class="composer-body">
        {#if hasSuggestion}<div class="suggestion">
            <div>
              <strong
                >{suggestionApplied
                  ? "Auto-matched"
                  : "Exact Match Found"}</strong
              ><span
                >{selectedMovement.suggestedLineIds.length} transaction{selectedMovement
                  .suggestedLineIds.length === 1
                  ? ""
                  : "s"} total exactly {formatMoney(movementTotal)}.</span
              >
            </div>
            {#if !suggestionApplied}<button
                type="button"
                onclick={applySuggestion}>Use Suggested Match</button
              >{/if}
          </div>{/if}
        <div class="section-heading">
          <div>
            <h3>Compatible Statement Lines</h3>
            <p>
              {movesIn ? "Money In" : "Money Out"} transactions on
              {selectedMovement.accountName ?? "this account"}
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
              )?.amount ?? 0}
            <div class="allocation-line" class:selected={!!draft}>
              <label class="line-select"
                ><input
                  type="checkbox"
                  checked={!!draft}
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
                    · {formatDate(line.date)}</small
                  ></span
                ></label
              >
              <div class="line-money">
                <small
                  >{formatMoney(line.remainingAmount + savedHere)} available</small
                >{#if draft}<label
                    ><span>{mainCurrencySymbol()}</span><input
                      name={`allocation-${line.id}`}
                      aria-label={`Allocation amount for ${line.description || "statement transaction"}`}
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
              title="No compatible transactions"
              sub={`Upload a statement for ${selectedMovement.accountName ?? "this account"} containing ${movesIn ? "money in" : "money out"} transactions with an available balance.`}
              >{#snippet icon()}<Banknote size={20} />{/snippet}</EmptyState
            >{/if}
        </div>
      </div>
      <footer class="composer-foot">
        <div>
          <span>Staged total</span><strong>{formatMoney(draftTotal)}</strong
          ><small class:error={draftRemaining < -CENT}
            >{draftRemaining < -CENT
              ? `${formatMoney(Math.abs(draftRemaining))} over record total`
              : `${formatMoney(draftRemaining)} remaining`}</small
          >
        </div>
        <div class="composer-actions">
          <button
            class="sheet-btn"
            type="button"
            disabled={!manuallyEdited || saving}
            onclick={() => (drafts = [...initialDrafts])}>Reset</button
          ><button
            class="sheet-btn-primary"
            type="button"
            disabled={!data.permissions.change ||
              saving ||
              !dirty ||
              draftRemaining < -CENT}
            onclick={saveAndAdvance}
            >{saving
              ? "Saving…"
              : visibleMovements.some(
                    (movement) =>
                      movement.movementId !== selectedMovementId &&
                      Math.abs(movement.remainingAmount ?? 0) >= CENT,
                  )
                ? "Save & Next"
                : "Save"}</button
          >
        </div>
      </footer>
    </section>{/if}
{/snippet}

<Sheet.Root bind:open={mobileFilterOpen}
  ><Sheet.Content
    side="bottom"
    style="border-radius:16px 16px 0 0; max-height:85vh; overflow-y:auto; padding:20px 20px calc(20px + var(--safe-bottom));"
  >
    <div
      style="display:flex; align-items:center; justify-content:space-between; margin-bottom:16px;"
    >
      <div style="font-size:15px; font-weight:600;">Filters</div>
      <Sheet.Close class="sheet-close" aria-label="Close filters"
        ><X size={16} /></Sheet.Close
      >
    </div>
    <div style="margin-bottom:16px;">
      <div class="filter-mobile-head">
        <span>Status</span>
        {#if tab === "records" ? recordStatusActive : statementStatusActive}<button
            type="button"
            class="filter-mobile-clear"
            onclick={() => {
              if (tab === "records") recordStatuses = ["review"];
              else statementStatuses = ["active"];
              updateUrl();
            }}>Clear</button
          >{/if}
      </div>
      {#if tab === "records"}
        <div class="filter-checklist">
          <button
            type="button"
            class="filter-check"
            class:checked={recordStatuses.includes("review")}
            onclick={() => toggleRecordStatus("review")}
            ><span class="filter-checkbox"
              >{#if recordStatuses.includes("review")}<Check
                  size={11}
                />{/if}</span
            >Needs Review
            <span class="tab-count">{reviewMovements.length}</span></button
          ><button
            type="button"
            class="filter-check"
            class:checked={recordStatuses.includes("matched")}
            onclick={() => toggleRecordStatus("matched")}
            ><span class="filter-checkbox"
              >{#if recordStatuses.includes("matched")}<Check
                  size={11}
                />{/if}</span
            >Matched
            <span class="tab-count">{matchedMovements.length}</span></button
          >
        </div>
      {:else}
        <div class="filter-checklist">
          <button
            type="button"
            class="filter-check"
            class:checked={statementStatuses.includes("active")}
            onclick={() => toggleStatementStatus("active")}
            ><span class="filter-checkbox"
              >{#if statementStatuses.includes("active")}<Check
                  size={11}
                />{/if}</span
            >Active
            <span class="tab-count">{activeStatements.length}</span></button
          ><button
            type="button"
            class="filter-check"
            class:checked={statementStatuses.includes("completed")}
            onclick={() => toggleStatementStatus("completed")}
            ><span class="filter-checkbox"
              >{#if statementStatuses.includes("completed")}<Check
                  size={11}
                />{/if}</span
            >Completed
            <span class="tab-count">{completedStatements.length}</span></button
          >
        </div>
      {/if}
    </div>
    {#if tab === "records"}<div style="margin-bottom:20px;">
        <div class="filter-mobile-head">
          <span>Date range</span>
          {#if from || to}<button
              type="button"
              class="filter-mobile-clear"
              onclick={() => {
                from = "";
                to = "";
                updateUrl();
                void invalidateAll();
              }}>Clear</button
            >{/if}
        </div>
        <div style="display:flex; flex-direction:column; gap:8px;">
          <span class="mini-label">From</span>
          <DatePicker
            value={from}
            placeholder="From date"
            onchange={(value) => {
              from = value;
              updateUrl();
              void invalidateAll();
            }}
          />
          <span class="mini-label">To</span>
          <DatePicker
            value={to}
            placeholder="To date"
            onchange={(value) => {
              to = value;
              updateUrl();
              void invalidateAll();
            }}
          />
        </div>
      </div>{/if}
    <button
      class="sheet-btn-primary"
      style="width:100%; justify-content:center;"
      type="button"
      onclick={() => (mobileFilterOpen = false)}>Show results</button
    ></Sheet.Content
  ></Sheet.Root
>

<Sheet.Root
  open={compactWorkspace && !!selectedMovement}
  onOpenChange={(open) => {
    if (!open) closeMovement();
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
        <div class="statement-account">
          <span class="mini-label"
            ><Wallet size={13} aria-hidden="true" /> Account</span
          >
          <select
            name="statement-account"
            aria-label="Account this statement belongs to"
            value={selectedStatement.accountId ?? ""}
            disabled={!data.permissions.change}
            onchange={(event) =>
              reassignStatement(Number(event.currentTarget.value))}
            >{#if selectedStatement.accountId == null}<option value=""
                >Not assigned yet</option
              >{/if}{#each data.accounts as account (account.id)}<option
                value={account.id}>{account.name}</option
              >{/each}</select
          >
          <small
            >Only records that touched this account are offered as matches for
            its transactions.</small
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
              >{selectedStatement.extractionError}
              {data.permissions.add
                ? "Retry extraction below, or delete this statement and upload a clearer PDF or image."
                : "Delete this statement and upload a clearer PDF or image."}</span
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
                  >{#if data.permissions.add && line.allocatedAmount < CENT}<button
                      class="line-transfer"
                      type="button"
                      onclick={() => openTransfer(line)}
                      ><ArrowLeftRight size={13} />Record as a transfer from
                      another account</button
                    >{/if}{#if data.permissions.delete}<button
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
                : selectedStatement.extractionState ===
                    StatementExtractionState.Failed
                  ? "Retry extraction, or delete this statement and upload a clearer file."
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
            >{/if}<Sheet.Close class="sheet-btn">Close</Sheet.Close
          >{#if data.permissions.add && selectedStatement.extractionState === StatementExtractionState.Failed}<button
              class="sheet-btn-primary"
              type="button"
              disabled={retrying}
              onclick={retryExtraction}
              >{retrying ? "Retrying…" : "Retry Extraction"}</button
            >{/if}
        </div>
      </div>{/if}</Sheet.Content
  ></Sheet.Root
>

<Sheet.Root
  open={uploadOpen}
  onOpenChange={(open) => {
    if (!open) uploadOpen = false;
  }}
  ><Sheet.Content
    side={panelSide}
    class="recon-sheet"
    style="gap:0; width:500px; max-width:95vw; height:100dvh; border-radius:0;"
    ><div class="sheet-head">
      <div>
        <span class="sheet-eyebrow"><Upload size={13} />Bank Statement</span>
        <h2 class="sheet-title-text">Upload a statement</h2>
      </div>
      <Sheet.Close class="sheet-close" aria-label="Close upload"
        ><X size={16} /></Sheet.Close
      >
    </div>
    <div class="upload-body">
      <div class="field">
        <span class="field-label">Account</span>
        <select
          name="upload-account"
          aria-label="Account this statement belongs to"
          value={uploadAccountId ?? ""}
          onchange={(event) =>
            (uploadAccountId = Number(event.currentTarget.value) || null)}
          >{#if data.accounts.length === 0}<option value=""
              >No accounts to choose from</option
            >{/if}{#each data.accounts as account (account.id)}<option
              value={account.id}>{account.name}</option
            >{/each}</select
        >
        <small class="field-hint"
          >The statement's transactions can only be matched against records that
          touched this account.</small
        >
      </div>
      <div class="field">
        <span class="field-label">File</span>
        <input
          bind:this={uploadInput}
          class="sr-only"
          type="file"
          accept="application/pdf,image/png,image/jpeg"
          onchange={chooseUploadFile}
          aria-label="Choose bank statement"
        /><button
          class="sheet-btn"
          type="button"
          onclick={() => uploadInput?.click()}
          ><FileText size={14} />{uploadFileName ||
            "Choose a PDF, JPEG or PNG"}</button
        >
        <small class="field-hint">Up to 15 MB.</small>
      </div>
    </div>
    <div class="sheet-foot">
      <div class="sheet-foot-actions">
        <Sheet.Close class="sheet-btn">Cancel</Sheet.Close><button
          class="sheet-btn-primary"
          type="button"
          disabled={!uploadFileName || !uploadAccountId || uploading}
          onclick={upload}>{uploading ? "Uploading…" : "Upload"}</button
        >
      </div>
    </div></Sheet.Content
  ></Sheet.Root
>

<Sheet.Root
  open={!!transferLine}
  onOpenChange={(open) => {
    if (!open) closeTransfer();
  }}
  ><Sheet.Content
    side={panelSide}
    class="recon-sheet"
    style="gap:0; width:500px; max-width:95vw; height:100dvh; border-radius:0;"
    ><div class="sheet-head">
      <div>
        <span class="sheet-eyebrow"
          ><ArrowLeftRight size={13} />Money You Moved</span
        >
        <h2 class="sheet-title-text">Record as a transfer</h2>
      </div>
      <Sheet.Close class="sheet-close" aria-label="Close transfer"
        ><X size={16} /></Sheet.Close
      >
    </div>
    {#if transferLine}<div class="upload-body">
        <div class="detail-amount">
          <span class="detail-amount-val"
            >{formatMoney(transferLine.amount)}</span
          >
        </div>
        <p class="transfer-explain">
          Nothing was earned or spent here — money moved between two of your own
          accounts, so no record was ever created for it. Saving this creates
          that record and matches this transaction to it.
        </p>
        <div class="field">
          <span class="field-label"
            >{transferLine.direction === StatementDirection.In
              ? "Money came from"
              : "Money went to"}</span
          >
          <select
            name="transfer-account"
            aria-label="The other account in this transfer"
            value={transferAccountId ?? ""}
            onchange={(event) =>
              (transferAccountId = Number(event.currentTarget.value) || null)}
            >{#if transferTargets.length === 0}<option value=""
                >No other account to choose from</option
              >{/if}{#each transferTargets as account (account.id)}<option
                value={account.id}>{account.name}</option
              >{/each}</select
          >
        </div>
        <div class="field">
          <span class="field-label">Description</span>
          <input
            name="transfer-description"
            autocomplete="off"
            bind:value={transferDescription}
            placeholder="Transfer"
          />
        </div>
        <div class="field">
          <span class="field-label">Date</span>
          <span class="field-static">{formatDate(transferLine.date)}</span>
          <small class="field-hint"
            >Taken from the bank transaction, so the two always agree.</small
          >
        </div>
      </div>
      <div class="sheet-foot">
        <div class="sheet-foot-actions">
          <Sheet.Close class="sheet-btn">Cancel</Sheet.Close><button
            class="sheet-btn-primary"
            type="button"
            disabled={!transferAccountId || transferSaving}
            onclick={saveTransfer}
            >{transferSaving ? "Saving…" : "Save & Match"}</button
          >
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
<ConfirmDialog
  bind:open={bulkOpen}
  title="Save Exact Matches?"
  description={`Allocate the suggested statement transactions for ${bulkMatchable.length} record${bulkMatchable.length === 1 ? "" : "s"}. Records that still need review are left untouched.`}
  confirmLabel="Save Matches"
  onConfirm={runAutoMatch}
/>

<style>
  .reconciliation-screen {
    min-width: 0;
  }
  .bulk-match-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    padding: 0 10px;
    border: 1px solid var(--primary);
    border-radius: 8px;
    background: var(--accent);
    color: var(--primary);
    font: inherit;
    font-size: 13px;
    font-weight: 500;
    white-space: nowrap;
    cursor: pointer;
  }
  .bulk-match-btn:hover:not(:disabled) {
    background: var(--primary);
    color: var(--primary-foreground);
  }
  .bulk-match-btn:disabled {
    opacity: 0.55;
    cursor: default;
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
  .recon-work {
    padding-top: 12px;
  }
  .filter-checklist {
    padding: 5px;
    min-width: 190px;
  }
  .filter-check {
    display: flex;
    align-items: center;
    gap: 9px;
    width: 100%;
    border: 0;
    background: none;
    font: inherit;
    font-size: 13px;
    color: var(--foreground);
    padding: 7px 8px;
    border-radius: 7px;
    cursor: pointer;
    text-align: left;
  }
  .filter-check:hover {
    background: var(--accent);
  }
  .filter-check .tab-count {
    margin-left: auto;
  }
  .filter-checkbox {
    display: grid;
    place-items: center;
    width: 16px;
    height: 16px;
    flex: none;
    border-radius: 4px;
    border: 1.5px solid var(--border-strong);
    background: var(--card);
    color: var(--primary-foreground);
  }
  .filter-check.checked .filter-checkbox {
    border-color: var(--primary);
    background: var(--primary);
  }
  .filter-daterange {
    padding: 12px 14px;
    min-width: 200px;
  }
  .filter-daterange-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
  }
  .filter-daterange-head > span:first-child {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted-foreground);
  }
  .filter-daterange-head button,
  .filter-mobile-clear {
    border: 0;
    background: none;
    color: var(--primary);
    cursor: pointer;
    font: inherit;
    font-size: 11px;
    font-weight: 600;
    padding: 0;
  }
  .filter-daterange .mini-label {
    display: block;
    margin: 8px 0 4px;
  }
  .filter-daterange .mini-label:first-of-type {
    margin-top: 0;
  }
  .filter-mobile-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted-foreground);
    margin-bottom: 10px;
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
  .statement-pane {
    display: contents;
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
    /* A scroll container should also be the containing block for its own
       subtree. Nothing here is absolutely positioned today, but without this
       a future one would resolve against some ancestor outside the
       scrollport — and the outer shells (`.screen`, `.work`, `.work-main`)
       are `overflow: hidden`, which still scrolls programmatically while
       showing no scrollbar. A stray absolute box up there turns a
       scroll-into-view into a silently unrecoverable blank page. */
    position: relative;
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
  .line-select {
    min-width: 0;
    flex: 1;
    display: flex;
    align-items: center;
    gap: 9px;
    cursor: pointer;
  }
  /* Visually hidden but still focusable and label-activatable. Deliberately
     kept IN FLOW at zero size rather than `position: absolute`: an
     out-of-flow box resolves against its nearest positioned ancestor, and
     with none in this tree it escaped `.composer-body`'s scrollport
     entirely. Focusing a row near the bottom of a long list then made the
     browser scroll an outer shell by thousands of px to "reveal" it, taking
     the whole page out of view. In flow, the input sits inside the
     scrollport, so focus scrolls the list — which is what we want.
     The focus ring is drawn on `.fake-check` via `:focus-within`, so the
     input itself needs no size of its own. */
  .line-select > input {
    width: 0;
    height: 0;
    margin: 0;
    appearance: none;
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
  .line-delete,
  .line-transfer {
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
    text-align: left;
    cursor: pointer;
  }
  .line-transfer {
    color: var(--primary);
  }
  /* Which account a statement belongs to decides what can match it, so it sits
     at the top of the sheet rather than among the counts. */
  .statement-account {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 16px;
  }
  .statement-account .mini-label {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .statement-account select {
    height: 34px;
    padding: 0 9px;
    border: 1px solid var(--input);
    border-radius: 8px;
    background: var(--card);
    color: var(--foreground);
    font: inherit;
    font-size: 13px;
  }
  .statement-account small {
    font-size: 11.5px;
    color: var(--muted-foreground);
    line-height: 1.5;
  }
  .upload-body {
    flex: 1;
    overflow-y: auto;
    padding: 20px 22px;
  }
  .upload-body select,
  .upload-body input {
    width: 100%;
    height: 34px;
    padding: 0 9px;
    border: 1px solid var(--input);
    border-radius: 8px;
    background: var(--card);
    color: var(--foreground);
    font: inherit;
    font-size: 13px;
  }
  .upload-body .sheet-btn {
    width: 100%;
    justify-content: flex-start;
    gap: 7px;
  }
  .field-static {
    display: block;
    font-size: 13px;
    color: var(--muted-foreground);
  }
  .transfer-explain {
    margin: 0 0 18px;
    font-size: 12.5px;
    color: var(--muted-foreground);
    line-height: 1.6;
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
  @media (min-width: 1001px) {
    .reconciliation-screen {
      height: 100%;
      min-height: 0;
      contain: size layout paint;
    }
    .reconciliation-screen > :global(.work),
    .recon-work,
    .split-workspace,
    .record-pane,
    .statement-pane {
      min-height: 0;
      overflow: hidden;
    }
    .recon-work {
      padding-bottom: 20px;
    }
    .record-pane,
    .statement-pane {
      display: flex;
      flex-direction: column;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--card);
      box-shadow: var(--shadow-sm);
    }
    .statement-pane {
      flex: 1;
    }
    .record-pane .table-card,
    .statement-pane .table-card {
      flex: 1;
      min-height: 0;
      overflow: auto;
      overscroll-behavior: contain;
      border: 0;
      border-radius: 0;
      box-shadow: none;
      background: transparent;
    }
    .record-pane .table-foot,
    .statement-pane .table-foot {
      flex: none;
      margin: 0;
      padding: 12px 18px;
      border-top: 1px solid var(--border);
      background: var(--card);
    }
  }
  @media (max-width: 767px) {
    .recon-work {
      padding-top: 10px;
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
