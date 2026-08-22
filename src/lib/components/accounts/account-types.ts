import type { AccountTypeCode, DefaultAccountPurposeCode } from "$lib/enums.js";

/** The role-free account contract shared by account API consumers. */
export type AccountView = {
  id: number;
  code: number;
  name: string;
  type: AccountTypeCode;
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
};

export type AccountUpdateInput = Partial<{
  name: string;
  type: AccountTypeCode;
  parentId: number | null;
  active: boolean;
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
