// The shared contract every reconciliation pure module, the service, and the
// route layer code against. Types and constants only — the logic lives in
// balance.ts, matching.ts, session-rules.ts, drift.ts, and statement-parse.ts,
// each of which is pure over the row shapes declared here (no `db` handle).
//
// See specs/001-bank-reconciliation/data-model.md and contracts/api.md.

import type {
	LeftoverAnnotationCode,
	ReconItemTypeCode,
	ReconSessionStatusCode,
	StatementDirectionCode,
	StatementExtractionStateCode
} from '$lib/enums.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Half a cent. `amount` is stored as SQLite REAL, so an exact `===` comparison
 * would occasionally report a phantom difference of ~1e-15. This is below any
 * real-world discrepancy and above float noise.
 */
export const EPSILON = 0.005;

/**
 * A statement line and an Akaun item are only candidates when their dates are
 * within this many days of each other. Wide enough to absorb weekend and
 * clearing lag, narrow enough that a monthly-recurring payment of the same
 * amount cannot outrank the right one. Deliberately a module constant with a
 * comment, not a user-facing setting — retuning it is a test change.
 */
export const MATCH_DATE_WINDOW_DAYS = 7;

/**
 * Round to 2 dp. Every module rounds a row's main-currency value with this
 * before summing or comparing, so the difference the user sees on screen is
 * the difference the system computed.
 */
export function round2(value: number): number {
	return Math.round(value * 100) / 100;
}

/**
 * A row's value in the app's main currency, rounded per row. Lives beside
 * EPSILON so balance.ts and matching.ts cannot round differently from each
 * other — that divergence would be exactly the silent wrongness the tests exist
 * to catch.
 */
export function mainAmount(item: { amount: number; exchangeRate: number }): number {
	return round2(item.amount * item.exchangeRate);
}

// ---------------------------------------------------------------------------
// Database row shapes (plain objects — the query layer fetches, modules compute)
// ---------------------------------------------------------------------------

export type SessionRow = {
	id: number;
	startingBalance: number;
	/** YYYY-MM-DD */
	startingDate: string;
	/** YYYY-MM-DD */
	periodEndDate: string;
	statementEndingBalance: number;
	/** Snapshot of the Step 1 result at close; null while open. */
	computedBalance: number | null;
	status: ReconSessionStatusCode;
	clearedCount: number;
	unclearedCount: number;
	unmatchedLineCount: number;
	statementState: StatementExtractionStateCode;
	statementError: string | null;
	closedAt: string | null;
	createdBy: number | null;
	updatedBy: number | null;
	createdAt: string;
};

export type StatementLineRow = {
	id: number;
	sessionId: number;
	/** YYYY-MM-DD */
	date: string;
	description: string;
	/** Always positive; the sign is carried by `direction`. */
	amount: number;
	direction: StatementDirectionCode;
	/** Non-null ⟺ the line is cleared. There is no stored `cleared` column. */
	matchedItemType: ReconItemTypeCode | null;
	matchedItemId: number | null;
	note: string;
	/** Relative path of the uploaded statement; null when added by hand. */
	sourceFile: string | null;
	createdAt: string;
};

export type ItemStateRow = {
	id: number;
	itemType: ReconItemTypeCode;
	itemId: number;
	clearedSessionId: number | null;
	clearedLineId: number | null;
	/** Main-currency value at the moment of clearing — the drift baseline. */
	clearedAmount: number | null;
	clearedAt: string | null;
	annotation: LeftoverAnnotationCode | null;
	annotationSessionId: number | null;
	annotationNote: string;
	updatedBy: number | null;
	updatedAt: string;
};

// ---------------------------------------------------------------------------
// Derived concept: a bank-facing item
// ---------------------------------------------------------------------------

/**
 * One Akaun record that can move the bank balance: a direct (unclaimed)
 * expense, a claim, or an income. A *claimed* expense is never bank-facing —
 * it rides inside its claim.
 *
 * `amount` is the record's own amount in `currency`; multiply by
 * `exchangeRate` (via `mainAmount`) for its main-currency value. For a claim
 * the query supplies `amount` as the already-derived main-currency total
 * (Σ round2(expense.amount × expense.exchangeRate) over its member expenses)
 * with `exchangeRate` of 1, since a claim has no amount column of its own.
 */
