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
import { walletReportFixture } from "../extraction/spreadsheet/__fixtures__/build-xlsx.js";
import {
  orderSections,
  walletLayout,
  walletWorkbook,
  withdrawalSection,
} from "./__fixtures__/wallet-table.js";

/**
 * A spreadsheet read from its columns, end to end (006 S4.5, US10, FR-053 to
 * FR-057, FR-061 to FR-063): the routing in `processImportJob` that reads it
 * by code with no AI provider, Auto-detect by the table's headings, the group
 * it leaves for review, and "Confirm all" leaving a flagged row behind.
 *
 * The database is a file under `os.tmpdir()`, migrated from `drizzle/`, and
 * the job's storage folder is there too. No AI provider is set up unless a
 * test adds one, and then it is a mock model that plays back fixed answers.
 * Every workbook is built in memory, with made-up values.
 */

const sandbox = mkdtempSync(join(tmpdir(), "akaun-columns-reading-spec-"));

const holder = vi.hoisted(() => ({
  db: null as unknown,
  models: new Map<string, unknown>(),
}));

vi.mock("$lib/server/env.js", () => ({
  get STORAGE_PATH() {
    return join(sandbox, "default-root");
  },
  DATABASE_PATH: "/dev/null",
  OCR_CACHE_PATH: "/dev/null",
}));

vi.mock("$lib/server/db/client.js", () => ({
  get db() {
    return holder.db;
  },
}));

vi.mock("$lib/server/permissions.js", () => ({
  hasPermission: () => true,
}));

vi.mock("$lib/server/llm/model-factory.js", () => ({
  createModel: vi.fn((config: { name: string }) => {
    const model = holder.models.get(config.name);
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
  getExchangeRate: vi.fn(async () => ({ rate: 4.5, source: "api" })),
}));

vi.mock("$lib/server/extraction/attachment-text.js", () => ({
  extractAttachmentsText: vi.fn(async () => null),
}));

const {
  AccountSubType,
  AccountType,
  DefaultAccountPurpose,
  DocumentType,
  EntityType,
  ImportState,
  LedgerRecordKind,
} = await import("$lib/enums.js");
const {
  ImportMode,
  ImportReadAs,
  ImportReadHow,
  ignoredSummary,
  parseExtractionNotes,
} = await import("$lib/import-reading.js");
const schema = await import("../db/schema.js");
const {
  accountDefaults,
  contacts,
  importItems,
  importQueue,
  ledgerRecords,
  users,
} = schema;
const { createAccount } = await import("../services/accounts.js");
const { createRecord } = await import("../services/ledger.js");
const { createImportProfile } = await import("../services/import-profiles.js");
const { confirmGroupItems } = await import("../services/import-items.js");
const { insertProvider } = await import("../llmProviders.js");
const { setSetting, SETTING_KEYS } = await import("../settings.js");
const { NO_PROVIDERS, processImportJob, severalLayoutsFit } =
  await import("./process-job.js");
const { itemAttention } = await import("./group-state.js");
const { parseProfileSnapshot } = await import("./profile-snapshot.js");
const { describeReading } =
  await import("$lib/components/import/review-card.js");
type LedgerDb = import("../ledger/types.js").LedgerDb;
type ProfileInput = import("$lib/import-profile-schema.js").ImportProfileDraft;

let dir: string;
let storageRoot: string;
let sqlite: Database;
let db: LedgerDb;
let ids: {
  payable: number;
  receivable: number;
  uncategorised: number;
  uncategorisedIncome: number;
  sales: number;
  wallet: number;
  bank: number;
};

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
  storageRoot = join(dir, "storage");
  sqlite = new Database(join(dir, "test.db"));
  sqlite.exec("PRAGMA foreign_keys = ON;");
  db = drizzle(sqlite, { schema }) as unknown as LedgerDb;
  holder.db = db;
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
    sales: account("Sales", AccountType.Revenue),
    wallet: account(
      "Marketplace wallet",
      AccountType.Asset,
      AccountSubType.Wallet,
    ),
    bank: account("Current account", AccountType.Asset, AccountSubType.Bank),
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
  holder.models.clear();
});

