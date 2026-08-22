import { describe, expect, it } from "vitest";
import { AccountRole, AccountType, type AccountTypeCode } from "$lib/enums.js";
import {
  fundsFlow,
  type FundsFlowReport,
  type FundsFlowRow,
} from "./funds-flow.js";
import { isMoneyPotAccount } from "../account-type.js";
import type { Minor } from "../types.js";

/**
 * These tests state whole records, not the rows the query would hand over, and
 * the fixture narrows them exactly the way `queries/dashboard.ts` does: keep the
 * records that touched a current asset, then keep the sides that are *not* on
 * one. A fixture that pre-selected the rows would prove the arithmetic and
 * nothing about the rule — and the rule is the part that can be wrong.
 */

const BANK = 1;
const CASH = 2;
const RECEIVABLE = 3;
const EQUIPMENT = 4;
const PAYABLE = 5;
const LOAN = 6;
const CAPITAL = 7;
const SOFTWARE = 8;
const SALES = 9;

type Side = {
  accountId: number;
  type: AccountTypeCode;
  role: number;
  amountMinor: Minor;
};

const side =
  (accountId: number, type: AccountTypeCode, role: number) =>
  (amountMinor: Minor): Side => ({ accountId, type, role, amountMinor });

// Every asset that is not equipment carries `AccountRole.Bank` — the
// compatibility role `seed-accounts.ts` stamps on all of them. The fixtures use
// it deliberately: a bank account, a receivable and petty cash really are
// indistinguishable by role in this chart, and the rule must not depend on it.
const bank = side(BANK, AccountType.Asset, AccountRole.Bank);
const cash = side(CASH, AccountType.Asset, AccountRole.Bank);
const receivable = side(RECEIVABLE, AccountType.Asset, AccountRole.Bank);
const equipment = side(EQUIPMENT, AccountType.Asset, AccountRole.Equipment);
const payable = side(PAYABLE, AccountType.Liability, AccountRole.Payable);
const loan = side(LOAN, AccountType.Liability, AccountRole.Payable);
const capital = side(CAPITAL, AccountType.Equity, AccountRole.PartnerCapital);
const expense = side(
  SOFTWARE,
  AccountType.Expense,
  AccountRole.ExpenseCategory,
);
const revenue = side(SALES, AccountType.Revenue, AccountRole.IncomeCategory);

/** Every record's sides sum to zero, or the fixture is not a record. */
function record(...sides: Side[]): Side[] {
  const sum = sides.reduce((running, s) => running + s.amountMinor, 0);
  if (sum !== 0)
    throw new Error(`fixture is not a balanced record: sides sum to ${sum}`);
  return sides;
}

const isCurrentAsset = (s: Side) => isMoneyPotAccount(s);

/** The movement in current assets these records caused. */
function movementIn(records: Side[][]): Minor {
  return records
    .flat()
    .filter(isCurrentAsset)
    .reduce((running, s) => running + s.amountMinor, 0);
}

/** What `queries/dashboard.ts` selects: the other sides of funds-touching records. */
function rowsFrom(records: Side[][]): FundsFlowRow[] {
  return records
    .filter((sides) => sides.some(isCurrentAsset))
    .flatMap((sides) => sides.filter((s) => !isCurrentAsset(s)));
}

const OPENING = 100_00;

/** Built the way the loader builds it, with the closing figure read separately. */
function reportFor(
  records: Side[][],
  payableAccountId: number | null = PAYABLE,
): FundsFlowReport {
  return fundsFlow({
    dateFrom: "2026-01-01",
    dateTo: "2026-01-31",
    openingMinor: OPENING,
    closingMinor: OPENING + movementIn(records),
    payableAccountId,
    rows: rowsFrom(records),
  });
}

function lineIn(report: FundsFlowReport, key: string): Minor | undefined {
  return report.activities
    .flatMap((activity) => activity.lines)
    .find((line) => line.key === key)?.amountMinor;
}

