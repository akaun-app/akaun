import type {
  AccountSubTypeCode,
  AccountTypeCode,
  DefaultAccountPurposeCode,
} from "$lib/enums.js";

/** The role-free account contract shared by account API consumers. */
export type AccountView = {
  id: number;
  code: number;
  name: string;
  type: AccountTypeCode;
  /**
   * Absent for Equity. For Asset/Liability, `null` means "needs review". For
   * Expense/Revenue, `null` defaults safely to Operating.
   */
  subType: AccountSubTypeCode | null;
  parentId: number | null;
  active: boolean;
  hasChildren: boolean;
  postingEligible: boolean;
  directBalanceMinor: number;
  rolledUpBalanceMinor: number;
  path: string[];
};

export type AccountCreateInput = {
  name: string;
  type: AccountTypeCode;
  parentId?: number | null;
  subType?: AccountSubTypeCode;
};

export type AccountUpdateInput = Partial<{
  name: string;
  type: AccountTypeCode;
  parentId: number | null;
  active: boolean;
  subType: AccountSubTypeCode;
}>;

export type AccountDefaultView = {
  purpose: DefaultAccountPurposeCode;
  requiredType: AccountTypeCode;
  account: AccountView | null;
  valid: boolean;
};

export type AccountDefaultInput = {
  purpose: DefaultAccountPurposeCode;
  accountId: number;
};
