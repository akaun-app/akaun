import { describe, expect, it } from "vitest";
import {
  canChangeAccountSubType,
  canChangeAccountType,
  canDeactivateAccount,
  canDeleteAccount,
  isPostingEligible,
  postingEligibility,
  type AccountDependencyState,
} from "./account-eligibility.js";

const FREE: AccountDependencyState = {
  movementCount: 0,
  statementCount: 0,
  defaultCount: 0,
  otherDependencyCount: 0,
};

describe("account posting eligibility", () => {
  it("allows only active accounts", () => {
    expect(isPostingEligible({ active: true })).toBe(true);
    expect(isPostingEligible({ active: false })).toBe(false);
  });

  it("gives a plain reason when an account cannot receive movements", () => {
    expect(postingEligibility({ active: false })).toEqual({
      ok: false,
      reason: "This account is inactive.",
    });
    expect(postingEligibility({ active: true })).toEqual({ ok: true });
  });
});

describe("protected account lifecycle", () => {
  it.each([
    ["movements", { movementCount: 1 }],
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
    ["statement history", { statementCount: 1 }],
    ["a saved default", { defaultCount: 1 }],
  ] as const)(
    "refuses a type change when the account has %s",
    (_label, dependency) => {
      expect(canChangeAccountType({ ...FREE, ...dependency }).ok).toBe(false);
    },
  );

  it("allows a type change for an unused account", () => {
    expect(canChangeAccountType(FREE)).toEqual({ ok: true });
  });

  it("protects saved defaults from deactivation", () => {
    expect(canDeactivateAccount({ ...FREE, defaultCount: 1 }).ok).toBe(false);
    expect(canDeactivateAccount({ ...FREE, movementCount: 1 })).toEqual({
      ok: true,
    });
  });
});

/**
 * `canChangeAccountSubType` is deliberately looser than `canChangeAccountType`
 * (005 research.md §3): a "needs review" account must stay correctable however
 * much history it has picked up, so the only thing that can refuse it is the
 * same edit-lock state that already blocks editing the account at all.
 */
describe("canChangeAccountSubType", () => {
  const EDITABLE = { canChange: true, isSystem: false, archived: false };

  it("allows the change on an editable account with no history", () => {
    expect(canChangeAccountSubType(EDITABLE)).toEqual({ ok: true });
  });

  it("is not blocked by movement, statement or default count", () => {
    // The same dependency state that refuses `canChangeAccountType` on every
    // count, proving the sub-type rule really ignores all three.
    const heavilyUsed: AccountDependencyState = {
      movementCount: 500,
      statementCount: 12,
      defaultCount: 1,
      otherDependencyCount: 0,
    };
    expect(canChangeAccountType(heavilyUsed).ok).toBe(false);
    expect(canChangeAccountSubType(EDITABLE)).toEqual({ ok: true });
  });

  it("refuses when the caller lacks permission to change the account", () => {
    const result = canChangeAccountSubType({ ...EDITABLE, canChange: false });
    expect(result.ok).toBe(false);
  });

  it("refuses on a system account", () => {
    const result = canChangeAccountSubType({ ...EDITABLE, isSystem: true });
    expect(result.ok).toBe(false);
  });

  it("refuses on an archived account", () => {
    const result = canChangeAccountSubType({ ...EDITABLE, archived: true });
    expect(result.ok).toBe(false);
  });
});
