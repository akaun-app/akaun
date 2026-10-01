import { describe, expect, it } from "vitest";
import { AccountType, DocumentType } from "$lib/enums.js";
import {
  readCategoryAccountId,
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
