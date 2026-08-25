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
  active: boolean;
  postingEligible: boolean;
};

export type AccountCreateInput = {
  name: string;
  type: AccountTypeCode;
  subType?: AccountSubTypeCode;
};

export type AccountUpdateInput = Partial<{
  name: string;
  type: AccountTypeCode;
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
