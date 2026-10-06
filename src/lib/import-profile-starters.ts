/**
 * The built-in starters a new import profile can begin from (006 FR-030,
 * US6 AS2). A starter is only data: the editor copies one into a new profile
 * for the user to change, and nothing reads a starter directly, so editing a
 * starter here never changes a saved profile.
 *
 * No starter pins a category or an account. The categories and accounts are
 * the user's own, which a starter cannot know; the user picks them in the
 * editor. The two wallet report starters cannot be saved until both of their
 * accounts are chosen (FR-030, FR-058): the wallet the report lists, and the
 * bank account each withdrawal goes to.
 *
 * The two wallet report starters are alternatives for the same report: the
 * same table, the same headings and the same words, so no recognition phrase
 * can tell one from the other. They suggest no phrases, and each says to turn
 * on only one of the two. With both on, Auto-detect cannot choose without an
 * AI provider and says so, naming them.
 */

import type {
  ImportProfileDraft,
  ProfileSection,
  TableLayout,
} from "./import-profile-schema.js";

export type ImportProfileStarterId =
  | "fee_document"
  | "marketplace_summary"
  | "wallet_withdrawals"
  | "wallet_every_transaction";

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
  kind: "summary",
  mode: "summary",
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
  kind: "summary",
  mode: "summary",
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

/**
 * The table of a marketplace wallet report, read from its columns (FR-053):
 * the layout of Shopee's "balance transaction report" export, one row per
 * transaction under a heading row, which sits some way down the sheet below
 * a block of account details and the two totals. The table is found by its
 * headings, wherever they are, never by a fixed row.
 *
 * The amounts are printed with their sign, and "Money Direction" says the
 * same again; the direction gives the sign, so an amount printed without one
 * is still read the right way. Each row's balance after it is checked from
 * row to row, as a note (a row missing from the export breaks it).
 *
 * No other party and no currency: a wallet report names neither on its rows.
 * The amounts are taken to be in the main currency; set the currency if the
 * wallet is in another one.
 */
function walletReportLayout(over: Partial<TableLayout> = {}): TableLayout {
  return {
    sheet: null,
    headers: [
      "Date",
      "Transaction Type",
      "Description",
      "Order ID",
      "Money Direction",
      "Amount",
      "Status",
      "Balance After Transactions",
    ],
    columns: {
      date: "Date",
      description: "Description",
      amount: "Amount",
      reference: "Order ID",
    },
    dateFormat: "YYYY-MM-DD",
    direction: {
      column: "Money Direction",
      in: ["Money In"],
      out: ["Money Out"],
    },
    decimalSeparator: ".",
    csvDelimiter: null,
    counterparty: null,
    currency: null,
    // The end of the period the report covers.
    documentDateLabel: "To",
    remarkColumns: [],
    statedTotalLabels: {},
    balanceColumn: "Balance After Transactions",
    ...over,
  };
}

/**
 * Each withdrawal from the wallet to the bank, as a transfer (FR-058). One
 * still being paid out is imported, flagged for the reviewer, rather than
 * left out (FR-061): it is real money leaving the wallet, and leaving it out
 * would make the books disagree with the report.
 */
const WITHDRAWALS: ProfileSection = {
  key: "withdrawals",
  name: "Withdrawals",
  description:
    "Each withdrawal of money from the wallet to the seller's bank account.",
  kind: "transfer",
  fixedCategoryAccountId: null,
  feeTypes: [],
  extras: null,
  counterAccountId: null,
  rows: {
    where: [
      {
        column: "Transaction Type",
        op: "is_one_of",
        values: ["Withdrawals", "Withdrawal"],
      },
    ],
    flagWhen: [
      { column: "Status", op: "is_not", value: "Transaction Completed" },
    ],
    flagNote:
      "Check that this withdrawal completed: the report still showed it as not completed.",
    feeTypeColumn: null,
  },
};

const WALLET_DESCRIPTION =
  "A marketplace wallet's balance transaction report, as a spreadsheet: the seller's account details and the total money in and out for a period, then one row per transaction (order income, adjustments and withdrawals to the bank) with the balance after each.";

/** What each wallet report starter says about the other. */
const ONLY_ONE =
  "Made for the same report as the other wallet report profile: turn on only one of the two.";

