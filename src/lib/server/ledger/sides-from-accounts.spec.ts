import { describe, expect, it } from "vitest";
import { AccountRole, LedgerRecordKind } from "$lib/enums.js";
import {
  sidesFromAccounts,
  type SidesInput,
  type SidesContext,
} from "./sides-from-accounts.js";

/**
 * Principle V: a wrong kind is silent. Nothing on screen says "this was filed
 * as a transfer" — it simply appears in the wrong place on a report months
 * later, which is why every row of the derivation table (data-model.md §5) is
 * pinned here, over plain role codes with no database.
 *
 * The module builds **no movements**. It answers "which of the seven shapes did
 * the user just describe?" and hands that to `entry-builder.ts`, which stays
 * the single enforcement point of the zero-sum rule (research.md R-02).
 */

const ACCOUNTS = {
  bank: { id: 1, role: AccountRole.Bank, archived: false },
  cash: { id: 2, role: AccountRole.Cash, archived: false },
  fuel: { id: 3, role: AccountRole.ExpenseCategory, archived: false },
  sales: { id: 4, role: AccountRole.IncomeCategory, archived: false },
  laptop: { id: 5, role: AccountRole.Equipment, archived: false },
  payable: { id: 6, role: AccountRole.Payable, archived: false },
  receivable: { id: 7, role: AccountRole.Receivable, archived: false },
  opening: { id: 8, role: AccountRole.OpeningBalances, archived: false },
  capital: { id: 9, role: AccountRole.PartnerCapital, archived: false },
  archived: { id: 10, role: AccountRole.ExpenseCategory, archived: true },
};

function ctx(overrides: Partial<SidesContext> = {}): SidesContext {
  return {
    accountById: (id: number) =>
      Object.values(ACCOUNTS).find((a) => a.id === id) ?? null,
    canAdjust: true,
    ...overrides,
  };
}

function input(
  fromAccountId: number,
  toAccountId: number,
  extra: Partial<SidesInput> = {},
): SidesInput {
  return {
    fromAccountId,
    toAccountId,
    amountMinor: 10_000,
    contactId: null,
    ...extra,
  };
}

