import type { Allowed } from "./types.js";

export type PostingEligibilityState = {
  active: boolean;
};

/** Counts supplied by account queries before a lifecycle mutation is attempted. */
export type AccountDependencyState = {
  movementCount: number;
  statementCount: number;
  defaultCount: number;
  otherDependencyCount: number;
};

const allowed: Allowed = { ok: true };

function refused(reason: string): Allowed {
  return { ok: false, reason };
}

export function isPostingEligible(state: PostingEligibilityState): boolean {
  return state.active;
}

export function postingEligibility(state: PostingEligibilityState): Allowed {
  if (!state.active) return refused("This account is inactive.");
  return allowed;
}

/**
 * The account's own edit-lock state — the conditions that already block
 * editing it at all, independent of any particular field.
 */
export type AccountEditLockState = {
  canChange: boolean;
  isSystem: boolean;
  archived: boolean;
};

/**
 * Whether an existing Asset account's sub-type may be changed.
 *
 * Deliberately not `canChangeAccountType`: the sub-type describes what the
 * account *is*, not a fact fixed at creation, so it is not blocked by
 * movement, child, statement or default count the way changing `type` is
 * (005 research.md §3) — only by the same edit-lock state that already blocks
 * editing this account at all.
 */
export function canChangeAccountSubType(state: AccountEditLockState): Allowed {
  if (!state.canChange) {
    return refused("You do not have permission to change this account.");
  }
  if (state.isSystem) {
    return refused(
      "This is one of the accounts the app needs to work, so its sub-type cannot be changed.",
    );
  }
  if (state.archived) {
    return refused(
      "This account is archived, so its sub-type cannot be changed.",
    );
  }
  return allowed;
}

/**
 * Whether an existing account's code may be changed.
 *
 * Same edit-lock shape as `canChangeAccountSubType` — a code has no
 * movement/child/statement/default dependency of its own to check, but a
 * system account's code is load-bearing: `seedAccounts()` re-runs on every
 * server start and looks accounts up by their seeded code, so renumbering one
 * away would make the next restart insert a duplicate.
 */
export function canChangeAccountCode(state: AccountEditLockState): Allowed {
  if (!state.canChange) {
    return refused("You do not have permission to change this account.");
  }
  if (state.isSystem) {
    return refused(
      "This is one of the accounts the app needs to work, so its code cannot be changed.",
    );
  }
  if (state.archived) {
    return refused("This account is archived, so its code cannot be changed.");
  }
  return allowed;
}

export function canChangeAccountType(state: AccountDependencyState): Allowed {
  if (state.movementCount > 0) {
    return refused(
      "This account has movements, so its type cannot be changed.",
    );
  }
  if (state.statementCount > 0) {
    return refused(
      "This account has statement history, so its type cannot be changed.",
    );
  }
  if (state.defaultCount > 0) {
    return refused(
      "Choose a replacement saved default before changing this account's type.",
    );
  }
  return allowed;
}

export function canDeactivateAccount(state: AccountDependencyState): Allowed {
  if (state.defaultCount > 0) {
    return refused(
      "Choose a replacement saved default before deactivating this account.",
    );
  }
  return allowed;
}

export function canDeleteAccount(state: AccountDependencyState): Allowed {
  if (state.movementCount > 0) {
    return refused(
      "This account has movements and must be deactivated instead.",
    );
  }
  if (state.statementCount > 0) {
    return refused(
      "This account has statement history and must be deactivated instead.",
    );
  }
  if (state.defaultCount > 0) {
    return refused(
      "Choose a replacement saved default before deleting this account.",
    );
  }
  if (state.otherDependencyCount > 0) {
    return refused(
      "Another record depends on this account, so it cannot be deleted.",
    );
  }
  return allowed;
}
