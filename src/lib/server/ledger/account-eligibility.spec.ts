import { describe, expect, it } from "vitest";
import {
  canAddAccountChild,
  canChangeAccountType,
  canDeactivateAccount,
  canDeleteAccount,
  isPostingEligible,
  postingEligibility,
  type AccountDependencyState,
} from "./account-eligibility.js";

const FREE: AccountDependencyState = {
  movementCount: 0,
  childCount: 0,
  statementCount: 0,
  defaultCount: 0,
  otherDependencyCount: 0,
  activeDescendantCount: 0,
};

describe("account posting eligibility", () => {
  it("allows only active leaves", () => {
    expect(isPostingEligible({ active: true, hasChildren: false })).toBe(true);
    expect(isPostingEligible({ active: false, hasChildren: false })).toBe(
      false,
    );
    expect(isPostingEligible({ active: true, hasChildren: true })).toBe(false);
  });

  it("gives a plain reason when an account cannot receive movements", () => {
    expect(postingEligibility({ active: false, hasChildren: false })).toEqual({
      ok: false,
      reason: "This account is inactive.",
    });
    expect(postingEligibility({ active: true, hasChildren: true })).toEqual({
      ok: false,
      reason: "This account is a heading and cannot receive movements.",
    });
  });
});

describe("protected account lifecycle", () => {
  it.each([
    ["movements", { movementCount: 1 }],
    ["children", { childCount: 1 }],
    ["statement history", { statementCount: 1 }],
    ["a saved default", { defaultCount: 1 }],
    ["another record", { otherDependencyCount: 1 }],
  ] as const)(
    "refuses deletion when %s depend on the account",
    (_label, dependency) => {
      expect(canDeleteAccount({ ...FREE, ...dependency }).ok).toBe(false);
    },
  );

  it("allows deletion when the account has no dependencies", () => {
    expect(canDeleteAccount(FREE)).toEqual({ ok: true });
  });

  it.each([
    ["movements", { movementCount: 1 }],
    ["children", { childCount: 1 }],
    ["statement history", { statementCount: 1 }],
    ["a saved default", { defaultCount: 1 }],
  ] as const)(
    "refuses a type change when the account has %s",
    (_label, dependency) => {
      expect(canChangeAccountType({ ...FREE, ...dependency }).ok).toBe(false);
    },
  );

  it("allows a type change for an unused leaf", () => {
    expect(canChangeAccountType(FREE)).toEqual({ ok: true });
  });

  it("refuses children on an account with history or saved-default use", () => {
    expect(canAddAccountChild({ ...FREE, movementCount: 1 }).ok).toBe(false);
    expect(canAddAccountChild({ ...FREE, statementCount: 1 }).ok).toBe(false);
    expect(canAddAccountChild({ ...FREE, defaultCount: 1 }).ok).toBe(false);
  });

  it("protects saved defaults and active descendants from deactivation", () => {
    expect(canDeactivateAccount({ ...FREE, defaultCount: 1 }).ok).toBe(false);
    expect(canDeactivateAccount({ ...FREE, activeDescendantCount: 1 }).ok).toBe(
      false,
    );
    expect(canDeactivateAccount({ ...FREE, movementCount: 1 })).toEqual({
      ok: true,
    });
  });
});