describe("sidesFromAccounts — the derivation table", () => {
  it("money pot → expense category is an expense", () => {
    const result = sidesFromAccounts(
      input(ACCOUNTS.bank.id, ACCOUNTS.fuel.id),
      ctx(),
    );
    expect(result.ok).toBe(true);
    expect(result.ok && result.value).toEqual({
      kind: "expense",
      categoryAccountId: ACCOUNTS.fuel.id,
      paidFromAccountId: ACCOUNTS.bank.id,
    });
  });

  it("money pot → equipment is an expense", () => {
    const result = sidesFromAccounts(
      input(ACCOUNTS.cash.id, ACCOUNTS.laptop.id),
      ctx(),
    );
    expect(result.ok && result.value.kind).toBe("expense");
  });

  it("income category → money pot is income", () => {
    const result = sidesFromAccounts(
      input(ACCOUNTS.sales.id, ACCOUNTS.bank.id),
      ctx(),
    );
    expect(result.ok && result.value).toEqual({
      kind: "income",
      categoryAccountId: ACCOUNTS.sales.id,
      receivedIntoAccountId: ACCOUNTS.bank.id,
    });
  });

  it("money pot → money pot is a transfer", () => {
    const result = sidesFromAccounts(
      input(ACCOUNTS.bank.id, ACCOUNTS.cash.id),
      ctx(),
    );
    expect(result.ok && result.value).toEqual({
      kind: "transfer",
      fromAccountId: ACCOUNTS.bank.id,
      toAccountId: ACCOUNTS.cash.id,
    });
  });

  it("money pot → payable is a payment we make", () => {
    const result = sidesFromAccounts(
      input(ACCOUNTS.bank.id, ACCOUNTS.payable.id, { contactId: 42 }),
      ctx(),
    );
    expect(result.ok && result.value).toEqual({
      kind: "payment",
      paidFromAccountId: ACCOUNTS.bank.id,
      direction: "we-pay",
    });
  });

  it("receivable → money pot is a payment we receive", () => {
    const result = sidesFromAccounts(
      input(ACCOUNTS.receivable.id, ACCOUNTS.bank.id, { contactId: 42 }),
      ctx(),
    );
    expect(result.ok && result.value).toEqual({
      kind: "payment",
      paidFromAccountId: ACCOUNTS.bank.id,
      direction: "we-receive",
    });
  });

  it("payable → expense category is an expense somebody else paid", () => {
    const result = sidesFromAccounts(
      input(ACCOUNTS.payable.id, ACCOUNTS.fuel.id, { contactId: 42 }),
      ctx(),
    );
    expect(result.ok && result.value).toEqual({
      kind: "expense",
      categoryAccountId: ACCOUNTS.fuel.id,
      // Null is what makes it read as owed rather than paid (FR-008).
      paidFromAccountId: null,
    });
  });

  it("opening balances → anything is an opening balance", () => {
    const result = sidesFromAccounts(
      input(ACCOUNTS.opening.id, ACCOUNTS.bank.id),
      ctx(),
    );
    expect(result.ok && result.value).toEqual({
      kind: "opening-balance",
      accountId: ACCOUNTS.bank.id,
    });
  });

  it("any other pair is a journal entry, and its two sides cancel", () => {
    const result = sidesFromAccounts(
      input(ACCOUNTS.capital.id, ACCOUNTS.fuel.id),
      ctx(),
    );
    expect(result.ok && result.value).toEqual({
      kind: "journal",
      movements: [
        { accountId: ACCOUNTS.capital.id, amountMinor: -10_000 },
        { accountId: ACCOUNTS.fuel.id, amountMinor: 10_000 },
      ],
    });
  });

  it("extra sides make it a journal entry whatever the pair", () => {
    const result = sidesFromAccounts(
      input(ACCOUNTS.bank.id, ACCOUNTS.fuel.id, {
        extraSides: [{ accountId: ACCOUNTS.cash.id, amountMinor: -500 }],
      }),
      ctx(),
    );
    expect(result.ok && result.value.kind).toBe("journal");
    // The extra side comes through as typed; whether the whole set cancels is
    // entry-builder.ts's question, not this module's.
    expect(
      result.ok && result.value.kind === "journal" && result.value.movements,
    ).toEqual([
      { accountId: ACCOUNTS.bank.id, amountMinor: -10_000 },
      { accountId: ACCOUNTS.fuel.id, amountMinor: 10_000 },
      { accountId: ACCOUNTS.cash.id, amountMinor: -500 },
    ]);
  });

  it("builds no movements — it returns a RecordCreateSides only", () => {
    const result = sidesFromAccounts(
      input(ACCOUNTS.bank.id, ACCOUNTS.fuel.id),
      ctx(),
    );
    expect(result.ok).toBe(true);
    // An everyday kind states two accounts and lets the builder fill the pair.
    expect(result.ok && "movements" in result.value).toBe(false);
    expect(result.ok && "amountMinor" in result.value).toBe(false);
  });
});

