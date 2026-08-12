import type {
  ReconItemTypeCode,
  StatementDirectionCode,
  StatementExtractionStateCode,
} from "$lib/enums.js";

export const EPSILON = 0.005;
export const MATCH_DATE_WINDOW_DAYS = 7;
export const round2 = (value: number) => Math.round(value * 100) / 100;
export const mainAmount = (item: { amount: number; exchangeRate: number }) =>
  round2(item.amount * item.exchangeRate);

export type BankStatementRow = {
  id: number;
  originalFilename: string;
  storedFilePath: string;
  extractionState: StatementExtractionStateCode;
  extractionError: string | null;
  uploadedBy: number | null;
  createdAt: string;
  updatedAt: string;
};
export type StatementLineRow = {
  id: number;
  statementId: number;
  date: string;
  description: string;
  amount: number;
  direction: StatementDirectionCode;
  note: string;
  createdAt: string;
};
export type ReconciliationAllocation = {
  id: number;
  lineId: number;
  itemType: ReconItemTypeCode;
  itemId: number;
  amount: number;
  itemAmountSnapshot: number;
  createdBy: number | null;
  createdAt: string;
};
export type AllocationInput = Pick<
  ReconciliationAllocation,
  "itemType" | "itemId" | "amount"
>;
export type BankFacingItem = {
  itemType: ReconItemTypeCode;
  itemId: number;
  label: string;
  date: string;
  amount: number;
  exchangeRate: number;
  contactName?: string | null;
  claimId?: number | null;
  allocatedAmount?: number;
  remainingAmount?: number;
  allocationCount?: number;
};
export type RankedCandidate = {
  itemType: ReconItemTypeCode;
  itemId: number;
  label: string;
  date: string;
  amount: number;
  score: number;
};
export type ParsedLine = {
  date: string;
  description: string;
  amount: number;
  direction: StatementDirectionCode;
};
export type StatementSummary = BankStatementRow & {
  dateFrom: string | null;
  dateTo: string | null;
  totalLines: number;
  matchedCount: number;
  remainingCount: number;
  remainingAmount: number;
  completed: boolean;
};
