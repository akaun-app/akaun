import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { eq } from "drizzle-orm";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { mockModel, type Reply } from "../llm/__fixtures__/mock-model.js";
import {
  buildXlsx,
  walletReportFixture,
} from "../extraction/spreadsheet/__fixtures__/build-xlsx.js";

/**
 * Reading a queued document (`processImportJob`), for a receipt and for a
 * document with several items (006 S1).
 *
 * The database is a file under `os.tmpdir()`, migrated from `drizzle/`; the
 * job is given its own storage folder there too. No AI provider is called:
 * each provider gets a mock model that plays back fixed answers. Exchange
 * rates come from a stub, so the tests can count how often one is asked for.
 * Every job carries its text with it (`pre_extracted_text`), so no file is
 * read.
 */

const sandbox = mkdtempSync(join(tmpdir(), "akaun-process-job-spec-"));

const mocks = vi.hoisted(() => ({
  models: new Map<string, unknown>(),
  rate: vi.fn<
    (
      db: unknown,
      query: { from: string; to: string; date: string },
    ) => Promise<{ rate: number | null; source: "api" }>
  >(async () => ({ rate: 4.5, source: "api" })),
}));

vi.mock("$lib/server/env.js", () => ({
  get STORAGE_PATH() {
    return join(sandbox, "default-root");
  },
  DATABASE_PATH: "/dev/null",
  OCR_CACHE_PATH: "/dev/null",
}));

vi.mock("$lib/server/llm/model-factory.js", () => ({
  createModel: vi.fn((config: { name: string }) => {
    const model = mocks.models.get(config.name);
    if (!model) throw new Error(`No mock model for ${config.name}`);
    return model;
  }),
}));

vi.mock("$lib/server/llm/rate-limiter.js", () => ({
  throttleLLMCall: vi.fn(async () => {}),
}));

vi.mock("$lib/server/logger.js", () => {
  const silent = {
    trace: () => {},
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  };
  return { createLogger: () => silent };
});

vi.mock("$lib/server/currency/rates.js", () => ({
  getExchangeRate: mocks.rate,
}));

const {
  AccountSubType,
  AccountType,
  DefaultAccountPurpose,
  DocumentType,
  EntityType,
  ImportState,
  LedgerRecordKind,
  Role,
} = await import("$lib/enums.js");
const { ImportReadAs, ImportReadHow, parseExtractionNotes } =
  await import("$lib/import-reading.js");
const schema = await import("../db/schema.js");
const {
  accountDefaults,
  contactRoles,
  contacts,
  importItems,
  importQueue,
  ledgerMovements,
  ledgerRecords,
  users,
} = schema;
const { createAccount } = await import("../services/accounts.js");
const { insertProvider } = await import("../llmProviders.js");
const { setSetting, SETTING_KEYS } = await import("../settings.js");
const { importEvents } = await import("./events.js");
const { EMPTY_SPREADSHEET, NO_ITEMS_FOUND, processImportJob } =
  await import("./process-job.js");
type LedgerDb = import("../ledger/types.js").LedgerDb;

let dir: string;
let sqlite: Database;
let db: LedgerDb;
let ids: {
  payable: number;
  receivable: number;
  uncategorised: number;
  uncategorisedIncome: number;
  fees: number;
  sales: number;
  supplier: number;
};

type Emitted = { event: string; payload: Record<string, unknown> };
let emitted: Emitted[];
const stopListening: (() => void)[] = [];

function listen(event: string) {
  const handler = (payload: Record<string, unknown>) =>
    emitted.push({ event, payload });
  importEvents.on(event, handler);
  stopListening.push(() => importEvents.off(event, handler));
}

function account(name: string, type: number, subType?: number): number {
  const created = createAccount(db, 1, {
    name,
    type: type as never,
    ...(subType === undefined ? {} : { subType: subType as never }),
  });
  if (!created.ok) throw new Error(created.reason);
  return created.value.id;
}