describe("sidesFromAccounts — refusals", () => {
  it("refuses both sides naming the same account", () => {
    const result = sidesFromAccounts(
      input(ACCOUNTS.bank.id, ACCOUNTS.bank.id),
      ctx(),
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe(
      "Money cannot move from an account to itself. Choose two different accounts.",
    );
  });

  it("refuses a payable side with no contact, in the plain sentence", () => {
    const result = sidesFromAccounts(
      input(ACCOUNTS.bank.id, ACCOUNTS.payable.id),
      ctx(),
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe("Say who this is owed to or by.");
  });

  it("refuses a receivable side with no contact, in the same sentence", () => {
    const result = sidesFromAccounts(
      input(ACCOUNTS.receivable.id, ACCOUNTS.bank.id),
      ctx(),
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe("Say who this is owed to or by.");
  });

  it("refuses an archived account", () => {
    const result = sidesFromAccounts(
      input(ACCOUNTS.bank.id, ACCOUNTS.archived.id),
      ctx(),
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toContain("no longer in use");
  });

  it("refuses an account that does not exist", () => {
    const result = sidesFromAccounts(input(ACCOUNTS.bank.id, 999), ctx());
    expect(result.ok).toBe(false);
  });

  it("refuses a journal result without the adjustments ability", () => {
    const result = sidesFromAccounts(
      input(ACCOUNTS.capital.id, ACCOUNTS.fuel.id),
      ctx({ canAdjust: false }),
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe(
      "These two accounts need the Adjustments ability. Ask an administrator for it, or choose an everyday account on each side.",
    );
  });

  it("refuses extra sides without the adjustments ability", () => {
    const result = sidesFromAccounts(
      input(ACCOUNTS.bank.id, ACCOUNTS.fuel.id, {
        extraSides: [{ accountId: ACCOUNTS.cash.id, amountMinor: -500 }],
      }),
      ctx({ canAdjust: false }),
    );
    expect(result.ok).toBe(false);
  });

  it("allows an everyday pair without the adjustments ability", () => {
    const result = sidesFromAccounts(
      input(ACCOUNTS.bank.id, ACCOUNTS.fuel.id),
      ctx({ canAdjust: false }),
    );
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// An ordinary bill that spans several categories.
//
// One supplier invoice can cover fuel and paper. That is three sides — two
// categories and one payable — and it used to fall through to `journal`, which
// demanded the `adjustments` ability: the ability that exists because a record
// written that way can make the books say anything. An everyday purchase is not
// that, and should not need it.
//
// The *shape* stays `journal`, because `RecordCreateSides`' expense variant
// holds exactly one `categoryAccountId`. What changes is what it costs to write
// and what it is filed as.
// ---------------------------------------------------------------------------

describe("a bill spanning several categories", () => {
  const petronasBill = () =>
    input(ACCOUNTS.payable.id, ACCOUNTS.fuel.id, {
      contactId: 42,
      extraSides: [{ accountId: ACCOUNTS.laptop.id, amountMinor: 3_000 }],
    });

  it("is allowed without the adjustments ability", () => {
    const result = sidesFromAccounts(petronasBill(), ctx({ canAdjust: false }));
    expect(result.ok).toBe(true);
  });

  it("is filed as a purchase, not as an adjustment", () => {
    const result = sidesFromAccounts(petronasBill(), ctx({ canAdjust: false }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected the bill to be allowed");
    expect(result.value.kind).toBe("journal");
    expect(
      result.value.kind === "journal" ? result.value.storedKind : undefined,
    ).toBe(LedgerRecordKind.Expense);
  });

  it("files a multi-category sale as income", () => {
    const result = sidesFromAccounts(
      input(ACCOUNTS.sales.id, ACCOUNTS.bank.id, {
        extraSides: [{ accountId: ACCOUNTS.sales.id, amountMinor: -2_000 }],
      }),
      ctx({ canAdjust: false }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected the sale to be allowed");
    expect(
      result.value.kind === "journal" ? result.value.storedKind : undefined,
    ).toBe(LedgerRecordKind.Income);
  });

  it("still refuses a genuine adjustment without the ability", () => {
    // Partner capital against a category is not a purchase by any reading.
    const result = sidesFromAccounts(
      input(ACCOUNTS.capital.id, ACCOUNTS.fuel.id, {
        extraSides: [{ accountId: ACCOUNTS.cash.id, amountMinor: -500 }],
      }),
      ctx({ canAdjust: false }),
    );
    expect(result.ok).toBe(false);
  });

  it("still refuses when more than one side holds money", () => {
    // Two money pots and a category is not one bill — it is a rearrangement.
    const result = sidesFromAccounts(
      input(ACCOUNTS.bank.id, ACCOUNTS.fuel.id, {
        extraSides: [{ accountId: ACCOUNTS.cash.id, amountMinor: -500 }],
      }),
      ctx({ canAdjust: false }),
    );
    expect(result.ok).toBe(false);
  });

  it("carries no storedKind on a real adjustment", () => {
    const result = sidesFromAccounts(
      input(ACCOUNTS.capital.id, ACCOUNTS.fuel.id, {
        extraSides: [{ accountId: ACCOUNTS.cash.id, amountMinor: -500 }],
      }),
      ctx({ canAdjust: true }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected the adjustment to be allowed");
    expect(
      result.value.kind === "journal" ? result.value.storedKind : undefined,
    ).toBeUndefined();
  });

  it("still needs a contact when a side is owed", () => {
    const result = sidesFromAccounts(
      input(ACCOUNTS.payable.id, ACCOUNTS.fuel.id, {
        extraSides: [{ accountId: ACCOUNTS.laptop.id, amountMinor: 3_000 }],
      }),
      ctx({ canAdjust: false }),
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe("Say who this is owed to or by.");
  });
});
