import { describe, expect, it } from "vitest";
import { AccountRole, type AccountRoleCode } from "$lib/enums.js";
import { partnerStatement } from "./partner-statement.js";
import type { AccountTotal, Minor } from "../types.js";

function total(
  accountId: number,
  accountName: string,
  role: AccountRoleCode,
  contactId: number | null,
  amountMinor: Minor,
): AccountTotal {
  return { accountId, accountName, role, contactId, amountMinor };
}

const ALEX = 1;
const SAM = 2;
const ROBIN = 3;

const PARTNERS = [
  { contactId: ALEX, contactName: "Alex Tan" },
  { contactId: SAM, contactName: "Sam Lee" },
];

/** Alex put 5,000 in and took 1,200 back out; Sam put 3,000 in and took nothing. */
const TOTALS: AccountTotal[] = [
  total(
    100,
    "Alex Tan — money put in",
    AccountRole.PartnerCapital,
    ALEX,
    -500_000,
  ),
  total(
    101,
    "Alex Tan — money taken out",
    AccountRole.PartnerDrawings,
    ALEX,
    120_000,
  ),
  total(
    200,
    "Sam Lee — money put in",
    AccountRole.PartnerCapital,
    SAM,
    -300_000,
  ),
  total(201, "Sam Lee — money taken out", AccountRole.PartnerDrawings, SAM, 0),
];

describe("one block per contact holding the Partner role", () => {
  const report = partnerStatement({
    dateFrom: "2026-01-01",
    dateTo: "2026-12-31",
    partners: PARTNERS,
    totals: TOTALS,
    resultMinor: 90_001,
  });

  it("gives a block for each partner, in the order they were listed", () => {
    expect(report.partners.map((p) => p.contactId)).toEqual([ALEX, SAM]);
    expect(report.partners.map((p) => p.contactName)).toEqual([
      "Alex Tan",
      "Sam Lee",
    ]);
  });

  it("shows money put in as a positive figure", () => {
    // Capital sits at a negative balance under the one sign convention.
    expect(report.partners[0].contributionsMinor).toBe(500_000);
    expect(report.partners[1].contributionsMinor).toBe(300_000);
  });

  it("shows money taken out as a positive figure too", () => {
    expect(report.partners[0].drawingsMinor).toBe(120_000);
    expect(report.partners[1].drawingsMinor).toBe(0);
  });

  it("splits the result between them without losing or inventing a cent", () => {
    expect(report.partners[0].shareOfResultMinor).toBe(45_001);
    expect(report.partners[1].shareOfResultMinor).toBe(45_000);
    expect(
      report.partners.reduce((sum, p) => sum + p.shareOfResultMinor, 0),
    ).toBe(90_001);
  });

  it("leaves each partner what they put in, plus their share, less what they took out", () => {
    expect(report.partners[0].netMinor).toBe(500_000 + 45_001 - 120_000);
    expect(report.partners[1].netMinor).toBe(300_000 + 45_000 - 0);
  });

  it("echoes the period it covers", () => {
    expect(report.dateFrom).toBe("2026-01-01");
    expect(report.dateTo).toBe("2026-12-31");
  });

  it("says in plain words how the result was split", () => {
    expect(report.notes.some((n) => /equal/i.test(n))).toBe(true);
  });
});

describe("a partner who has not moved any money yet", () => {
  it("still gets a block, at zero", () => {
    const report = partnerStatement({
      dateFrom: "2026-01-01",
      dateTo: "2026-12-31",
      partners: [...PARTNERS, { contactId: ROBIN, contactName: "Robin Ng" }],
      totals: TOTALS,
      resultMinor: 0,
    });
    const robin = report.partners.find((p) => p.contactId === ROBIN);
    expect(robin).toEqual({
      contactId: ROBIN,
      contactName: "Robin Ng",
      contributionsMinor: 0,
      shareOfResultMinor: 0,
      drawingsMinor: 0,
      netMinor: 0,
    });
  });

  it("is counted when the result is shared out", () => {
    const report = partnerStatement({
      dateFrom: "2026-01-01",
      dateTo: "2026-12-31",
      partners: [...PARTNERS, { contactId: ROBIN, contactName: "Robin Ng" }],
      totals: TOTALS,
      resultMinor: 90_000,
    });
    expect(report.partners.map((p) => p.shareOfResultMinor)).toEqual([
      30_000, 30_000, 30_000,
    ]);
  });
});

describe("a period the business lost money in", () => {
  it("shares the loss out too, and takes it off what each partner is left with", () => {
    const report = partnerStatement({
      dateFrom: "2026-01-01",
      dateTo: "2026-12-31",
      partners: PARTNERS,
      totals: TOTALS,
      resultMinor: -90_001,
    });
    expect(report.partners[0].shareOfResultMinor).toBe(-45_001);
    expect(report.partners[1].shareOfResultMinor).toBe(-45_000);
    expect(report.partners[1].netMinor).toBe(300_000 - 45_000);
  });
});

describe("accounts that are not a partner's", () => {
  it("leaves out anything that belongs to nobody or to somebody else", () => {
    const report = partnerStatement({
      dateFrom: "2026-01-01",
      dateTo: "2026-12-31",
      partners: [{ contactId: ALEX, contactName: "Alex Tan" }],
      totals: [
        ...TOTALS,
        total(300, "Bank", AccountRole.Bank, null, 900_000),
        total(
          301,
          "Opening balances",
          AccountRole.OpeningBalances,
          null,
          -900_000,
        ),
      ],
      resultMinor: 0,
    });
    expect(report.partners).toHaveLength(1);
    expect(report.partners[0].contributionsMinor).toBe(500_000);
    expect(report.partners[0].drawingsMinor).toBe(120_000);
  });
});

describe("no partners at all", () => {
  it("produces an empty statement rather than failing", () => {
    const report = partnerStatement({
      dateFrom: "2026-01-01",
      dateTo: "2026-12-31",
      partners: [],
      totals: [],
      resultMinor: 50_000,
    });
    expect(report.partners).toEqual([]);
  });
});
