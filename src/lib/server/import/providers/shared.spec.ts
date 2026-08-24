import { describe, expect, it } from "vitest";
import { LLMResultSchema, buildSystemPrompt } from "./shared.js";

const accounts = [
  { id: 11, code: 5100, path: "Expenses › Advertising" },
  { id: 12, code: 1300, path: "Assets › Inventory" },
];

describe("auto-import LLM account selection", () => {
  it("sends stable account ids with readable account context", () => {
    const prompt = buildSystemPrompt({
      expenseAccounts: accounts,
      incomeAccounts: [{ id: 21, code: 4000, path: "Revenue › Product Sales" }],
      mainCurrency: "MYR",
      today: "2026-08-24",
      text: "ignored",
    });

    expect(prompt).toContain('"id":11');
    expect(prompt).toContain("Expenses › Advertising");
    expect(prompt).toContain("category_account_id");
    expect(prompt).not.toContain("payment_status");
  });

  it("accepts a selected account id or no match", () => {
    const base = {
      document_type: "expense" as const,
      item_name: "Printer paper",
      supplier: "Paper Shop",
      date: "2026-08-24",
      amount: 42,
      currency: "MYR",
      reference: "INV-1",
    };
    expect(
      LLMResultSchema.parse({ ...base, category_account_id: 11 })
        .category_account_id,
    ).toBe(11);
    expect(
      LLMResultSchema.parse({ ...base, category_account_id: null })
        .category_account_id,
    ).toBeNull();
  });
});
