import { describe, expect, it } from "vitest";
import { AccountRole, type AccountRoleCode } from "$lib/enums.js";
import { profitLoss } from "./profit-loss.js";
import type { AccountTotal, Minor } from "../types.js";

/**
 * One account's total, the way `queries/reports.ts` hands it over. Raw signs:
 * positive when value went into that account, negative when it left.
 */
function total(
  accountId: number,
  accountName: string,
  role: AccountRoleCode,
  amountMinor: Minor,
): AccountTotal {
  return { accountId, accountName, role, contactId: null, amountMinor };
}

/**
 * A dated side of a record, only for the tests that turn on *when* something
 * happened. The report module never sees dates on a movement — the query has
 * already narrowed to the range — so this fixture stands in for that query.
 */
type DatedMovement = {
  date: string;
  accountId: number;
  accountName: string;
  role: AccountRoleCode;
  amountMinor: Minor;
};

function totalsBetween(
  movements: DatedMovement[],
  dateFrom: string,
  dateTo: string,
): AccountTotal[] {
  const byAccount = new Map<number, AccountTotal>();
  for (const m of movements) {
    if (m.date < dateFrom || m.date > dateTo) continue;
    const existing = byAccount.get(m.accountId);
    if (existing) existing.amountMinor += m.amountMinor;
    else
      byAccount.set(
        m.accountId,
        total(m.accountId, m.accountName, m.role, m.amountMinor),
      );
  }
  return [...byAccount.values()];
}

const CONSULTING = 10;
const SALES = 11;
const SOFTWARE = 20;
const TRAVEL = 21;
const BANK = 30;
const WALLET = 31;
const RECEIVABLE = 40;

describe("lines grouped by category account", () => {
  const report = profitLoss({
    dateFrom: "2026-01-01",
    dateTo: "2026-01-31",
    totals: [
      total(CONSULTING, "Consulting", AccountRole.IncomeCategory, -150_000),
      total(SALES, "Sales", AccountRole.IncomeCategory, -25_000),
      total(SOFTWARE, "Software", AccountRole.ExpenseCategory, 4_500),
      total(TRAVEL, "Travel", AccountRole.ExpenseCategory, 12_000),
    ],
  });

  it("gives one line per category account, naming it", () => {
    expect(report.income.map((l) => l.accountName)).toEqual([
      "Consulting",
      "Sales",
    ]);
    expect(report.expenses.map((l) => l.accountName)).toEqual([
      "Software",
      "Travel",
    ]);
  });

  it("keeps the account id on every line, so a line can be opened", () => {
    expect(report.income.map((l) => l.accountId)).toEqual([CONSULTING, SALES]);
  });

  it("shows money coming in the way a reader expects it, not as a negative", () => {
    // Income sits at a negative balance under the one sign convention; the
    // report is the place that flips it.
    expect(report.income[0].amountMinor).toBe(150_000);
    expect(report.totalIncomeMinor).toBe(175_000);
  });

  it("shows money going out as a positive figure too", () => {
    expect(report.totalExpensesMinor).toBe(16_500);
  });

  it("takes what went out off what came in", () => {
    expect(report.resultMinor).toBe(158_500);
  });

  it("echoes the period it covers", () => {
    expect(report.dateFrom).toBe("2026-01-01");
    expect(report.dateTo).toBe("2026-01-31");
  });
});

describe("accounts with nothing in them", () => {
  it("leaves a category that moved nothing off the report", () => {
    const report = profitLoss({
      dateFrom: "2026-01-01",
      dateTo: "2026-01-31",
      totals: [
        total(CONSULTING, "Consulting", AccountRole.IncomeCategory, -150_000),
        total(SALES, "Sales", AccountRole.IncomeCategory, 0),
        total(SOFTWARE, "Software", AccountRole.ExpenseCategory, 0),
      ],
    });
    expect(report.income.map((l) => l.accountName)).toEqual(["Consulting"]);
    expect(report.expenses).toEqual([]);
  });

  it("reports a period with nothing in it as a flat zero", () => {
    const report = profitLoss({
      dateFrom: "2026-01-01",
      dateTo: "2026-01-31",
      totals: [],
    });
    expect(report.income).toEqual([]);
    expect(report.expenses).toEqual([]);
    expect(report.totalIncomeMinor).toBe(0);
    expect(report.totalExpensesMinor).toBe(0);
    expect(report.resultMinor).toBe(0);
  });
});

