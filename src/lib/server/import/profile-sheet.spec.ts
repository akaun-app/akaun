import { describe, expect, it } from "vitest";
import { buildXlsx } from "../extraction/spreadsheet/__fixtures__/build-xlsx.js";
import { readCsv } from "../extraction/spreadsheet/csv.js";
import { renderWorkbook } from "../extraction/spreadsheet/render.js";
import { readXlsx } from "../extraction/spreadsheet/xlsx.js";
import {
  hasProfileTable,
  headingLines,
  missingSheet,
  profileSheet,
  sheetsHead,
} from "./profile-sheet.js";

/** Old (hidden), Summary, Orders. */
function report() {
  return readXlsx(
    buildXlsx({
      sheets: [
        { name: "Old", state: "hidden", rows: [["Date", "Amount"]] },
        { name: "Summary", rows: [["Total payout", { raw: "10.00" }]] },
        {
          name: "Orders",
          rows: [
            ["Order ID", "Date", "Amount"],
            ["A1", "2026-08-01", { raw: "10.00" }],
          ],
        },
      ],
    }),
  );
}

const named = (sheet: string | null) => ({ name: "Shopee", sheet });

describe("profileSheet (FR-069)", () => {
  it("keeps the sheet the profile names, matched as headings are folded", () => {
    const picked = profileSheet(report(), named("  ORDERS "), null);
    expect(picked).toMatchObject({ name: "Orders", of: 3 });
    if ("refused" in picked) throw new Error(picked.refused);
    expect(picked.workbook.sheets.map((sheet) => sheet.name)).toEqual([
      "Orders",
    ]);
  });

  it("refuses a workbook without the named sheet, naming the ones it has", () => {
    expect(profileSheet(report(), named("Payouts"), null)).toEqual({
      refused:
        'The import profile "Shopee" reads the sheet "Payouts", and this workbook has no sheet of that name. Its sheets are: "Old" (hidden), "Summary", "Orders".',
    });
    expect(missingSheet(report(), named("Payouts"))).not.toBeNull();
    expect(missingSheet(report(), named("summary"))).toBeNull();
    expect(missingSheet(report(), named(null))).toBeNull();
  });

  it("finds a table profile's sheet by its headings when it names none", () => {
    const picked = profileSheet(report(), named(null), ["date", "amount"]);
    // Visible sheets first: the hidden "Old" has the headings too.
    expect(picked).toMatchObject({ name: "Orders" });
  });

  it("keeps the whole workbook when no sheet has the table, for the reader to say so", () => {
    const workbook = report();
    const picked = profileSheet(workbook, named(null), ["Fee"]);
    expect(picked).toMatchObject({ workbook, of: 3 });
  });

  it("reads the first visible sheet for a profile the AI reads", () => {
    expect(profileSheet(report(), named(null), null)).toMatchObject({
      name: "Summary",
    });
  });

  it("passes over a blank sheet, or one with nothing in its cells", () => {
    const workbook = readXlsx(
      buildXlsx({
        sheets: [
          { name: "Cover", rows: [[""], ["  "]] },
          { name: "Fees", rows: [["Fee", { raw: "1.00" }]] },
        ],
      }),
    );
    expect(profileSheet(workbook, named(null), null)).toMatchObject({
      name: "Fees",
    });
  });

  it("reads a file of one sheet whatever its sheet is called, a CSV file too", () => {
    const workbook = readXlsx(
      buildXlsx({ sheets: [{ name: "Only", rows: [["a"]] }] }),
    );
    for (const sheet of [null, "Orders"]) {
      const picked = profileSheet(workbook, named(sheet), null);
      expect(picked).toMatchObject({ workbook, name: "Only", of: 1 });
      expect(missingSheet(workbook, named(sheet))).toBeNull();
    }
    const csv = readCsv(Buffer.from("Date,Amount\n2026-08-01,1.00\n"));
    expect(profileSheet(csv, named("Orders"), ["Date"])).toMatchObject({
      workbook: csv,
      of: 1,
    });
    expect(hasProfileTable(csv, named("Orders"), ["Date", "Amount"])).toBe(
      true,
    );
  });
});

describe("hasProfileTable", () => {
  it("looks for the table on the profile's own sheet only", () => {
    const workbook = report();
    expect(hasProfileTable(workbook, named(null), ["Date", "Amount"])).toBe(
      true,
    );
    expect(
      hasProfileTable(workbook, named("summary"), ["Date", "Amount"]),
    ).toBe(false);
    expect(hasProfileTable(workbook, named("Gone"), ["Date"])).toBe(false);
  });
});

describe("sheetsHead", () => {
  it("shows the start of every visible sheet within the budget", () => {
    const long = Array.from({ length: 200 }, (_, i) => [`Summary line ${i}`]);
    const workbook = readXlsx(
      buildXlsx({
        sheets: [
          { name: "Summary", rows: long },
          { name: "Hidden", state: "hidden", rows: [["HIDDEN"]] },
          { name: "Orders", rows: [["ORDER-1"]] },
        ],
      }),
    );
    const head = sheetsHead(workbook, 600);
    expect(head.length).toBeLessThanOrEqual(600);
    expect(head).toContain("Sheet: Summary");
    expect(head).toContain("Sheet: Orders\nORDER-1");
    expect(head).not.toContain("HIDDEN");
    // The short sheet's unused share goes to the long one.
    expect(head.indexOf("Sheet: Orders")).toBeGreaterThan(500);
    // A hidden sheet a profile names is shown too.
    expect(sheetsHead(workbook, 600, ["hidden"])).toContain(
      "Sheet: Hidden (hidden)\nHIDDEN",
    );
  });
});

describe("headingLines", () => {
  it("gives a sheet's own line and its column-heading row", () => {
    const workbook = readXlsx(
      buildXlsx({
        sheets: [
          {
            name: "Orders",
            rows: [
              ["Seller report"],
              ["Date", "Description", "Amount"],
              ["2026-08-01", "Order A1", { raw: "10.00" }],
              ["2026-08-02", "Order A2", { raw: "12.00" }],
            ],
          },
        ],
      }),
    );
    const lines = headingLines(workbook);
    const { pages } = renderWorkbook(workbook);
    const text = pages[0].split("\n");
    expect(lines.map((line) => text[line - 1])).toEqual([
      "Sheet: Orders",
      "Date | Description | Amount",
    ]);
  });

  it("takes the heading row the table reader found over the guess", () => {
    const workbook = readXlsx(
      buildXlsx({
        sheets: [
          {
            name: "Report",
            rows: [
              ["Label", "Value", "Note"],
              ["From", "2026-08-01", "x"],
              null,
              ["Date", "Amount", "Fee"],
              ["2026-08-01", { raw: "1.00" }, { raw: "0.10" }],
            ],
          },
        ],
      }),
    );
    // Row 4 is the table's; the blank row 3 has no line, so it is line 4.
    expect(headingLines(workbook, 4)).toEqual([1, 4]);
  });

  it("gives none for a workbook of several sheets", () => {
    expect(headingLines(report())).toEqual([]);
  });
});
