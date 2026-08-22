import {
  AccountCodeRanges,
  AccountTypeLabels,
  type AccountTypeCode,
} from "$lib/enums.js";

export type AccountCodeRange = Readonly<{ start: number; end: number }>;

export class AccountCodeRangeExhaustedError extends Error {
  constructor(type: AccountTypeCode, range: AccountCodeRange) {
    const label = AccountTypeLabels[type];
    const name = label[0].toUpperCase() + label.slice(1);
    super(
      `No free ${name} account codes remain in range ${range.start}-${range.end}.`,
    );
    this.name = "AccountCodeRangeExhaustedError";
  }
}

export function accountCodeRangeFor(type: AccountTypeCode): AccountCodeRange {
  return AccountCodeRanges[type];
}

/**
 * Finds the lowest available code for a type. Callers must read used codes and
 * reserve the returned value inside the same write transaction; the database
 * unique constraint remains the final concurrency guard.
 */
export function lowestFreeAccountCode(
  type: AccountTypeCode,
  usedCodes: Iterable<number>,
): number {
  const range = accountCodeRangeFor(type);
  const used = new Set<number>();
  for (const code of usedCodes) {
    if (Number.isInteger(code) && code >= range.start && code <= range.end) {
      used.add(code);
    }
  }

  for (let code = range.start; code <= range.end; code += 1) {
    if (!used.has(code)) return code;
  }

  throw new AccountCodeRangeExhaustedError(type, range);
}
