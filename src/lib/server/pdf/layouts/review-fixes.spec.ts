import { describe, it, expect } from "vitest";
import { getDocumentProxy, extractTextItems } from "unpdf";
import type { LayoutRenderData } from "$lib/pdf/render-types.js";
import { renderClassic } from "./classic.js";
import { renderCompact } from "./compact.js";

const base: LayoutRenderData = {
  document: {
    invoiceNumber: "INV-1",
    issueDate: "2026-01-01",
    currency: "MYR",
    lines: [{ description: "Item", quantity: 1, unitPrice: 20, lineTotal: 20 }],
    subtotal: 20,
    taxAmount: 0,
    total: 20,
  },
  settings: { companyName: "Company" },
  docTypeLabel: "INVOICE",
};
const theme = { color: "#1a56db" };
async function pages(buffer: Buffer) {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { items } = await extractTextItems(pdf);
  await pdf.destroy();
  return items.map((page) => page.filter((item) => item.str.trim()));
}
describe("PDF review regressions", () => {
  it("uses the latest payment accounting date rather than allocation timestamps", async () => {
    const data = {
      ...base,
      document: {
        ...base.document,
        paid: true,
        settlements: [
          {
            amountMinor: 1000,
            createdAt: "2026-09-01",
            otherDate: "2026-02-15",
          },
          {
            amountMinor: 1000,
            createdAt: "2026-10-01",
            otherDate: "2026-01-15",
          },
        ],
      },
    };
    const text = (await pages(await renderClassic(data, theme, "Invoice")))[0]
      .map((i) => i.str)
      .join(" ");
    expect(text).toContain("paid on 15 February 2026");
  });
  it("advances compact rows past every wrapped description line", async () => {
    const data = {
      ...base,
      document: {
        ...base.document,
        lines: [
          {
            ...base.document.lines[0],
            description: "Wrapped description ".repeat(15) + "ENDROW",
          },
          { ...base.document.lines[0], description: "NEXTROW" },
        ],
      },
    };
    const items = (await pages(await renderCompact(data, theme, "Invoice")))[0];
    const last = items.find((i) => i.str.includes("ENDROW"))!;
    const next = items.find((i) => i.str.includes("NEXTROW"))!;
    expect(last.y - next.y).toBeGreaterThanOrEqual(last.height);
  });
  it("paginates items with repeated headers, reserves the footer, and retains long notes and terms", async () => {
    const data = {
      ...base,
      document: {
        ...base.document,
        lines: Array.from({ length: 100 }, (_, i) => ({
          ...base.document.lines[0],
          description: `ITEM-${i}`,
        })),
        notes: "Notes text ".repeat(1000) + "ENDNOTES",
        terms: "Terms text ".repeat(1000) + "ENDTERMS",
      },
    };
    const result = await pages(await renderClassic(data, theme, "Invoice"));
    expect(result.length).toBeGreaterThan(3);
    for (const [index, page] of result.entries()) {
      expect(
        page.some((i) => i.str === `Page ${index + 1} of ${result.length}`),
      ).toBe(true);
      const body = page.filter((i) => !i.str.startsWith("Page "));
      expect(body.every((i) => i.y > 70)).toBe(true);
      if (body.some((i) => /^ITEM-/.test(i.str)))
        expect(body.some((i) => i.str === "Description")).toBe(true);
    }
    const text = result
      .flat()
      .map((i) => i.str)
      .join(" ");
    expect(text).toContain("ITEM-99");
    expect(text).toContain("ENDNOTES");
    expect(text).toContain("ENDTERMS");
  });
  it("splits a description taller than a page without losing its tail", async () => {
    const data = {
      ...base,
      document: {
        ...base.document,
        lines: [
          {
            ...base.document.lines[0],
            description: "Long description ".repeat(1200) + "ENDITEM",
          },
        ],
      },
    };
    const result = await pages(await renderClassic(data, theme, "Invoice"));
    expect(result.length).toBeGreaterThan(1);
    expect(result.flat().some((i) => i.str.includes("ENDITEM"))).toBe(true);
    for (const page of result.filter((p) =>
      p.some((i) => i.str.includes("Long description")),
    )) {
      expect(page.some((i) => i.str === "Description")).toBe(true);
      expect(
        page.filter((i) => !i.str.startsWith("Page ")).every((i) => i.y > 70),
      ).toBe(true);
    }
  });
});
