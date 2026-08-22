import type {
  LedgerRecordKindCode,
  StatementDirectionCode,
  StatementExtractionStateCode,
} from "$lib/enums.js";
import type { Minor } from "$lib/server/ledger/types.js";

/**
 * Two money representations live here, and the split is deliberate.
 *
 * A *movement* is whole cents (`Minor`), signed, and every comparison against a
 * statement line is made in cents — that is what removed the float tolerance the
 * candidate model used to need (D-02). An *allocation* is still the decimal
 * `amount` column it always was, because how a bank line is divided across
 * movements is unchanged by this feature (FR-022), and `EPSILON` is the
 * tolerance that arithmetic keeps needing.
 */
export const EPSILON = 0.005;
export const MATCH_DATE_WINDOW_DAYS = 7;
export const round2 = (value: number) => Math.round(value * 100) / 100;

export type BankStatementRow = {
  id: number;
  originalFilename: string;
  storedFilePath: string;
  extractionState: StatementExtractionStateCode;
  extractionError: string | null;
  uploadedBy: number | null;
  createdAt: string;
  updatedAt: string;
  /** The account this statement's lines moved. Null only before the upgrade backfilled it (FR-034a). */
  accountId: number | null;
};
export type StatementLineRow = {
  id: number;
  statementId: number;
  date: string;
  description: string;
  /** Always positive; the sign is carried by `direction`. */
  amount: number;
  direction: StatementDirectionCode;
  note: string;
  createdAt: string;
};
export type ReconciliationAllocation = {
  id: number;
  lineId: number;
  /**
   * The ledger movement this bank line covers. Null means an allocation the
   * upgrade has not repointed yet — read defensively, never written (FR-034).
   */
  movementId: number | null;
  amount: number;
  itemAmountSnapshot: number;
  createdBy: number | null;
  createdAt: string;
};
export type AllocationInput = Pick<
  ReconciliationAllocation,
  "movementId" | "amount"
>;

/**
 * One side of one record, on the account a statement belongs to — the only
 * thing that can be offered as a match for that statement's lines (D-11).
 *
 * `amountMinor` is the movement's own signed figure and is what every rule
 * compares. `amount` is the same figure as a positive decimal, because
 * allocation amounts are decimals and dividing a line across movements is
 * arithmetic this feature does not change.
 */
export type MovementCandidate = {
  movementId: number;
  recordId: number;
  accountId: number;
  /** Signed whole cents on `accountId`. Positive = money in. */
  amountMinor: Minor;
  /** `|amountMinor|` as a decimal, for the allocation composer. */
  amount: number;
  /** The record number, or its description when it carries no number. */
  label: string;
  date: string;
  description: string;
  contactName: string | null;
  kind?: LedgerRecordKindCode;
  accountName?: string;
  allocatedAmount?: number;
  remainingAmount?: number;
  allocationCount?: number;
};

export type RankedCandidate = {
  movementId: number;
  recordId: number;
  label: string;
  date: string;
  /** Signed whole cents, so nothing here is compared as a float. */
  amountMinor: Minor;
  score: number;
};
export type ParsedLine = {
  date: string;
  description: string;
  amount: number;
  direction: StatementDirectionCode;
};
/** A statement row with the name of the account it belongs to, for display. */
export type StatementWithAccount = BankStatementRow & {
  accountName: string | null;
};
export type StatementSummary = StatementWithAccount & {
  dateFrom: string | null;
  dateTo: string | null;
  totalLines: number;
  matchedCount: number;
  remainingCount: number;
  remainingAmount: number;
  completed: boolean;
};
