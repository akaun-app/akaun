<script lang="ts">
  import { ExpenseStatus } from "$lib/enums.js";

  type Tone = { label: string; tone: string };
  // Accepts either an ExpenseStatus INT code or a string label. Labels are used
  // wherever a status's integer codes would collide with the expense ones
  // (reconciliation, quotations, invoices, ledger records).
  let { status }: { status: number | string } = $props();

  const byCode: Record<number, Tone> = {
    [ExpenseStatus.Unpaid]: { label: "Unpaid", tone: "red" },
    [ExpenseStatus.Pending]: { label: "Pending", tone: "amber" },
    [ExpenseStatus.Paid]: { label: "Paid", tone: "green" },
  };
  const byLabel: Record<string, Tone> = {
    unpaid: { label: "Unpaid", tone: "red" },
    pending: { label: "Pending", tone: "amber" },
    paid: { label: "Paid", tone: "green" },
    received: { label: "Received", tone: "green" },
    // Ledger records: a record with no side on a shared owed account is paid the
    // moment it exists; one that owes somebody reads owed until settlements
    // cover it, and part-paid while they cover only some of it (FR-012–FR-014).
    owed: { label: "Owed", tone: "red" },
    "part-paid": { label: "Part paid", tone: "amber" },
    settled: { label: "Settled", tone: "green" },
    // Quotation statuses (labels from QuotationStatusLabels in enums.ts)
    draft: { label: "Draft", tone: "" },
    sent: { label: "Sent", tone: "blue" },
    accepted: { label: "Accepted", tone: "green" },
    declined: { label: "Declined", tone: "red" },
    converted: { label: "Converted", tone: "blue" },
    // Invoice-only
    cancelled: { label: "Cancelled", tone: "red" },
    // Derived statuses (never stored, computed at read time)
    expired: { label: "Expired", tone: "amber" },
    overdue: { label: "Overdue", tone: "red" },
    // Reconciliation statuses are passed by label because their integer codes
    // overlap the expense status codes above.
    open: { label: "Open", tone: "blue" },
    active: { label: "Active", tone: "amber" },
    extracting: { label: "Extracting", tone: "blue" },
    failed: { label: "Failed", tone: "red" },
    matched: { label: "Matched", tone: "green" },
    leftovers: { label: "Leftovers", tone: "amber" },
    "exact-match": { label: "Exact match", tone: "green" },
    "partial-match": { label: "Partial", tone: "amber" },
    "no-match": { label: "No match", tone: "gray" },
  };

  const m = $derived(
    typeof status === "number"
      ? (byCode[status] ?? byCode[ExpenseStatus.Unpaid])
      : (byLabel[status] ?? byLabel.unpaid),
  );
</script>

<span class="statusbadge tone-{m.tone}">
  <span class="statusdot"></span>{m.label}
</span>