describe("a transfer between two of the business's own accounts", () => {
  it("appears nowhere at all", () => {
    // Moving 500.00 from the bank to the wallet touches no category, so there
    // is nothing for the profit and loss to say about it (FR-007).
    const report = profitLoss({
      dateFrom: "2026-01-01",
      dateTo: "2026-01-31",
      totals: [
        total(BANK, "Bank", AccountRole.Bank, -50_000),
        total(WALLET, "Wallet", AccountRole.Wallet, 50_000),
      ],
    });
    expect(report.income).toEqual([]);
    expect(report.expenses).toEqual([]);
    expect(report.resultMinor).toBe(0);
  });

  it("does not change the result of a period that also had real income", () => {
    const withoutTransfer = profitLoss({
      dateFrom: "2026-01-01",
      dateTo: "2026-01-31",
      totals: [
        total(CONSULTING, "Consulting", AccountRole.IncomeCategory, -150_000),
      ],
    });
    const withTransfer = profitLoss({
      dateFrom: "2026-01-01",
      dateTo: "2026-01-31",
      totals: [
        total(CONSULTING, "Consulting", AccountRole.IncomeCategory, -150_000),
        total(BANK, "Bank", AccountRole.Bank, -50_000),
        total(WALLET, "Wallet", AccountRole.Wallet, 50_000),
      ],
    });
    expect(withTransfer.resultMinor).toBe(withoutTransfer.resultMinor);
    expect(withTransfer.expenses).toEqual([]);
  });
});

describe("money earned in one month and taken out in the next", () => {
  // Invoiced and earned on 20 January; the customer's money is moved out of the
  // business on 3 February. The income belongs to January (US2 AC3).
  const movements: DatedMovement[] = [
    {
      date: "2026-01-20",
      accountId: CONSULTING,
      accountName: "Consulting",
      role: AccountRole.IncomeCategory,
      amountMinor: -100_000,
    },
    {
      date: "2026-01-20",
      accountId: RECEIVABLE,
      accountName: "Money owed to us",
      role: AccountRole.Receivable,
      amountMinor: 100_000,
    },
    {
      date: "2026-02-03",
      accountId: RECEIVABLE,
      accountName: "Money owed to us",
      role: AccountRole.Receivable,
      amountMinor: -100_000,
    },
    {
      date: "2026-02-03",
      accountId: BANK,
      accountName: "Bank",
      role: AccountRole.Bank,
      amountMinor: 100_000,
    },
  ];

  it("counts the income in the month it was earned", () => {
    const january = profitLoss({
      dateFrom: "2026-01-01",
      dateTo: "2026-01-31",
      totals: totalsBetween(movements, "2026-01-01", "2026-01-31"),
    });
    expect(january.totalIncomeMinor).toBe(100_000);
    expect(january.resultMinor).toBe(100_000);
  });

  it("counts it again nowhere in the month it was taken out", () => {
    const february = profitLoss({
      dateFrom: "2026-02-01",
      dateTo: "2026-02-28",
      totals: totalsBetween(movements, "2026-02-01", "2026-02-28"),
    });
    expect(february.income).toEqual([]);
    expect(february.totalIncomeMinor).toBe(0);
    expect(february.resultMinor).toBe(0);
  });
});

describe("a period reaching back before the app kept these books", () => {
  it("says so in plain words rather than implying complete history", () => {
    const report = profitLoss({
      dateFrom: "2025-06-01",
      dateTo: "2026-01-31",
      totals: [],
      trackingStartedOn: "2026-01-01",
    });
    expect(report.notes).toHaveLength(1);
    expect(report.notes[0]).toMatch(/2026-01-01/);
    expect(report.notes[0]).toMatch(/invoice/i);
  });

  it("says nothing when the whole period is inside what the app tracked", () => {
    const report = profitLoss({
      dateFrom: "2026-01-01",
      dateTo: "2026-01-31",
      totals: [],
      trackingStartedOn: "2026-01-01",
    });
    expect(report.notes).toEqual([]);
  });

  it("says nothing when there is no upgrade date to compare against", () => {
    const report = profitLoss({
      dateFrom: "2020-01-01",
      dateTo: "2026-01-31",
      totals: [],
      trackingStartedOn: null,
    });
    expect(report.notes).toEqual([]);
  });
});