beforeEach(() => {
  dir = mkdtempSync(join(sandbox, "db-"));
  sqlite = new Database(join(dir, "test.db"));
  sqlite.exec("PRAGMA foreign_keys = ON;");
  db = drizzle(sqlite, { schema }) as unknown as LedgerDb;
  migrate(db as never, { migrationsFolder: "drizzle" });
  db.insert(users)
    .values({ id: 1, email: "u@test", username: "u", passwordHash: "x" })
    .run();
  setSetting(db, SETTING_KEYS.currencyCode, "MYR");

  ids = {
    payable: account(
      "Accounts Payable",
      AccountType.Liability,
      AccountSubType.AccountsPayable,
    ),
    receivable: account(
      "Accounts Receivable",
      AccountType.Asset,
      AccountSubType.Receivable,
    ),
    uncategorised: account("Uncategorised Expense", AccountType.Expense),
    uncategorisedIncome: account("Uncategorised Income", AccountType.Revenue),
    fees: account("Marketplace Fees", AccountType.Expense),
    sales: account("Sales", AccountType.Revenue),
    supplier: 0,
  };
  db.insert(accountDefaults)
    .values([
      { purpose: DefaultAccountPurpose.Payable, accountId: ids.payable },
      { purpose: DefaultAccountPurpose.Receivable, accountId: ids.receivable },
      {
        purpose: DefaultAccountPurpose.UncategorisedExpense,
        accountId: ids.uncategorised,
      },
      {
        purpose: DefaultAccountPurpose.UncategorisedIncome,
        accountId: ids.uncategorisedIncome,
      },
    ])
    .run();

  const [contact] = db
    .insert(contacts)
    .values({ legalName: "Shopee Malaysia", entityType: EntityType.Business })
    .returning({ id: contacts.id })
    .all();
  ids.supplier = contact.id;
  db.insert(contactRoles)
    .values({ contactId: contact.id, role: Role.Supplier })
    .run();

  insertProvider(db, {
    type: "groq",
    name: "main",
    apiKey: "test-key",
    model: "main-model",
  });

  mocks.models.clear();
  mocks.rate.mockClear();
  emitted = [];
  for (const event of [
    "job-update",
    "job-deleted",
    "item-update",
    "item-deleted",
  ]) {
    listen(event);
  }
});