describe("fundsFlow", () => {
  it("reads an expense settled from the bank as an operating use of funds", () => {
    const report = reportFor([record(expense(400_00), bank(-400_00))]);

    expect(lineIn(report, "operating-expenses")).toBe(-400_00);
    expect(report.netMinor).toBe(-400_00);
    expect(report.ties).toBe(true);
  });

  it("reads revenue collected into the bank as an operating source", () => {
    const report = reportFor([record(bank(1_500_00), revenue(-1_500_00))]);

    expect(lineIn(report, "revenue")).toBe(1_500_00);
    expect(report.netMinor).toBe(1_500_00);
    expect(report.ties).toBe(true);
  });

  it("puts equipment under investing, not operating — the reason this exists", () => {
    const report = reportFor([record(equipment(23_083_89), bank(-23_083_89))]);

    expect(lineIn(report, "capital-expenditure")).toBe(-23_083_89);
    expect(lineIn(report, "operating-expenses")).toBeUndefined();
    expect(report.activities.map((a) => a.key)).toEqual(["investing"]);
    expect(report.ties).toBe(true);
  });

  it("shows nothing for a transfer between two current-asset accounts", () => {
    const report = reportFor([record(bank(-250_00), cash(250_00))]);

    expect(report.activities).toEqual([]);
    expect(report.netMinor).toBe(0);
    expect(report.closingMinor).toBe(OPENING);
    expect(report.ties).toBe(true);
  });

  it("shows nothing for a customer settling an invoice", () => {
    // Both sides are current assets: receivables became cash, funds unchanged.
    const report = reportFor([record(bank(600_00), receivable(-600_00))]);

    expect(report.activities).toEqual([]);
    expect(report.netMinor).toBe(0);
    expect(report.ties).toBe(true);
  });

  it("counts an invoice as revenue when it is issued, not again when it is paid", () => {
    const issued = record(receivable(600_00), revenue(-600_00));
    const settled = record(bank(600_00), receivable(-600_00));

    expect(lineIn(reportFor([issued]), "revenue")).toBe(600_00);
    expect(lineIn(reportFor([issued, settled]), "revenue")).toBe(600_00);
    expect(reportFor([issued, settled]).netMinor).toBe(600_00);
  });

  it("splits a part-paid expense into the cost and the credit that funded it", () => {
    // 100 of software, 60 paid from the bank, 40 left on account.
    const report = reportFor([
      record(expense(100_00), bank(-60_00), payable(-40_00)),
    ]);

    expect(lineIn(report, "operating-expenses")).toBe(-100_00);
    expect(lineIn(report, "trade-payables")).toBe(40_00);
    // The two net to the 60 that actually left the bank.
    expect(report.netMinor).toBe(-60_00);
    expect(report.ties).toBe(true);
  });

  it("ignores a bill taken on credit until it is settled", () => {
    const billed = record(expense(40_00), payable(-40_00));
    // No current-asset side, so the funds did not move and nothing is reported.
    expect(reportFor([billed]).activities).toEqual([]);

    const paid = record(payable(40_00), bank(-40_00));
    const report = reportFor([billed, paid]);

    // Settling it is what touches the funds, so it reads as trade payables
    // rather than as the cost. This is the asymmetry the module documents:
    // receivables are inside the funds base and payables are not, so revenue
    // lands when it is invoiced but a cost lands when it is paid.
    expect(lineIn(report, "trade-payables")).toBe(-40_00);
    expect(lineIn(report, "operating-expenses")).toBeUndefined();
    expect(report.netMinor).toBe(-40_00);
    expect(report.ties).toBe(true);
  });

  it("reads other borrowing as financing", () => {
    const report = reportFor([record(bank(5_000_00), loan(-5_000_00))]);

    const financing = report.activities.find((a) => a.key === "financing");
    expect(financing?.lines.map((l) => l.key)).toEqual(["borrowings"]);
    expect(lineIn(report, "borrowings")).toBe(5_000_00);
  });

  it("puts every liability under financing when no payable default is set", () => {
    const report = reportFor([record(bank(40_00), payable(-40_00))], null);

    expect(lineIn(report, "borrowings")).toBe(40_00);
    expect(lineIn(report, "trade-payables")).toBeUndefined();
    expect(report.ties).toBe(true);
  });

  it("drops a line that nets to nothing over the period", () => {
    const report = reportFor([
      record(expense(80_00), bank(-80_00)),
      record(expense(-80_00), bank(80_00)),
    ]);

    expect(report.activities).toEqual([]);
    expect(report.netMinor).toBe(0);
  });

  it("explains a whole month's records, to the cent", () => {
    // A partner puts 2,000 in, 1,500 is invoiced and 600 of it collected, a
    // laptop is bought outright, software is part-paid, and a loan is drawn.
    const records = [
      record(bank(2_000_00), capital(-2_000_00)),
      record(receivable(1_500_00), revenue(-1_500_00)),
      record(bank(600_00), receivable(-600_00)),
      record(equipment(3_400_00), bank(-3_400_00)),
      record(expense(100_00), bank(-60_00), payable(-40_00)),
      record(cash(5_000_00), loan(-5_000_00)),
    ];
    const report = reportFor(records);

    expect(lineIn(report, "revenue")).toBe(1_500_00);
    expect(lineIn(report, "operating-expenses")).toBe(-100_00);
    expect(lineIn(report, "trade-payables")).toBe(40_00);
    expect(lineIn(report, "capital-expenditure")).toBe(-3_400_00);
    expect(lineIn(report, "borrowings")).toBe(5_000_00);
    expect(lineIn(report, "owners-equity")).toBe(2_000_00);
    expect(report.activities.map((a) => a.key)).toEqual([
      "operating",
      "investing",
      "financing",
    ]);

    // The whole point: the lines are the movement, with nothing left over.
    expect(report.netMinor).toBe(movementIn(records));
    expect(report.openingMinor + report.netMinor).toBe(report.closingMinor);
    expect(report.ties).toBe(true);
    expect(report.notes).toEqual([]);
  });

  it("says so when the lines do not explain the movement", () => {
    const report = fundsFlow({
      dateFrom: "2026-01-01",
      dateTo: "2026-01-31",
      openingMinor: 0,
      // A closing figure the rows cannot account for. Only a broken database
      // gets here, and it must not read as a complete statement.
      closingMinor: 999_00,
      payableAccountId: PAYABLE,
      rows: rowsFrom([record(expense(400_00), bank(-400_00))]),
    });

    expect(report.ties).toBe(false);
    expect(report.differenceMinor).toBe(999_00 + 400_00);
    expect(report.notes[0]).toContain("do not add up");
  });

  it("carries the history-gap note when the period reaches back past the upgrade", () => {
    const report = fundsFlow({
      dateFrom: "2026-01-01",
      dateTo: "2026-01-31",
      openingMinor: 0,
      closingMinor: 0,
      payableAccountId: PAYABLE,
      rows: [],
      trackingStartedOn: "2026-08-21",
    });

    expect(report.notes).toHaveLength(1);
    expect(report.notes[0]).toContain("2026-08-21");
  });
});
