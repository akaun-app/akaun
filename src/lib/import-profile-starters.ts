/**
 * The built-in starters a new import profile can begin from (006 FR-030,
 * US6 AS2). A starter is only data: the editor copies one into a new profile
 * for the user to change, and nothing reads a starter directly, so editing a
 * starter here never changes a saved profile.
 *
 * No starter pins a category. The categories are the user's own accounts,
 * which a starter cannot know; the user picks them in the editor.
 */

import type { ImportProfileDraft } from "./import-profile-schema.js";

export type ImportProfileStarterId = "fee_document" | "marketplace_summary";

export interface ImportProfileStarter {
  id: ImportProfileStarterId;
  /** What the editor's "Start from" list shows. */
  label: string;
  /** One sentence on what the starter is for. */
  hint: string;
  draft: ImportProfileDraft;
}

/**
 * A notice that lists one or more fees, such as an ads or a platform fee
 * invoice. Every listed fee is an expense.
 */
const FEE_DOCUMENT: ImportProfileDraft = {
  name: "Fee document",
  description:
    "An invoice or notice from a platform or service provider that lists one or more fees charged to the business, such as advertising, commission or service fees.",
  phrases: [],
  instructions: `- Each fee line becomes its own record. Read only lines that charge one fee.
- When a fee line prints its amount both before and after tax, use the amount after tax.
- Never list a subtotal, a tax summary, a total, an amount due or a payment received.
- Copy every amount exactly as printed. Never add up or work out a figure yourself.`,
  statedTotalLabels: {
    summary:
      "The total of all the fees listed, including tax, as printed. Never an amount due that includes an earlier balance.",
  },
  sections: [
    {
      key: "fees",
      name: "Fees",
      description:
        "Each line that charges one fee, usually in the table of charges.",
      mode: "summary",
      kind: "expense",
      fixedCategoryAccountId: null,
      feeTypes: [
        {
          key: "advertising_fee",
          description: "Advertising or promoted listing charges",
          categoryAccountId: null,
        },
        {
          key: "commission_fee",
          description: "Commission charged on sales",
          categoryAccountId: null,
        },
        {
          key: "service_fee",
          description: "Service, platform or programme fees",
          categoryAccountId: null,
        },
        {
          key: "transaction_fee",
          description: "Payment processing or transaction fees",
          categoryAccountId: null,
        },
        {
          key: "subscription_fee",
          description: "A monthly or yearly subscription",
          categoryAccountId: null,
        },
      ],
      extras: null,
    },
  ],
};

/**
 * A marketplace's monthly income statement, read for its summary only: the
 * sales as income, and each kind of fee, rebate or adjustment by its sign
 * (006 US7). Shaped on a real Shopee statement, whose summary has 15 leaf
 * lines grouped under printed subtotals; the subtotals are left out, because
 * they add up the leaf lines and would count them twice.
 */
const MARKETPLACE_SUMMARY: ImportProfileDraft = {
  name: "Marketplace statement summary",
  description:
    "A marketplace's income statement for a period, with a summary of sales, fees, rebates and the net payout released to the seller, followed by a table of orders or daily payouts.",
  phrases: [],
  instructions: `- Read only the summary of the statement. Never read the table of orders, transactions or daily payouts.
- Read only the lines that state one amount for one thing. The summary groups them under subtotals such as total income, total fees or total expenses: never list a subtotal, a group total or the net payout itself.
- Keep the minus sign of every amount the statement prints as a deduction.
- Copy every amount exactly as printed. Never add up or work out a figure yourself.`,
  statedTotalLabels: {
    summary:
      "The net amount the marketplace released to the seller for the period, such as Total Payout Released, as printed.",
  },
  sections: [
    {
      key: "sales",
      name: "Sales",
      description:
        "The value of the goods sold in the period, at the top of the summary.",
      mode: "summary",
      kind: "income",
      fixedCategoryAccountId: null,
      feeTypes: [
        {
          key: "product_price",
          description:
            "The price of the products sold (product price or merchandise subtotal)",
          categoryAccountId: null,
        },
      ],
      extras: null,
    },
    {
      key: "fees",
      name: "Fees and adjustments",
      description:
        "Every other leaf line of the summary: refunds, discounts, shipping, vouchers, rebates and fees. A deduction is printed with a minus sign; a rebate or anything paid to the seller is printed without one.",
      mode: "summary",
      kind: "by_sign",
      fixedCategoryAccountId: null,
      feeTypes: [
        {
          key: "refund_amount",
          description:
            "Money refunded to buyers for returned or cancelled orders",
          categoryAccountId: null,
        },
        {
          key: "seller_product_discount",
          description: "Product discounts the seller gave",
          categoryAccountId: null,
        },
        {
          key: "platform_product_rebate",
          description: "Product discount rebates the marketplace paid back",
          categoryAccountId: null,
        },
        {
          key: "buyer_shipping_fee",
          description: "Shipping fees the buyers paid",
          categoryAccountId: null,
        },
        {
          key: "logistics_shipping_fee",
          description: "Shipping fees the logistics provider charged",
          categoryAccountId: null,
        },
        {
          key: "shipping_rebate",
          description: "Shipping fee rebates from the marketplace",
          categoryAccountId: null,
        },
        {
          key: "seller_shipping_promotion",
          description: "Shipping fee promotions the seller paid for",
          categoryAccountId: null,
        },
        {
          key: "return_shipping_fee",
          description: "Shipping fees for returned orders",
          categoryAccountId: null,
        },
        {
          key: "seller_voucher",
          description: "Vouchers the seller sponsored",
          categoryAccountId: null,
        },
        {
          key: "seller_coins_cashback",
          description: "Coins cashback the seller sponsored",
          categoryAccountId: null,
        },
        {
          key: "commission_fee",
          description: "The marketplace's commission fee",
          categoryAccountId: null,
        },
        {
          key: "service_fee",
          description: "Service or programme fees",
          categoryAccountId: null,
        },
        {
          key: "transaction_fee",
          description: "Payment transaction fees",
          categoryAccountId: null,
        },
        {
          key: "affiliate_commission",
          description: "Commission paid to affiliates",
          categoryAccountId: null,
        },
      ],
      extras: null,
    },
  ],
};

export const IMPORT_PROFILE_STARTERS: readonly ImportProfileStarter[] = [
  {
    id: "fee_document",
    label: "Fee document",
    hint: "A notice that lists fees, each one an expense.",
    draft: FEE_DOCUMENT,
  },
  {
    id: "marketplace_summary",
    label: "Marketplace statement summary",
    hint: "The summary of a marketplace statement: sales as income, and each fee or rebate by its sign.",
    draft: MARKETPLACE_SUMMARY,
  },
];

/**
 * A fresh copy of a starter's profile, for the editor to change. Null for an
 * id that is not a starter.
 */
export function starterDraft(id: string): ImportProfileDraft | null {
  const starter = IMPORT_PROFILE_STARTERS.find((entry) => entry.id === id);
  return starter ? structuredClone(starter.draft) : null;
}