afterEach(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Every row: order income and adjustments by sign, withdrawals as transfers. */
function fullProfile(over: Partial<ProfileInput> = {}): ProfileInput {
  return {
    name: "Wallet report, every transaction",
    description: "A marketplace wallet's list of money in and out.",
    phrases: [],
    instructions: "",
    statedTotalLabels: {},
    accountId: ids.wallet,
    layout: walletLayout(),
    sections: [
      ...orderSections({ orders: ids.sales }),
      withdrawalSection(ids.bank),
    ],
    ...over,
  };
}

/** Only the withdrawals; every other row is left out. */
function withdrawalsProfile(over: Partial<ProfileInput> = {}): ProfileInput {
  return fullProfile({
    name: "Wallet report, withdrawals only",
    layout: walletLayout({ statedTotalLabels: {} }),
    sections: [withdrawalSection(ids.bank)],
    ...over,
  });
}

/** Read from columns, with headings the wallet report does not have. */
function otherLayoutProfile(): ProfileInput {
  return {
    ...fullProfile({ name: "Other layout" }),
    layout: walletLayout({
      headers: ["Date", "Amount", "Fee"],
      columns: {
        date: "Date",
        description: "Fee",
        amount: "Amount",
        reference: null,
      },
      direction: null,
      remarkColumns: [],
    }),
    sections: [
      {
        ...orderSections()[0],
        rows: { where: [], flagWhen: [], flagNote: "", feeTypeColumn: null },
      },
    ],
  };
}

/** Read by the AI: no layout, and no row rules. */
function aiProfile(): ProfileInput {
  const { rows: _rows, ...section } = withdrawalSection(ids.bank);
  void _rows;
  return fullProfile({
    name: "Statement read by the AI",
    layout: null,
    sections: [section],
  });
}

function saveProfile(input: ProfileInput): number {
  const created = createImportProfile(db, 1, input);
  if (!created.ok) throw new Error(created.reason);
  return created.value.id;
}

function addProvider() {
  insertProvider(db, {
    type: "groq",
    name: "main",
    apiKey: "test-key",
    model: "main-model",
  });
}

function serve(replies: Reply[]) {
  const model = mockModel(replies);
  holder.models.set("main", model);
  return model;
}

let jobCount = 0;

function queueFile(
  filename: string,
  data: Buffer | string,
  over: Partial<typeof importQueue.$inferInsert> = {},
) {
  const id = `00000000-0000-4000-9200-${String(++jobCount).padStart(12, "0")}`;
  const tempFilePath = `import/temp/${id}_${filename}`;
  db.insert(importQueue)
    .values({
      id,
      createdBy: 1,
      state: ImportState.Queued,
      tempFilePath,
      originalFilename: filename,
      fileHash: `hash-${id}`,
      importMode: ImportMode.EveryTransaction,
      ...over,
    })
    .run();
  const abs = join(storageRoot, tempFilePath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, data);
  return job(id);
}

function withProfile(
  profileId: number,
  data: Buffer | string = walletReportFixture().xlsx,
  filename = "wallet.xlsx",
) {
  return queueFile(filename, data, {
    readAs: ImportReadAs.Profile,
    profileId: String(profileId),
  });
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

async function run(row: typeof importQueue.$inferSelect) {
  await processImportJob(db, row, { storageRoot });
  return job(row.id);
}

// ── Reading from columns ────────────────────────────────────────────────────

describe("reading a spreadsheet from its columns", () => {
  it("reads every row by code, with no AI provider set up (FR-055)", async () => {
    const profileId = saveProfile(fullProfile());
    const row = await run(withProfile(profileId));

    expect(row.state).toBe(ImportState.Grouped);
    expect(row.error).toBeNull();
    const items = itemsOf(row.id);
    expect(items.map((item) => item.documentType)).toEqual([
      DocumentType.Income,
      DocumentType.Income,
      DocumentType.TransferOut,
      DocumentType.Expense,
      DocumentType.Expense,
      DocumentType.Income,
      DocumentType.TransferOut,
      DocumentType.Income,
    ]);
    // Every item starts on the wallet; a transfer goes to the bank.
    expect(new Set(items.map((item) => item.accountId))).toEqual(
      new Set([ids.wallet]),
    );
    expect(
      items
        .filter((item) => item.documentType === DocumentType.TransferOut)
        .map((item) => [item.counterAccountId, item.amount, item.reference]),
    ).toEqual([
      [ids.bank, 100, ""],
      [ids.bank, 200, ""],
    ]);
    expect(items[0]).toMatchObject({
      itemName: "Income from Order #A1",
      reference: "A1",
      date: "2026-03-29",
      categoryAccountId: ids.sales,
      remark: "Transaction Type: Order Income",
      supplier: "Example Marketplace",
      sectionKey: "orders",
    });

    const notes = parseExtractionNotes(row.extractionNotes)!;
    expect(notes).toMatchObject({ method: "columns", ignoredCount: 0 });
    expect(notes.statedTotal?.minor).toBe(notes.itemsTotalMinor);
    // The group's document date is the one printed beside "To".
    expect(row.date).toBe("2026-03-29");

    // The copy names what was read: the layout, not a schema sent to an AI.
    const snapshot = parseProfileSnapshot(row.profileSnapshot)!;
    expect(snapshot.schemaId).toMatch(
      new RegExp(`^columns:${profileId}:[0-9a-f]{64}$`),
    );
    expect(snapshot.profile.layout).toEqual(walletLayout());
    expect(describeReading({ ...row, profile: snapshot })).toBe(
      "Read with “Wallet report, every transaction” (chosen) · Every transaction · read from columns",
    );
  });

  it("flags a withdrawal still processing, which Confirm all leaves behind (FR-061)", async () => {
    const profileId = saveProfile(withdrawalsProfile());
    const row = await run(withProfile(profileId));
    const items = itemsOf(row.id);
    expect(items).toHaveLength(2);
    const [processing, completed] = items;
    expect(processing.reviewNote).toBe("Check that this withdrawal completed.");
    expect(itemAttention(processing, "MYR")).toBe(
      "Check that this withdrawal completed.",
    );
    expect(completed.reviewNote).toBeNull();

    const outcomes = await confirmGroupItems(db, row.id, "all", {
      actingUserId: 1,
      storageRoot,
    });
    expect(outcomes.ok).toBe(true);
    if (!outcomes.ok) return;
    expect(outcomes.value.map((outcome) => [outcome.id, outcome.ok])).toEqual([
      [processing.id, false],
      [completed.id, true],
    ]);
    const records = db
      .select()
      .from(ledgerRecords)
      .where(eq(ledgerRecords.kind, LedgerRecordKind.Transfer))
      .all();
    expect(records).toHaveLength(1);
  });

  it("reads a report the size of the real one: 10 withdrawals, 726 rows left out", async () => {
    const report = walletWorkbook();
    const profileId = saveProfile(withdrawalsProfile());
    const row = await run(withProfile(profileId, report.xlsx));

    const items = itemsOf(row.id);
    expect(items).toHaveLength(10);
    expect(
      items.every((i) => i.documentType === DocumentType.TransferOut),
    ).toBe(true);
    expect(items.filter((item) => item.reviewNote)).toHaveLength(1);
    const notes = parseExtractionNotes(row.extractionNotes)!;
    expect(notes.statedTotal).toBeNull();
    expect(ignoredSummary(notes)).toBe("Ignored 726 lines (20 shown)");
  });

  // Each of the 736 items goes through the duplicate check, which is slow
  // when the whole suite runs at once, so this test has room for it.
  it("reads every row of a report the size of the real one, with a matching control total", async () => {
    const report = walletWorkbook();
    const all = await run(withProfile(saveProfile(fullProfile()), report.xlsx));
    const items = itemsOf(all.id);
    expect(items).toHaveLength(736);
    expect(
      items.filter((item) => item.documentType === DocumentType.TransferOut),
    ).toHaveLength(10);
    const allNotes = parseExtractionNotes(all.extractionNotes)!;
    expect(allNotes.statedTotal?.minor).toBe(
      report.moneyInMinor + report.moneyOutMinor,
    );
    expect(allNotes.itemsTotalMinor).toBe(allNotes.statedTotal?.minor);
  }, 60_000);

  it("fails, naming the row and column, with no partial group (FR-011)", async () => {
    const profileId = saveProfile(
      fullProfile({ layout: walletLayout({ dateFormat: "DD/MM/YYYY" }) }),
    );
    const row = await run(withProfile(profileId));
    expect(row.state).toBe(ImportState.Failed);
    expect(row.error).toBe(
      'Row 19, column A ("Date"): "2026-03-29 10:15:02" is not a date written as DD/MM/YYYY.',
    );
    expect(itemsOf(row.id)).toEqual([]);
  });

  it("reads a CSV file by the separator its layout names", async () => {
    const csv = [
      "Date|Transaction Type|Description|Order ID|Money Direction|Amount|Status|Balance After Transactions",
      "2026-03-29|Order Income|Order 1|A1|Money In|12.50|Transaction Completed|0",
      "2026-03-28|Withdrawals|Withdrawal to bank||Money Out|-5.00|Transaction Completed|0",
    ].join("\n");
    const layout = walletLayout({
      documentDateLabel: null,
      statedTotalLabels: {},
      csvDelimiter: "|",
    });
    const good = await run(
      withProfile(saveProfile(fullProfile({ layout })), csv, "wallet.csv"),
    );
    expect(good.state).toBe(ImportState.Grouped);
    expect(itemsOf(good.id).map((item) => item.amount)).toEqual([12.5, 5]);

    // Read with another separator, no row has the headings.
    const wrong = await run(
      withProfile(
        saveProfile(
          fullProfile({
            name: "Wrong",
            layout: { ...layout, csvDelimiter: ";" },
          }),
        ),
        csv,
        "wallet.csv",
      ),
    );
    expect(wrong.state).toBe(ImportState.Failed);
    expect(wrong.error).toMatch(
      /^The table of the import profile "Wrong" was not found/,
    );
  });

  it("still asks the AI for a mode whose sections have no row rules, and needs a provider for it (FR-057)", async () => {
    const summary = fullProfile().sections.map((section) => ({
      ...section,
      key: `${section.key}_s`,
      mode: ImportMode.Summary,
      rows: undefined,
    }));
    const profileId = saveProfile(
      fullProfile({ sections: [...fullProfile().sections, ...summary] }),
    );
    const row = await run(
      queueFile("wallet.xlsx", walletReportFixture().xlsx, {
        readAs: ImportReadAs.Profile,
        profileId: String(profileId),
        importMode: ImportMode.Summary,
      }),
    );
    expect(row.state).toBe(ImportState.Failed);
    expect(row.error).toBe(NO_PROVIDERS);
  });

  it("stops a PDF before it is read when no provider is set up, as before", async () => {
    const profileId = saveProfile(fullProfile());
    const row = await run(
      queueFile("wallet.pdf", "%PDF-1.4 not really", {
        readAs: ImportReadAs.Profile,
        profileId: String(profileId),
      }),
    );
    expect(row.state).toBe(ImportState.Failed);
    expect(row.error).toBe(NO_PROVIDERS);
  });

  it("does not take an item as a duplicate of a record with another reference (FR-063)", async () => {
    // Orders already in the books, on the same day, for the same amounts,
    // from the same marketplace: one is another order, one is this one.
    const marketplace = db
      .insert(contacts)
      .values({
        legalName: "Example Marketplace",
        entityType: EntityType.Business,
      })
      .returning({ id: contacts.id })
      .get().id;
    const order = (reference: string, amount: number) => {
      const created = createRecord(db, 1, {
        kind: "income",
        date: "2026-03-29",
        description: "Earlier order",
        amount,
        currency: "MYR",
        exchangeRate: 1,
        reference,
        contactId: marketplace,
        receivedIntoAccountId: ids.wallet,
        categoryAccountId: ids.sales,
      });
      if (!created.ok) throw new Error(created.reason);
      return created.value.id;
    };
    order("A9", 12.5);
    const same = order("A2", 7.25);
    const profileId = saveProfile(fullProfile());
    const row = await run(withProfile(profileId));
    const [first, second] = itemsOf(row.id);
    expect(first).toMatchObject({ reference: "A1", duplicateOf: null });
    expect(second).toMatchObject({ reference: "A2", duplicateOf: same });
  });
});

// ── Auto-detect ─────────────────────────────────────────────────────────────

describe("Auto-detect on a spreadsheet", () => {
  function auto(data: Buffer = walletReportFixture().xlsx) {
    return queueFile("wallet.xlsx", data, {
      readAs: ImportReadAs.Auto,
      readHow: ImportReadHow.Standard,
    });
  }

  it("uses the one profile whose headings the table has, with no AI (US10 AS12)", async () => {
    const profileId = saveProfile(withdrawalsProfile());
    saveProfile(otherLayoutProfile());
    const row = await run(auto());

    expect(row.state).toBe(ImportState.Grouped);
    expect(row).toMatchObject({
      readHow: ImportReadHow.Detected,
      profileId: String(profileId),
    });
    expect(itemsOf(row.id)).toHaveLength(2);
    expect(parseExtractionNotes(row.extractionNotes)?.method).toBe("columns");
  });

  it("goes on to the recognition phrases when several profiles' headings match", async () => {
    saveProfile(withdrawalsProfile({ phrases: ["Lazada"] }));
    const chosen = saveProfile(
      fullProfile({ phrases: ["Transaction Details", "Total Money Out"] }),
    );
    const row = await run(auto());
    expect(row).toMatchObject({
      state: ImportState.Grouped,
      readHow: ImportReadHow.Detected,
      profileId: String(chosen),
    });
    expect(itemsOf(row.id)).toHaveLength(8);
  });

  it("matches phrases in the cells' words, across two cells", async () => {
    saveProfile(withdrawalsProfile());
    // The phrase spans the label and its figure, two cells apart.
    const chosen = saveProfile(
      fullProfile({ phrases: ["Total Money In 54.15"] }),
    );
    const row = await run(auto());
    expect(row.profileId).toBe(String(chosen));
  });

  it("asks the AI only when headings and phrases do not decide, and a provider is set up", async () => {
    saveProfile(withdrawalsProfile());
    const second = saveProfile(fullProfile());
    addProvider();
    const model = serve([
      { text: JSON.stringify({ profile: String(second) }) },
    ]);
    const row = await run(auto());
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(row.profileId).toBe(String(second));
    // Detected by the AI, read from columns all the same.
    expect(parseExtractionNotes(row.extractionNotes)?.method).toBe("columns");
  });

  it("with no provider, names the profiles whose headings fit rather than read it as a receipt", async () => {
    saveProfile(withdrawalsProfile());
    saveProfile(fullProfile());
    const row = await run(auto());
    expect(row.state).toBe(ImportState.Failed);
    expect(row.error).toBe(
      // In the order "Read as" lists them: by name.
      severalLayoutsFit([
        { name: "Wallet report, every transaction" },
        { name: "Wallet report, withdrawals only" },
      ]),
    );
  });

  it("with no provider and no headings found, falls to the standard reading, which then needs one", async () => {
    saveProfile(otherLayoutProfile());
    const row = await run(auto());
    expect(row.state).toBe(ImportState.Failed);
    expect(row.error).toBe(NO_PROVIDERS);
    expect(row.readHow).toBe(ImportReadHow.Standard);
  });

  it("asks the AI among the profiles whose headings fit, even for a spreadsheet too long for a receipt", async () => {
    saveProfile(withdrawalsProfile());
    const second = saveProfile(fullProfile());
    // Read by the AI: no layout, so its headings cannot match.
    saveProfile(aiProfile());
    addProvider();
    const model = serve([
      { text: JSON.stringify({ profile: String(second) }) },
    ]);
    // Past the receipt reading's 6,000 characters, and quick to read.
    const counts = {
      orderIn: 120,
      orderOut: 2,
      adjustIn: 2,
      adjustOut: 1,
      withdrawals: 2,
      processing: 1,
    };
    const row = await run(auto(walletWorkbook(counts).xlsx));

    expect(model.doGenerateCalls).toHaveLength(1);
    const asked = JSON.stringify(model.doGenerateCalls[0].prompt);
    expect(asked).toContain("Wallet report, withdrawals only");
    expect(asked).not.toContain("Statement read by the AI");
    expect(row).toMatchObject({
      state: ImportState.Grouped,
      profileId: String(second),
    });
    expect(itemsOf(row.id)).toHaveLength(128);
  });

  it("refuses a long spreadsheet with no AI call when nothing but the standard reading could read it (FR-052)", async () => {
    // A profile read from columns whose headings are not in the file could
    // not read it, so detection has nothing to ask the AI about.
    saveProfile(otherLayoutProfile());
    addProvider();
    const model = serve([{ text: JSON.stringify({ profile: "none" }) }]);
    const row = await run(auto(walletWorkbook().xlsx));
    expect(model.doGenerateCalls).toHaveLength(0);
    expect(row.state).toBe(ImportState.Failed);
    expect(row.error).toMatch(
      /^This spreadsheet is too long to be read as a receipt or invoice/,
    );
  });

  it("refuses a long spreadsheet after the AI finds no profile fits (FR-052)", async () => {
    saveProfile(aiProfile());
    addProvider();
    const model = serve([{ text: JSON.stringify({ profile: "none" }) }]);
    const row = await run(auto(walletWorkbook().xlsx));
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(row.state).toBe(ImportState.Failed);
    expect(row.error).toMatch(
      /^This spreadsheet is too long to be read as a receipt or invoice/,
    );
  });
});
