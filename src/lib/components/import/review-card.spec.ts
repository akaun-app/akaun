import { describe, expect, it } from "vitest";
import { AccountType, DocumentType } from "$lib/enums.js";
import {
  describeReading,
  hasProfileChoice,
  readAsOfJob,
  readCategoryAccountId,
  readingLabel,
  receiptSides,
  reviewRowFrom,
  type ReviewOptions,
} from "./review-card.js";

// The review card hides a review note once the reviewer has picked another
// category. It tells that by comparing the category side of the card with
// what the card started with, so the two must agree for both kinds.
const options = {
  allAccounts: [],
  categoryAccounts: [
    { id: 10, name: "Fees", type: AccountType.Expense },
    { id: 20, name: "Sales", type: AccountType.Revenue },
  ],
  payableAccountId: 1,
  receivableAccountId: 2,
  uncategorisedAccountId: 3,
  uncategorisedIncomeAccountId: 4,
} as unknown as ReviewOptions;

describe("readCategoryAccountId", () => {
  it("is the category an expense card starts with on its target side", () => {
    const row = reviewRowFrom({ documentType: DocumentType.Expense });
    expect(readCategoryAccountId(row, options)).toBe(3);
    expect(receiptSides(row, options).target).toBe(3);

    const read = reviewRowFrom({
      documentType: DocumentType.Expense,
      categoryAccountId: 10,
    });
    expect(readCategoryAccountId(read, options)).toBe(10);
  });

  it("is the category an income card starts with on its source side", () => {
    const row = reviewRowFrom({ documentType: DocumentType.Income });
    expect(readCategoryAccountId(row, options)).toBe(4);
    expect(receiptSides(row, options).source).toBe(4);

    const read = reviewRowFrom({
      documentType: DocumentType.Income,
      category: "Sales",
    });
    expect(readCategoryAccountId(read, options)).toBe(20);
  });
});

describe("describeReading", () => {
  it("says which profile read a document and whether it was chosen or detected", () => {
    const profile = { name: "Shopee statement" };
    expect(
      describeReading({ readAs: "profile", readHow: "chosen", profile }),
    ).toBe("Read with “Shopee statement” (chosen)");
    // Auto-detect keeps "auto" as what the uploader chose (006 US9, FR-041).
    expect(
      describeReading({ readAs: "auto", readHow: "detected", profile }),
    ).toBe("Read with “Shopee statement” (detected)");
    expect(describeReading({ readAs: "auto", readHow: "standard" })).toBe(
      "Standard reading (auto-detect)",
    );
  });

  it("says the standard reading and several items, and how each was picked", () => {
    expect(describeReading({ readAs: "receipt", readHow: "chosen" })).toBe(
      "Standard reading (chosen)",
    );
    expect(describeReading({ readAs: "items", readHow: "chosen" })).toBe(
      "Read as several items (chosen)",
    );
    // A row from before 006 has neither column, and was read as a receipt.
    expect(describeReading({ readAs: null, readHow: null })).toBe(
      "Standard reading",
    );
    // A profile reading whose copy is missing still says it was a profile.
    expect(describeReading({ readAs: "profile", readHow: "chosen" })).toBe(
      "Read with an import profile (chosen)",
    );
  });
});

describe("readingLabel", () => {
  const detected = {
    readAs: "auto",
    readHow: "detected",
    profile: { name: "Fee notice" },
  };
  const autoStandard = { readAs: "auto", readHow: "standard" };

  it("says nothing of the standard reading while no profile is turned on (FR-003)", () => {
    expect(readingLabel(autoStandard, { profilesEnabled: false })).toBeNull();
    expect(
      readingLabel(autoStandard, { profilesEnabled: false, waiting: true }),
    ).toBeNull();
    expect(
      readingLabel(
        { readAs: "receipt", readHow: "chosen" },
        { profilesEnabled: false },
      ),
    ).toBeNull();
  });

  it("always names a profile or several-items reading (FR-041)", () => {
    expect(readingLabel(detected, { profilesEnabled: false })).toBe(
      "Read with “Fee notice” (detected)",
    );
    expect(
      readingLabel(
        { readAs: "items", readHow: "chosen" },
        { profilesEnabled: false, waiting: true },
      ),
    ).toBe("Read as several items (chosen)");
  });

  it("names the standard reading once profiles exist, and Auto-detect while it waits", () => {
    expect(readingLabel(autoStandard, { profilesEnabled: true })).toBe(
      "Standard reading (auto-detect)",
    );
    expect(
      readingLabel(autoStandard, { profilesEnabled: true, waiting: true }),
    ).toBe("Auto-detect");
    expect(
      readingLabel(detected, { profilesEnabled: true, waiting: true }),
    ).toBe("Read with “Fee notice” (detected)");
    expect(
      readingLabel(
        { readAs: "receipt", readHow: "chosen" },
        { profilesEnabled: true, waiting: true },
      ),
    ).toBe("Standard reading (chosen)");
  });
});

describe("readAsOfJob", () => {
  it("names the reading the way an upload and Read again take it", () => {
    expect(readAsOfJob({ readAs: "profile", profileId: "7" })).toBe(
      "profile:7",
    );
    expect(readAsOfJob({ readAs: "auto", profileId: "7" })).toBe("auto");
    expect(readAsOfJob({ readAs: "items", profileId: null })).toBe("items");
    expect(readAsOfJob({ readAs: null, profileId: null })).toBe("receipt");
  });
});

describe("hasProfileChoice", () => {
  it("is true only when a saved profile is among the choices", () => {
    expect(hasProfileChoice([{ value: "auto" }, { value: "receipt" }])).toBe(
      false,
    );
    expect(hasProfileChoice([{ value: "auto" }, { value: "profile:3" }])).toBe(
      true,
    );
  });
});