const WALLET_INSTRUCTIONS = `- Read only the table of transactions, one item per row. Never list the totals above it or a balance.
- Copy every amount exactly as printed, with its sign. Never add up or work out a figure yourself.`;

/**
 * A wallet report, for its withdrawals only: the recommended use beside the
 * same marketplace's income statement summary, which already holds the sales
 * and fees. Every other row is left out and counted (FR-056).
 */
const WALLET_WITHDRAWALS: ImportProfileDraft = {
  name: "Marketplace wallet report — withdrawals only",
  kind: "table",
  mode: "every_transaction",
  description: `${WALLET_DESCRIPTION} ${ONLY_ONE}`,
  phrases: [],
  instructions: WALLET_INSTRUCTIONS,
  statedTotalLabels: {},
  layout: walletReportLayout(),
  sections: [structuredClone(WITHDRAWALS)],
};

/**
 * A wallet report, every row: order income and adjustments by their sign, and
 * withdrawals as transfers. Its order income repeats the sales an income
 * statement summary already holds, so a section can name that profile
 * ("Same money as") to have each such line noted (FR-066).
 */
const WALLET_EVERY_TRANSACTION: ImportProfileDraft = {
  name: "Marketplace wallet report — every transaction",
  kind: "table",
  mode: "every_transaction",
  description: `${WALLET_DESCRIPTION} Its order income repeats the sales of the marketplace's income statement: import both and the sales are counted twice. ${ONLY_ONE}`,
  phrases: [],
  instructions: WALLET_INSTRUCTIONS,
  statedTotalLabels: {},
  layout: walletReportLayout({
    remarkColumns: ["Transaction Type"],
    statedTotalLabels: {
      every_transaction: ["Total Money In", "Total Money Out"],
    },
  }),
  sections: [
    {
      key: "order_income",
      name: "Order income",
      description:
        "Each order paid into the wallet, and each amount taken back for an order.",
      kind: "by_sign",
      fixedCategoryAccountId: null,
      feeTypes: [],
      extras: null,
      rows: {
        where: [
          { column: "Transaction Type", op: "is", value: "Order Income" },
        ],
        flagWhen: [],
        flagNote: "",
        feeTypeColumn: null,
      },
    },
    {
      key: "adjustments",
      name: "Adjustments",
      description:
        "Each adjustment the marketplace made to the wallet, such as a compensation or a fee corrected.",
      kind: "by_sign",
      fixedCategoryAccountId: null,
      feeTypes: [],
      extras: null,
      rows: {
        where: [{ column: "Transaction Type", op: "is", value: "Adjustment" }],
        flagWhen: [],
        flagNote: "",
        feeTypeColumn: null,
      },
    },
    structuredClone(WITHDRAWALS),
  ],
};

export const IMPORT_PROFILE_STARTERS: readonly ImportProfileStarter[] = [
  {
    id: "fee_document",
    label: "Fee document",
    hint: "A notice with a list of fees. Each fee is an expense.",
    draft: FEE_DOCUMENT,
  },
  {
    id: "marketplace_summary",
    label: "Marketplace statement summary",
    hint: "The summary of a marketplace statement. Sales are income. Fees and rebates use their sign.",
    draft: MARKETPLACE_SUMMARY,
  },
  {
    id: "wallet_withdrawals",
    label: "Marketplace wallet report — withdrawals only",
    hint: "A wallet report spreadsheet. Each withdrawal to the bank is a transfer. Use it with the statement summary. Turn on only one of the two wallet report profiles.",
    draft: WALLET_WITHDRAWALS,
  },
  {
    id: "wallet_every_transaction",
    label: "Marketplace wallet report — every transaction",
    hint: "All rows of a wallet report spreadsheet. The statement summary also has the order income. Import only one of the two, or the app counts the sales two times. Turn on only one of the two wallet report profiles.",
    draft: WALLET_EVERY_TRANSACTION,
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

/** Whether a value names one of the starters, such as `?starter=` on the editor. */
export function isStarterId(id: string): id is ImportProfileStarterId {
  return IMPORT_PROFILE_STARTERS.some((entry) => entry.id === id);
}
