import { describe, expect, it } from "vitest";
import { checkProfile } from "$lib/import-profile-schema.js";
import {
  applySorting,
  columnRole,
  layoutFromSample,
  sectionForValue,
  setColumnRole,
  sortColumnFor,
  sortingOf,
} from "$lib/import-profile-sample.js";
import {
  blankForm,
  payloadFromForm,
  setKind,
} from "$lib/import-profile-form.js";
import { walletReportFixture } from "../extraction/spreadsheet/__fixtures__/build-xlsx.js";
import { WALLET_HEADERS } from "./__fixtures__/wallet-table.js";
import { inspectSample } from "./sample-inspect.js";

/**
 * A look at a sample spreadsheet for the profile editor (006 FR-053), and the
 * editor's helpers that turn it into a layout and row rules. Every workbook
 * is built in memory, with made-up values.
 */

function wallet() {
  const result = inspectSample(
    new Uint8Array(walletReportFixture().xlsx),
    "xlsx",
  );
  if (!result.ok) throw new Error(result.error);
  return result.sample;
}

const csv = (text: string) => new Uint8Array(Buffer.from(text, "utf8"));

describe("inspectSample", () => {
  it("finds the transaction table below the summary block, and guesses its columns", () => {
    const sample = wallet();
    expect(sample.sheet).toBe("Transaction Report");
    expect(sample.headers).toEqual(WALLET_HEADERS);
    expect(sample.rowCount).toBe(walletReportFixture().transactions);
    expect(sample.rows[0][2]).toBe("Income from Order #A1");
    expect(sample.guess).toMatchObject({
      date: "Date",
      description: "Description",
      amount: "Amount",
      reference: "Order ID",
      balance: "Balance After Transactions",
      direction: {
        column: "Money Direction",
        in: ["Money In"],
        out: ["Money Out"],
      },
      dateFormat: "YYYY-MM-DD",
      decimalSeparator: ".",
      sortBy: "Transaction Type",
    });
  });

  it("counts each value of a column, most rows first", () => {
    const type = wallet().columns.find((c) => c.heading === "Transaction Type");
    expect(type?.distinct).toEqual([
      { value: "Order Income", count: 4 },
      // A tie keeps the order the values first appear in.
      { value: "Withdrawal", count: 2 },
      { value: "Adjustment", count: 2 },
    ]);
    const description = wallet().columns.find(
      (c) => c.heading === "Description",
    );
    expect(description?.distinct?.length).toBeGreaterThan(0);
  });

  it("offers the labels outside the table that have a date or a figure beside them", () => {
    const labels = wallet().labels.map((l) => [l.label, l.value]);
    expect(labels).toContainEqual(["To", "2026-03-29"]);
    expect(labels).toContainEqual(["Total Money In", "54.15"]);
    expect(labels.map(([label]) => label)).not.toContain("Username (Seller)");
  });

  it("reads the row the user chose as the headings", () => {
    const result = inspectSample(
      new Uint8Array(walletReportFixture().xlsx),
      "xlsx",
      { headerRow: 11 },
    );
    expect(result.ok && result.sample.headers[0]).toBe("Summary");
    // A file of one sheet is read whatever the sheet is called (FR-069).
    const one = inspectSample(
      new Uint8Array(walletReportFixture().xlsx),
      "xlsx",
      { sheet: "Nope" },
    );
    expect(one.ok && one.sample.sheet).toBe("Transaction Report");
    const missing = inspectSample(
      new Uint8Array(
        walletReportFixture([{ name: "Summary", rows: [["Total"]] }]).xlsx,
      ),
      "xlsx",
      { sheet: "Nope" },
    );
    expect(missing).toEqual({
      ok: false,
      error:
        'There is no sheet "Nope". The sample\'s sheets are: "Summary", "Transaction Report".',
    });
  });

  it("guesses a CSV's day-first dates and decimal commas", () => {
    const result = inspectSample(
      csv(
        "Booking date;Details;Amount;Balance\n" +
          "29/03/2026;Card payment;-12,50;100,00\n" +
          "30/03/2026;Salary;1.000,00;1.100,00\n",
      ),
      "csv",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sample.guess).toMatchObject({
      date: "Booking date",
      description: "Details",
      amount: "Amount",
      balance: "Balance",
      dateFormat: "DD/MM/YYYY",
      decimalSeparator: ",",
    });
  });

  it("gives no list of values for a column with more than 30", () => {
    const rows = Array.from(
      { length: 40 },
      (_, i) =>
        `2026-03-${String((i % 28) + 1).padStart(2, "0")},Item ${i},${i}.00`,
    );
    const result = inspectSample(
      csv(`Date,Item,Amount\n${rows.join("\n")}\n`),
      "csv",
    );
    expect(
      result.ok && result.sample.columns.find((c) => c.heading === "Item"),
    ).toMatchObject({ distinct: null });
  });

  it("says when no table is found", () => {
    const result = inspectSample(csv("just,words\nmore,words\n"), "csv");
    expect(result.ok).toBe(false);
  });
});

describe("building a table profile from a sample", () => {
  it("makes a layout the shared check accepts, and sorts rows into sections by value", () => {
    const sample = wallet();
    const form = blankForm();
    form.name = "Wallet report";
    form.description = "A marketplace wallet report.";
    setKind(form, "table");
    form.layout = layoutFromSample(sample, form.layout);
    expect(columnRole(form.layout, "Amount")).toBe("amount");

    const column = sortColumnFor(sample, form.layout)!;
    expect(column).toBe("Transaction Type");
    const orders = form.sections[0];
    orders.name = "Orders";
    orders.kind = "by_sign";
    const fees = sectionForValue("Adjustment");
    fees.kind = "by_sign";
    form.sections.push(fees);
    applySorting(form, {
      column,
      assignments: new Map([
        ["Order Income", orders.uid],
        ["Adjustment", fees.uid],
      ]),
    });
    const sorting = sortingOf(form)!;
    expect(sorting.column).toBe("Transaction Type");
    expect([...sorting.assignments]).toEqual([
      ["Order Income", orders.uid],
      ["Adjustment", fees.uid],
    ]);

    const checked = checkProfile(payloadFromForm(form));
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.profile.layout).toMatchObject({
      headers: WALLET_HEADERS,
      columns: {
        date: "Date",
        description: "Description",
        amount: "Amount",
        reference: "Order ID",
      },
      direction: { column: "Money Direction" },
      balanceColumn: "Balance After Transactions",
    });
    expect(checked.profile.sections[0].rows?.where).toEqual([
      { column: "Transaction Type", op: "is", value: "Order Income" },
    ]);
  });

  it("moves a role from the column that held it", () => {
    const form = blankForm();
    setKind(form, "table");
    const layout = (form.layout = layoutFromSample(wallet(), form.layout));
    setColumnRole(layout, "Order ID", "description");
    expect(layout.description).toBe("Order ID");
    expect(layout.reference).toBe("");
    expect(columnRole(layout, "Description")).toBe("none");
    setColumnRole(layout, "Money Direction", "none");
    expect(layout.directionColumn).toBe("");
    expect(layout.directionInText).toBe("");
  });

  it("calls rules of any other shape custom", () => {
    const form = blankForm();
    setKind(form, "table");
    const rows = form.sections[0].rows!;
    rows.where = [
      { uid: "a", column: "Status", op: "is_not", value: "x", valuesText: "" },
    ];
    expect(sortingOf(form)).toBeNull();
  });
});