export type BankFacingItem = {
	itemType: ReconItemTypeCode;
	itemId: number;
	/** Display label, e.g. "EX20260714-002 · Grab ride". */
	label: string;
	/** YYYY-MM-DD */
	date: string;
	amount: number;
	exchangeRate: number;
	contactName?: string | null;
	/** Set on an expense that belongs to a claim — such a row is never bank-facing. */
	claimId?: number | null;
	/** True when this item is already cleared in the session being worked. */
	cleared?: boolean;
	clearedSessionId?: number | null;
	clearedLineId?: number | null;
	annotation?: LeftoverAnnotationCode | null;
};

// ---------------------------------------------------------------------------
// balance.ts
// ---------------------------------------------------------------------------

export type BalanceInput = {
	startingBalance: number;
	incomes: BankFacingItem[];
	directExpenses: BankFacingItem[];
	claims: BankFacingItem[];
};

export type Step1Result = {
	/** startingBalance + incomeTotal − expenseTotal − claimTotal */
	expected: number;
	incomeTotal: number;
	expenseTotal: number;
	claimTotal: number;
	inScopeCounts: { incomes: number; directExpenses: number; claims: number };
};

export type BalanceComparison = {
	/** |expected − entered| < EPSILON */
	matched: boolean;
	/** expected − entered. Positive = the books show more than the statement. */
	difference: number;
};

// ---------------------------------------------------------------------------
// matching.ts
// ---------------------------------------------------------------------------

export type RankedCandidate = {
	itemType: ReconItemTypeCode;
	itemId: number;
	label: string;
	/** YYYY-MM-DD */
	date: string;
	/** Main-currency value, per `mainAmount`. */
	amount: number;
	score: number;
};

// ---------------------------------------------------------------------------
// statement-parse.ts
// ---------------------------------------------------------------------------

export type ParsedLine = {
	/** YYYY-MM-DD, coerced from whatever the statement printed. */
	date: string;
	description: string;
	/** Always positive — a negative extracted amount becomes direction Out. */
	amount: number;
	direction: StatementDirectionCode;
};

// ---------------------------------------------------------------------------
// drift.ts
// ---------------------------------------------------------------------------

export type DriftEntry = {
	itemType: ReconItemTypeCode;
	itemId: number;
	/** The main-currency value recorded when the item was cleared. */
	clearedAmount: number;
	/** Its main-currency value now; null when the record no longer exists. */
	currentAmount: number | null;
};

export type DriftReport = {
	/** Cleared items whose main-currency value moved by more than EPSILON. */
	changed: DriftEntry[];
	/** Cleared items whose underlying record has since been deleted. */
	deleted: DriftEntry[];
};

// ---------------------------------------------------------------------------
// API / SSE payload shapes (contracts/api.md, contracts/events.md)
// ---------------------------------------------------------------------------

export type SessionSummary = {
	id: number;
	startingBalance: number;
	startingDate: string;
	periodEndDate: string;
	statementEndingBalance: number;
	computedBalance: number | null;
	status: ReconSessionStatusCode;
	/** computed − entered; null while open. */
	difference: number | null;
	clearedCount: number;
	unclearedCount: number;
	unmatchedLineCount: number;
	statementState: StatementExtractionStateCode;
	statementError: string | null;
	/** drift.ts over this session's cleared items. */
	hasDrift: boolean;
	/** session-rules.ts: this is the newest session and it is closed. */
	canReopen: boolean;
	canDelete: boolean;
	closedAt: string | null;
	createdBy: number | null;
	createdAt: string;
};

/** A statement line as the API and the workspace see it. */
export type StatementLine = StatementLineRow & {
	/** Resolved for display; null when the line is unmatched. */
	matchedItemLabel: string | null;
	/** Derived by findDuplicateLines(), never stored. */
	isDuplicate: boolean;
	/** Top-ranked candidate, or null when nothing is in range. */
	suggestion: RankedCandidate | null;
};