afterEach(() => {
  for (const stop of stopListening.splice(0)) stop();
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

// ── Helpers ─────────────────────────────────────────────────────────────────

let jobCount = 0;

function queueJob(
  over: Partial<typeof importQueue.$inferInsert> = {},
): typeof importQueue.$inferSelect {
  const id = `00000000-0000-4000-8000-${String(++jobCount).padStart(12, "0")}`;
  db.insert(importQueue)
    .values({
      id,
      createdBy: 1,
      state: ImportState.Queued,
      tempFilePath: `import/temp/${id}_fees.pdf`,
      originalFilename: "fees.pdf",
      fileHash: `hash-${id}`,
      preExtractedText:
        "Shopee Malaysia fee notice\nCommission 12.50\nService fee 30.00",
      ...over,
    })
    .run();
  return job(id);
}

function job(id: string) {
  return db.select().from(importQueue).where(eq(importQueue.id, id)).get()!;
}

function itemsOf(jobId: string) {
  return db
    .select()
    .from(importItems)
    .where(eq(importItems.jobId, jobId))
    .all()
    .sort((a, b) => a.position - b.position);
}

function serve(replies: Reply[]) {
  const model = mockModel(replies);
  mocks.models.set("main", model);
  return model;
}

const json = (value: unknown): Reply => ({ text: JSON.stringify(value) });

function receiptAnswer(over: Record<string, unknown> = {}) {
  return {
    document_type: "expense",
    item_name: "Printer paper",
    supplier: "Shopee Malaysia",
    date: "2026-08-14",
    amount: 12.5,
    currency: "MYR",
    reference: "INV-1",
    category_account_id: null,
    ...over,
  };
}

type Line = {
  description: string;
  amount: number;
  date?: string | null;
  reference?: string | null;
  category_account_id?: number | null;
};

function itemsAnswer(
  lines: Line[],
  options: {
    stated?: number | null;
    currency?: string;
    reference?: string;
    date?: string;
    ignored?: string[];
  } = {},
) {
  return {
    header: {
      document_type: "expense",
      counterparty: "Shopee Malaysia",
      date: options.date ?? "2026-08-31",
      reference: options.reference ?? "FN-2026-08",
      currency: options.currency ?? "MYR",
    },
    stated_total: options.stated ?? null,
    sections: {
      items: lines.map((line, index) => ({
        date: null,
        reference: null,
        source_line: index + 2,
        category_account_id: null,
        ...line,
      })),
    },
    ignored: options.ignored ?? [],
  };
}

async function run(row: typeof importQueue.$inferSelect) {
  await processImportJob(db, row, { storageRoot: join(dir, "storage") });
  return job(row.id);
}

/** A record already in the books, with both of its sides. */
function seedRecord(over: {
  amount: number;
  date: string;
  reference: string;
  extractedText?: string;
}) {
  const [record] = db
    .insert(ledgerRecords)
    .values({
      kind: LedgerRecordKind.Expense,
      date: over.date,
      description: "Commission",
      contactId: ids.supplier,
      reference: over.reference,
      amount: over.amount,
      currency: "MYR",
      extractedText: over.extractedText ?? null,
    })
    .returning({ id: ledgerRecords.id })
    .all();
  const minor = Math.round(over.amount * 100);
  db.insert(ledgerMovements)
    .values([
      { recordId: record.id, accountId: ids.fees, amountMinor: minor },
      { recordId: record.id, accountId: ids.payable, amountMinor: -minor },
    ])
    .run();
  return record.id;
}

// ── The receipt reading ──────────────────────────────────────────────────────

describe("reading a receipt", () => {
  it("leaves one review card on the queue row, as before 006", async () => {
    serve([json(receiptAnswer({ category_account_id: ids.fees }))]);
    const row = await run(
      queueJob({
        readAs: ImportReadAs.Receipt,
        readHow: ImportReadHow.Chosen,
        preExtractedText: "  RECEIPT Shopee Malaysia 12.50  ",
      }),
    );

    expect(row).toMatchObject({
      state: ImportState.PendingReview,
      documentType: DocumentType.Expense,
      extractedText: "RECEIPT Shopee Malaysia 12.50",
      itemName: "Printer paper",
      supplier: "Shopee Malaysia",
      matchedContactId: ids.supplier,
      matchCandidates: null,
      date: "2026-08-14",
      amount: 12.5,
      currency: "MYR",
      exchangeRate: 1,
      reference: "INV-1",
      category: "Marketplace Fees",
      categoryAccountId: ids.fees,
      remark: null,
      accountId: ids.payable,
      duplicateOf: null,
      profileId: null,
      extractionNotes: null,
    });
    expect(row.processedAt).not.toBeNull();
    expect(itemsOf(row.id)).toEqual([]);
    expect(mocks.rate).not.toHaveBeenCalled();
    // Processing, then the card; never an item event.
    expect(emitted.map((e) => e.event)).toEqual(["job-update", "job-update"]);
    for (const { payload } of emitted) {
      expect(payload.job).not.toHaveProperty("extractedText");
      expect(payload.job).not.toHaveProperty("preExtractedText");
    }
  });

  it("reads an old row with no choice stored, and Auto-detect, as a receipt", async () => {
    serve([json(receiptAnswer())]);
    const old = await run(queueJob({ readAs: null, readHow: null }));
    const auto = await run(
      queueJob({ readAs: ImportReadAs.Auto, readHow: ImportReadHow.Standard }),
    );
    for (const row of [old, auto]) {
      expect(row.state).toBe(ImportState.PendingReview);
      expect(row.amount).toBe(12.5);
    }
    // The old row is left saying nothing about how it was read (FR-048).
    expect(old.readAs).toBeNull();
    expect(old.readHow).toBeNull();
  });

  it("files an unknown category under Uncategorised and an income on Receivable", async () => {
    serve([
      json(
        receiptAnswer({ document_type: "income", category_account_id: 999 }),
      ),
    ]);
    const row = await run(queueJob({ readAs: ImportReadAs.Receipt }));
    expect(row).toMatchObject({
      documentType: DocumentType.Income,
      categoryAccountId: ids.uncategorisedIncome,
      category: "Uncategorised Income",
      accountId: ids.receivable,
      // A supplier is not searched for as a customer.
      matchedContactId: null,
    });
  });

  it("asks for a foreign currency's rate for the document's date", async () => {
    serve([json(receiptAnswer({ currency: "usd" }))]);
    const row = await run(queueJob({ readAs: ImportReadAs.Receipt }));
    expect(row.currency).toBe("USD");
    expect(row.exchangeRate).toBe(4.5);
    expect(mocks.rate).toHaveBeenCalledTimes(1);
    expect(mocks.rate.mock.calls[0][1]).toEqual({
      from: "USD",
      to: "MYR",
      date: "2026-08-14",
    });
  });

  it("still reads a receipt whose file was imported before, and flags it", async () => {
    const recordId = seedRecord({
      amount: 99,
      date: "2026-01-01",
      reference: "OLD",
    });
    queueJob({
      state: ImportState.Imported,
      fileHash: "same-file",
      resultId: recordId,
      resultType: DocumentType.Expense,
    });
    serve([json(receiptAnswer())]);
    const row = await run(
      queueJob({ readAs: ImportReadAs.Receipt, fileHash: "same-file" }),
    );
    // No stop before reading for a receipt (FR-004): the card is flagged.
    expect(row.state).toBe(ImportState.PendingReview);
    expect(row.duplicateOf).toBe(recordId);
    expect(JSON.parse(row.duplicateReasons!)).toEqual(["file_hash"]);
  });

  it("fails with the provider's message when reading fails", async () => {
    serve([{ error: new Error("provider down") }]);
    const row = await run(queueJob({ readAs: ImportReadAs.Receipt }));
    expect(row.state).toBe(ImportState.Failed);
    expect(row.error).toContain("AI extraction failed");
  });
});

// ── The several-items reading ────────────────────────────────────────────────

describe("reading a document with several items", () => {
  it("fails with No items found when nothing is proposed", async () => {
    serve([json(itemsAnswer([], { ignored: ["Total 0.00"] }))]);
    const row = await run(queueJob({ readAs: ImportReadAs.SeveralItems }));
    expect(row.state).toBe(ImportState.Failed);
    expect(row.error).toBe(NO_ITEMS_FOUND);
    expect(itemsOf(row.id)).toEqual([]);
  });

  it("reviews a single item as a receipt, with no group", async () => {
    serve([
      json(
        itemsAnswer(
          [
            {
              description: "Commission",
              amount: 12.5,
              category_account_id: ids.fees,
            },
          ],
          { stated: 12.5, ignored: ["Amount due 12.50"] },
        ),
      ),
    ]);
    const row = await run(queueJob({ readAs: ImportReadAs.SeveralItems }));

    expect(row).toMatchObject({
      state: ImportState.PendingReview,
      documentType: DocumentType.Expense,
      itemName: "Commission",
      supplier: "Shopee Malaysia",
      matchedContactId: ids.supplier,
      date: "2026-08-31",
      reference: "FN-2026-08",
      amount: 12.5,
      currency: "MYR",
      exchangeRate: 1,
      categoryAccountId: ids.fees,
      accountId: ids.payable,
      profileId: "builtin:items@1",
    });
    // The text is kept for search as a receipt's is, without line numbers.
    expect(row.extractedText).toBe(
      "Shopee Malaysia fee notice\nCommission 12.50\nService fee 30.00",
    );
    expect(parseExtractionNotes(row.extractionNotes)).toEqual({
      statedTotal: { minor: -1250, currency: "MYR" },
      itemsTotalMinor: -1250,
      ignored: ["Amount due 12.50"],
    });
    expect(itemsOf(row.id)).toEqual([]);
    expect(emitted.some((e) => e.event === "item-update")).toBe(false);
  });

  it("groups several items in one write and announces them after it", async () => {
    serve([
      json(
        itemsAnswer(
          [
            {
              description: "Commission",
              amount: 12.5,
              category_account_id: ids.fees,
            },
            {
              description: "Service fee",
              amount: 30,
              reference: "SF-9",
              date: "2026-08-20",
            },
            { description: "Payment fee", amount: 2.1 },
          ],
          { stated: 44.6, ignored: ["Subtotal 44.60"] },
        ),
      ),
    ]);
    const row = await run(queueJob({ readAs: ImportReadAs.SeveralItems }));

    expect(row.state).toBe(ImportState.Grouped);
    expect(row.profileId).toBe("builtin:items@1");
    expect(row.error).toBeNull();
    // A group's records never carry the whole document's text (FR-029).
    expect(row.extractedText).toBeNull();
    // The queue row holds the file and the group, not a record of its own.
    expect(row.amount).toBeNull();
    expect(row.documentType).toBeNull();
    // It keeps the document's header: the date is the month the shared file
    // is filed under when the first item is confirmed.
    expect(row).toMatchObject({
      date: "2026-08-31",
      supplier: "Shopee Malaysia",
      reference: "FN-2026-08",
      currency: "MYR",
    });
    expect(parseExtractionNotes(row.extractionNotes)).toEqual({
      statedTotal: { minor: -4460, currency: "MYR" },
      itemsTotalMinor: -4460,
      ignored: ["Subtotal 44.60"],
    });

    const items = itemsOf(row.id);
    expect(items).toHaveLength(3);
    expect(items.map((item) => item.state)).toEqual([
      ImportState.PendingReview,
      ImportState.PendingReview,
      ImportState.PendingReview,
    ]);
    expect(items[0]).toMatchObject({
      position: 0,
      sourceLine: 2,
      sectionKey: "items",
      feeType: null,
      extrasJson: null,
      documentType: DocumentType.Expense,
      itemName: "Commission",
      supplier: "Shopee Malaysia",
      matchedContactId: ids.supplier,
      amount: 12.5,
      currency: "MYR",
      exchangeRate: 1,
      date: "2026-08-31",
      reference: "FN-2026-08",
      categoryAccountId: ids.fees,
      category: "Marketplace Fees",
      accountId: ids.payable,
      remark: null,
      duplicateOf: null,
      resultId: null,
    });
    // An item's own date and reference are its own; the rest is the header's.
    expect(items[1]).toMatchObject({
      date: "2026-08-20",
      reference: "SF-9",
      supplier: "Shopee Malaysia",
      categoryAccountId: ids.uncategorised,
    });
    expect(items[2].amount).toBe(2.1);

    // Processing, then the group, then one event per item — all after the
    // write, so every announced item is already in the table.
    const events = emitted.map((e) => e.event);
    expect(events).toEqual([
      "job-update",
      "job-update",
      "item-update",
      "item-update",
      "item-update",
    ]);
    const groupEvent = emitted[1].payload.job as Record<string, unknown>;
    expect(groupEvent.state).toBe(ImportState.Grouped);
    expect(groupEvent).not.toHaveProperty("extractedText");
    expect(groupEvent).not.toHaveProperty("items");
    expect(
      emitted.slice(2).map((e) => (e.payload.item as { id: string }).id),
    ).toEqual(items.map((item) => item.id));
    expect(emitted[2].payload.jobId).toBe(row.id);
  });

  it("asks for a foreign rate once per distinct date", async () => {
    serve([
      json(
        itemsAnswer(
          [
            { description: "Fee A", amount: 1 },
            { description: "Fee B", amount: 2 },
            { description: "Fee C", amount: 3, date: "2026-08-15" },
            { description: "Fee D", amount: 4, date: "2026-08-15" },
          ],
          { currency: "USD" },
        ),
      ),
    ]);
    const row = await run(queueJob({ readAs: ImportReadAs.SeveralItems }));
    const items = itemsOf(row.id);
    expect(items.map((item) => [item.currency, item.exchangeRate])).toEqual([
      ["USD", 4.5],
      ["USD", 4.5],
      ["USD", 4.5],
      ["USD", 4.5],
    ]);
    expect(mocks.rate).toHaveBeenCalledTimes(2);
    expect(mocks.rate.mock.calls.map((call) => call[1])).toEqual([
      { from: "USD", to: "MYR", date: "2026-08-31" },
      { from: "USD", to: "MYR", date: "2026-08-15" },
    ]);
  });

  it("leaves a foreign rate for the reviewer when none is available", async () => {
    mocks.rate.mockResolvedValueOnce({ rate: null, source: "api" });
    serve([
      json(
        itemsAnswer(
          [
            { description: "Fee A", amount: 1 },
            { description: "Fee B", amount: 2 },
          ],
          { currency: "USD" },
        ),
      ),
    ]);
    const row = await run(queueJob({ readAs: ImportReadAs.SeveralItems }));
    expect(itemsOf(row.id).map((item) => item.exchangeRate)).toEqual([
      null,
      null,
    ]);
  });

  it("names the limit when the document has too many items", async () => {
    serve([
      json(
        itemsAnswer(
          Array.from({ length: 1001 }, (_, i) => ({
            description: `Fee ${i}`,
            amount: 1,
          })),
        ),
      ),
    ]);
    const row = await run(queueJob({ readAs: ImportReadAs.SeveralItems }));
    expect(row.state).toBe(ImportState.Failed);
    expect(row.error).toContain("limit is 1,000");
    expect(itemsOf(row.id)).toEqual([]);
  });

  it("saves no item when one write fails part-way, and fails the job", async () => {
    // A row the database refuses, well past the first batch of inserts.
    sqlite.exec(`CREATE TRIGGER refuse_item BEFORE INSERT ON import_items
      WHEN NEW.position = 120
      BEGIN SELECT RAISE(ABORT, 'disk full'); END;`);
    serve([
      json(
        itemsAnswer(
          Array.from({ length: 150 }, (_, i) => ({
            description: `Fee ${i}`,
            amount: i + 1,
          })),
        ),
      ),
    ]);
    const row = await run(queueJob({ readAs: ImportReadAs.SeveralItems }));

    expect(itemsOf(row.id)).toEqual([]);
    expect(row.state).toBe(ImportState.Failed);
    expect(row.error).toContain("disk full");
    expect(row.extractionNotes).toBeNull();
    expect(emitted.some((e) => e.event === "item-update")).toBe(false);
  });

  it("saves no item for a job deleted while it was being read", async () => {
    const queued = queueJob({ readAs: ImportReadAs.SeveralItems });
    mocks.models.set(
      "main",
      mockModel([
        json(
          itemsAnswer([
            { description: "Fee A", amount: 1 },
            { description: "Fee B", amount: 2 },
          ]),
        ),
      ]),
    );
    // Discard the document while the model is answering.
    const model = mocks.models.get("main") as ReturnType<typeof mockModel>;
    const answer = model.doGenerate.bind(model);
    model.doGenerate = async (options) => {
      db.delete(importQueue).where(eq(importQueue.id, queued.id)).run();
      return answer(options);
    };

    await processImportJob(db, queued, { storageRoot: dir });

    expect(
      db.select().from(importQueue).where(eq(importQueue.id, queued.id)).get(),
    ).toBeUndefined();
    expect(db.select().from(importItems).all()).toEqual([]);
    expect(emitted.some((e) => e.event === "item-update")).toBe(false);
  });

  it("saves no item for a job moved out of reading while it was read", async () => {
    const queued = queueJob({ readAs: ImportReadAs.SeveralItems });
    const model = serve([
      json(
        itemsAnswer([
          { description: "Fee A", amount: 1 },
          { description: "Fee B", amount: 2 },
        ]),
      ),
    ]);
    const answer = model.doGenerate.bind(model);
    model.doGenerate = async (options) => {
      db.update(importQueue)
        .set({ state: ImportState.Skipped })
        .where(eq(importQueue.id, queued.id))
        .run();
      return answer(options);
    };

    const row = await run(queued);
    expect(row.state).toBe(ImportState.Skipped);
    expect(itemsOf(row.id)).toEqual([]);
  });
});

// ── Stopping a file already imported (FR-026) ───────────────────────────────

describe("a file already imported", () => {
  function groupedEarlier(
    itemStates: number[],
    parentState: number = ImportState.Grouped,
  ) {
    const earlier = queueJob({
      state: parentState,
      fileHash: "same-file",
      readAs: ImportReadAs.SeveralItems,
    });
    itemStates.forEach((state, position) => {
      db.insert(importItems)
        .values({
          id: `${earlier.id.slice(0, -2)}${String(position).padStart(2, "0")}-item`,
          jobId: earlier.id,
          state,
          position,
          sectionKey: "items",
        })
        .run();
    });
    return earlier;
  }

  it("stops before reading when a group from it made records", async () => {
    groupedEarlier([
      ImportState.Imported,
      ImportState.Imported,
      ImportState.Skipped,
    ]);
    const model = serve([json(itemsAnswer([]))]);
    const row = await run(
      queueJob({ readAs: ImportReadAs.SeveralItems, fileHash: "same-file" }),
    );
    expect(row.state).toBe(ImportState.Failed);
    expect(row.error).toBe(
      "This file was already imported as a document with several items, which made 2 records. It was not read again.",
    );
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it("counts every record of a finished group, not one for the group", async () => {
    groupedEarlier(
      [ImportState.Imported, ImportState.Imported, ImportState.Imported],
      ImportState.Imported,
    );
    const model = serve([json(itemsAnswer([]))]);
    const row = await run(
      queueJob({ readAs: ImportReadAs.SeveralItems, fileHash: "same-file" }),
    );
    expect(row.state).toBe(ImportState.Failed);
    expect(row.error).toBe(
      "This file was already imported as a document with several items, which made 3 records. It was not read again.",
    );
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it("stops before reading when it was imported as a receipt", async () => {
    queueJob({
      state: ImportState.Imported,
      fileHash: "same-file",
      readAs: null,
      resultId: 1,
    });
    const model = serve([json(itemsAnswer([]))]);
    const row = await run(
      queueJob({ readAs: ImportReadAs.SeveralItems, fileHash: "same-file" }),
    );
    expect(row.state).toBe(ImportState.Failed);
    expect(row.error).toBe(
      "This file was already imported as a receipt or invoice, which made 1 record. It was not read again.",
    );
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it("reads it again when the earlier upload made no record", async () => {
    groupedEarlier([ImportState.Skipped, ImportState.PendingReview]);
    queueJob({ state: ImportState.Skipped, fileHash: "same-file" });
    queueJob({ state: ImportState.Failed, fileHash: "same-file" });
    serve([
      json(
        itemsAnswer([
          { description: "Fee A", amount: 1 },
          { description: "Fee B", amount: 2 },
        ]),
      ),
    ]);
    const row = await run(
      queueJob({ readAs: ImportReadAs.SeveralItems, fileHash: "same-file" }),
    );
    expect(row.state).toBe(ImportState.Grouped);
    expect(itemsOf(row.id)).toHaveLength(2);
  });

  it("does not stop a different file", async () => {
    groupedEarlier([ImportState.Imported]);
    serve([
      json(
        itemsAnswer([
          { description: "Fee A", amount: 1 },
          { description: "Fee B", amount: 2 },
        ]),
      ),
    ]);
    const row = await run(
      queueJob({ readAs: ImportReadAs.SeveralItems, fileHash: "other-file" }),
    );
    expect(row.state).toBe(ImportState.Grouped);
  });
});

// ── Duplicates for items (FR-024, FR-025) ───────────────────────────────────

describe("the duplicate check for items", () => {
  /** Last month's fee notice, imported as a receipt from a file of the same name. */
  function lastMonth() {
    const recordId = seedRecord({
      amount: 12.5,
      date: "2026-07-31",
      reference: "FN-2026-07",
      extractedText:
        "Shopee Malaysia fee notice Commission 12.50 Service fee 30.00",
    });
    queueJob({
      state: ImportState.Imported,
      originalFilename: "fees.pdf",
      fileHash: "last-month",
      resultId: recordId,
      resultType: DocumentType.Expense,
    });
    return recordId;
  }

  it("does not flag this month's items that repeat last month's", async () => {
    lastMonth();
    serve([
      json(
        itemsAnswer([
          { description: "Commission", amount: 12.5 },
          { description: "Service fee", amount: 30 },
        ]),
      ),
    ]);
    const row = await run(queueJob({ readAs: ImportReadAs.SeveralItems }));
    expect(
      itemsOf(row.id).map((item) => [item.duplicateOf, item.duplicateReasons]),
    ).toEqual([
      [null, null],
      [null, null],
    ]);
  });

  it("would have flagged the same line read as a receipt, by file name", async () => {
    // The contrast: the signals items leave out are what flag a receipt here.
    const recordId = lastMonth();
    serve([
      json(receiptAnswer({ amount: 12.5, date: "2026-08-31", reference: "" })),
    ]);
    const row = await run(queueJob({ readAs: ImportReadAs.Receipt }));
    expect(row.duplicateOf).toBe(recordId);
    expect(JSON.parse(row.duplicateReasons!)).toContain("filename");
  });

  it("flags an item whose reference matches a record", async () => {
    lastMonth();
    const booked = seedRecord({
      amount: 99,
      date: "2026-03-01",
      reference: "SF-9",
    });
    serve([
      json(
        itemsAnswer([
          { description: "Commission", amount: 12.5 },
          { description: "Service fee", amount: 30, reference: "SF-9" },
        ]),
      ),
    ]);
    const row = await run(queueJob({ readAs: ImportReadAs.SeveralItems }));
    const [first, second] = itemsOf(row.id);
    expect(first.duplicateOf).toBeNull();
    expect(second.duplicateOf).toBe(booked);
    expect(JSON.parse(second.duplicateReasons!)).toContain("reference");
  });

  it("flags an item with the same date, amount and contact as a record", async () => {
    const booked = seedRecord({
      amount: 30,
      date: "2026-08-31",
      reference: "",
    });
    serve([
      json(
        itemsAnswer(
          [
            { description: "Commission", amount: 12.5 },
            { description: "Service fee", amount: 30 },
          ],
          { reference: "" },
        ),
      ),
    ]);
    const row = await run(queueJob({ readAs: ImportReadAs.SeveralItems }));
    const [first, second] = itemsOf(row.id);
    expect(first.duplicateOf).toBeNull();
    expect(second.duplicateOf).toBe(booked);
    expect(JSON.parse(second.duplicateReasons!)).toEqual([
      "amount",
      "date",
      "supplier",
    ]);
  });
});

// ── Spreadsheets (006 S4.2) ─────────────────────────────────────────────────

describe("reading a spreadsheet", () => {
  /**
   * A job whose file is really in its storage folder, with no text given
   * with the upload, so the file itself is read.
   */
  function queueFile(
    filename: string,
    data: Buffer | string,
    over: Partial<typeof importQueue.$inferInsert> = {},
  ) {
    const row = queueJob({
      originalFilename: filename,
      preExtractedText: null,
      ...over,
    });
    const tempFilePath = `import/temp/${row.id}_${filename}`;
    const abs = join(dir, "storage", tempFilePath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, data);
    db.update(importQueue)
      .set({ tempFilePath })
      .where(eq(importQueue.id, row.id))
      .run();
    return job(row.id);
  }

  /** Every piece of text the model was sent on its first call. */
  function sentText(model: ReturnType<typeof serve>): string {
    const texts: string[] = [];
    const walk = (value: unknown) => {
      if (typeof value === "string") texts.push(value);
      else if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === "object")
        Object.values(value).forEach(walk);
    };
    walk(model.doGenerateCalls[0].prompt);
    return texts.join("\n");
  }

  const CSV = "Date,Description,Amount\n2026-08-14,Printer paper,12.50\n";

  it("reads a workbook as several items from its numbered rows (FR-051)", async () => {
    const model = serve([
      json(
        itemsAnswer(
          [
            { description: "Income from Order #A1", amount: 12.5 },
            { description: "Withdrawal to bank", amount: 100 },
          ],
          { reference: "" },
        ),
      ),
    ]);
    const row = await run(
      queueFile("wallet.xlsx", walletReportFixture().xlsx, {
        readAs: ImportReadAs.SeveralItems,
      }),
    );

    expect(row.state).toBe(ImportState.Grouped);
    expect(itemsOf(row.id)).toHaveLength(2);
    const sent = sentText(model);
    expect(sent).toContain("--- page 1 ---\nL0001│Sheet: Transaction Report");
    expect(sent).toMatch(
      /L\d{4}│Date \| Transaction Type \| Description \| Order ID \| Money Direction \| Amount \| Status \| Balance After Transactions\n/,
    );
    expect(sent).toMatch(
      /L\d{4}│2026-03-28 18:40:00 \| Withdrawal \| Withdrawal to bank \| {2}\| Money Out \| -100\.00 \| Processing \| 230\.25/,
    );
    // A spreadsheet is quick to read again, so its text is not kept.
    expect(row.extractedText).toBeNull();
  });

  it("reads a CSV file with one item as a receipt card, keeping its text", async () => {
    const model = serve([
      json(itemsAnswer([{ description: "Printer paper", amount: 12.5 }])),
    ]);
    const row = await run(
      queueFile("export.csv", CSV, { readAs: ImportReadAs.SeveralItems }),
    );

    expect(row.state).toBe(ImportState.PendingReview);
    expect(row.amount).toBe(12.5);
    expect(sentText(model)).toContain(
      "L0001│Sheet: Sheet1\nL0002│Date | Description | Amount\nL0003│2026-08-14 | Printer paper | 12.50",
    );
    expect(row.extractedText).toBe(
      "Sheet: Sheet1\nDate | Description | Amount\n2026-08-14 | Printer paper | 12.50",
    );
  });

  it("reads a short spreadsheet the standard way", async () => {
    const model = serve([json(receiptAnswer())]);
    const row = await run(
      queueFile("receipt.csv", CSV, { readAs: ImportReadAs.Receipt }),
    );

    expect(row.state).toBe(ImportState.PendingReview);
    expect(row.amount).toBe(12.5);
    expect(sentText(model)).toContain(
      "Sheet: Sheet1\nDate | Description | Amount\n2026-08-14 | Printer paper | 12.50",
    );
  });

  it("refuses a spreadsheet too long for the standard reading, naming the limit (FR-052)", async () => {
    const lines = ["Date,Description,Amount"];
    for (let i = 0; i < 300; i++) lines.push(`2026-08-14,Order ${i},1.00`);
    const model = serve([json(receiptAnswer())]);

    for (const readAs of [ImportReadAs.Receipt, ImportReadAs.Auto]) {
      const row = await run(
        queueFile("long.csv", lines.join("\n"), { readAs }),
      );
      expect(row.state).toBe(ImportState.Failed);
      expect(row.error).toMatch(
        /^This spreadsheet is too long to be read as a receipt or invoice: its text is [\d,]+ characters, and that reading takes at most 6,000\. Read it again as a document with several items, or with an import profile\.$/,
      );
    }
    // Never read from a shortened text: the AI is not asked at all.
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it("still cuts a long PDF's text for the standard reading, as before (FR-004)", async () => {
    const model = serve([json(receiptAnswer())]);
    const long = `RECEIPT ${"x".repeat(7000)} TAIL-MARKER`;
    const row = await run(
      queueJob({ readAs: ImportReadAs.Receipt, preExtractedText: long }),
    );

    expect(row.state).toBe(ImportState.PendingReview);
    const sent = sentText(model);
    expect(sent).toContain("RECEIPT x");
    expect(sent).not.toContain("TAIL-MARKER");
  });

  it("fails an empty spreadsheet before asking the AI", async () => {
    const model = serve([json(receiptAnswer())]);
    const row = await run(
      queueFile("empty.csv", ",,\n , ,\n", {
        readAs: ImportReadAs.SeveralItems,
      }),
    );

    expect(row.state).toBe(ImportState.Failed);
    expect(row.error).toBe(EMPTY_SPREADSHEET);
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it("names the problem with a workbook it cannot read", async () => {
    const model = serve([json(receiptAnswer())]);
    const locked = Buffer.alloc(1024);
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(locked);
    Buffer.from("EncryptedPackage", "utf16le").copy(locked, 600);
    const row = await run(
      queueFile("locked.xlsx", locked, { readAs: ImportReadAs.SeveralItems }),
    );

    expect(row.state).toBe(ImportState.Failed);
    expect(row.error).toMatch(/protected with a password/);
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it("reads every sheet of a workbook, in order", async () => {
    const model = serve([
      json(itemsAnswer([{ description: "Fee", amount: 1 }])),
    ]);
    await run(
      queueFile(
        "two.xlsx",
        buildXlsx({
          sheets: [
            { name: "March", rows: [["Fee", { raw: "1.00" }]] },
            { name: "April", rows: [["Fee", { raw: "2.00" }]] },
          ],
        }),
        { readAs: ImportReadAs.SeveralItems },
      ),
    );

    expect(sentText(model)).toContain(
      "--- page 1 ---\nL0001│Sheet: March\nL0002│Fee | 1.00\n--- page 2 ---\nL0003│Sheet: April\nL0004│Fee | 2.00",
    );
  });
});
