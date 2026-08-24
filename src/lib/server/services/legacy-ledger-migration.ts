import type { Database } from "bun:sqlite";
import { AccountRole, LedgerRecordKind } from "$lib/enums.js";
import { joinSearchText } from "../search-text.js";

export type LegacyConversionSummary = {
  expenses: number;
  incomes: number;
  claims: number;
  attachments: number;
  incompleteImports: number;
  balancedRecords: number;
  expenseTotalMinor: number;
  incomeTotalMinor: number;
};

type LegacyAccountIds = {
  bank: number;
  payable: number;
  receivable: number;
  opening: number;
  uncategorised: number;
  expenseByName: Map<string, number>;
  incomeByName: Map<string, number>;
};

function exists(db: Database, table: string): boolean {
  return Boolean(
    db
      .query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table),
  );
}

function count(db: Database, table: string): number {
  if (!exists(db, table)) return 0;
  return Number(
    (db.query(`SELECT count(*) AS n FROM "${table}"`).get() as { n: number }).n,
  );
}

function ensureAccount(
  db: Database,
  role: number,
  name: string,
  rank: string,
  system = false,
): number {
  const found = db
    .query("SELECT id FROM accounts WHERE role = ? AND name = ?")
    .get(role, name) as { id: number } | null;
  if (found) return found.id;
  return Number(
    (
      db
        .query(
          "INSERT INTO accounts(role, name, rank, is_system) VALUES (?, ?, ?, ?) RETURNING id",
        )
        .get(role, name, rank, system ? 1 : 0) as { id: number }
    ).id,
  );
}

function seedLegacyAccounts(db: Database): LegacyAccountIds {
  const bank = ensureAccount(db, AccountRole.Bank, "Bank Account", "000", true);
  const receivable = ensureAccount(
    db,
    AccountRole.Receivable,
    "Money owed to us",
    "001",
    true,
  );
  const payable = ensureAccount(
    db,
    AccountRole.Payable,
    "Money we owe",
    "002",
    true,
  );
  const opening = ensureAccount(
    db,
    AccountRole.OpeningBalances,
    "Opening balances",
    "003",
    true,
  );
  const uncategorised = ensureAccount(
    db,
    AccountRole.ExpenseCategory,
    "Uncategorised",
    "004",
    true,
  );
  const expenseByName = new Map<string, number>();
  const incomeByName = new Map<string, number>();
  const categories = exists(db, "categories")
    ? (db
        .query(
          "SELECT type, name, rank FROM categories ORDER BY type, rank, id",
        )
        .all() as { type: number; name: string; rank: string }[])
    : [];
  for (const category of categories) {
    const expense = category.type === 0;
    const id = ensureAccount(
      db,
      expense ? AccountRole.ExpenseCategory : AccountRole.IncomeCategory,
      category.name,
      category.rank,
    );
    (expense ? expenseByName : incomeByName).set(category.name, id);
  }
  return {
    bank,
    payable,
    receivable,
    opening,
    uncategorised,
    expenseByName,
    incomeByName,
  };
}

function minor(amount: number, rate: number): number {
  return Math.round(amount * rate * 100);
}

function insertRecord(
  db: Database,
  row: {
    id?: number;
    kind: number;
    legacyKind: string;
    legacyId: number;
    date: string;
    number: string;
    description: string;
    contactId: number | null;
    reference: string;
    remark: string;
    currency: string;
    exchangeRate: number;
    amount: number;
    extractedText: string | null;
    createdBy: number | null;
  },
): number {
  const prior = db
    .query(
      "SELECT id FROM ledger_records WHERE legacy_kind = ? AND legacy_id = ?",
    )
    .get(row.legacyKind, row.legacyId) as { id: number } | null;
  if (prior) return prior.id;
  const result = db
    .query(
      "INSERT INTO ledger_records(id, kind, date, record_number, description, contact_id, reference, remark, currency, exchange_rate, amount, extracted_text, legacy_kind, legacy_id, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .get(
      row.id ?? null,
      row.kind,
      row.date,
      row.number,
      row.description,
      row.contactId,
      row.reference,
      row.remark,
      row.currency,
      row.exchangeRate,
      row.amount,
      row.extractedText,
      row.legacyKind,
      row.legacyId,
      row.createdBy,
      row.createdBy,
    ) as { id: number };
  return result.id;
}

function movement(
  db: Database,
  recordId: number,
  accountId: number,
  amountMinor: number,
  sortOrder: number,
): number {
  return Number(
    (
      db
        .query(
          "INSERT INTO ledger_movements(record_id, account_id, amount_minor, sort_order) VALUES (?, ?, ?, ?) RETURNING id",
        )
        .get(recordId, accountId, amountMinor, sortOrder) as { id: number }
    ).id,
  );
}

/**
 * Rebuilds `record_search_text` for every migrated record — the migration's own
 * equivalent of `reindexRecord` (`queries/ledger.ts`), which cannot be called
 * directly here because it needs the drizzle-wrapped `LedgerDb`, not the raw
 * `bun:sqlite` handle this whole conversion runs against. Without this, a migrated
 * record has no search-text row at all: nothing else in this file ever inserts one,
 * and migration 0015 drops the legacy `expense_search_text`/`income_search_text`
 * tables it used to live in.
 */
function indexLegacyRecords(db: Database): void {
  const records = db
    .query(
      "SELECT id, record_number, description, reference, remark, contact_id, extracted_text FROM ledger_records WHERE legacy_kind IN ('expense', 'income', 'claim')",
    )
    .all() as {
    id: number;
    record_number: string | null;
    description: string;
    reference: string;
    remark: string;
    contact_id: number | null;
    extracted_text: string | null;
  }[];
  for (const record of records) {
    const contactName = record.contact_id
      ? ((
          db
            .query("SELECT legal_name AS name FROM contacts WHERE id = ?")
            .get(record.contact_id) as { name: string } | null
        )?.name ?? null)
      : null;
    const accountNames = (
      db
        .query(
          "SELECT accounts.name AS name FROM ledger_movements JOIN accounts ON accounts.id = ledger_movements.account_id WHERE ledger_movements.record_id = ?",
        )
        .all(record.id) as { name: string }[]
    ).map((r) => r.name);
    const text = joinSearchText(
      record.record_number,
      record.description,
      contactName,
      record.reference,
      record.remark,
      ...accountNames,
      record.extracted_text,
    );
    db.query(
      "INSERT INTO record_search_text(record_id, text) VALUES (?, ?) ON CONFLICT(record_id) DO UPDATE SET text = excluded.text",
    ).run(record.id, text);
  }
}

export function convertLegacyLedger(db: Database): LegacyConversionSummary {
  if (!exists(db, "expenses") || !exists(db, "ledger_records")) {
    throw new Error(
      "Legacy conversion requires preserved legacy tables and the migration-0014 ledger schema.",
    );
  }
  const alreadyDone = db
    .query("SELECT value FROM settings WHERE key = 'ledger_upgrade_state'")
    .get() as { value: string } | null;
  if (alreadyDone) {
    try {
      if (
        (JSON.parse(alreadyDone.value) as { phase?: string }).phase === "done"
      ) {
        return snapshotLegacyConversion(db);
      }
    } catch {
      // An invalid marker is not completion.
    }
  }

  const accounts = seedLegacyAccounts(db);
  const expenseRows = db
    .query("SELECT * FROM expenses ORDER BY id")
    .all() as any[];
  const incomeRows = db
    .query("SELECT * FROM incomes ORDER BY id")
    .all() as any[];
  const claimRows = db.query("SELECT * FROM claims ORDER BY id").all() as any[];
  const claimContact = new Map<number, number | null>();
  for (const claim of claimRows) {
    const user = claim.created_by
      ? (db
          .query("SELECT email, username, name FROM users WHERE id = ?")
          .get(claim.created_by) as {
          email: string;
          username: string;
          name: string | null;
        } | null)
      : null;
    if (!user) {
      claimContact.set(claim.id, null);
      continue;
    }
    const displayName = user.name?.trim() || user.username;
    let contact = db
      .query(
        "SELECT id FROM contacts WHERE (email IS NOT NULL AND lower(email) = lower(?)) OR lower(legal_name) = lower(?) ORDER BY id LIMIT 1",
      )
      .get(user.email, displayName) as { id: number } | null;
    if (!contact) {
      contact = db
        .query(
          "INSERT INTO contacts(entity_type, legal_name, email) VALUES (1, ?, ?) RETURNING id",
        )
        .get(displayName, user.email) as { id: number };
      db.query(
        "INSERT OR IGNORE INTO contact_roles(contact_id, role) VALUES (?, 3)",
      ).run(contact.id);
    }
    claimContact.set(claim.id, contact.id);
  }
  let nextId =
    Math.max(
      ...expenseRows.map((row) => Number(row.id)),
      Number(
        (
          db
            .query("SELECT coalesce(max(id), 0) AS id FROM ledger_records")
            .get() as {
            id: number;
          }
        ).id,
      ),
    ) + 1;
  const payableMovementByExpense = new Map<number, number>();

  for (const row of expenseRows) {
    const amountMinor = minor(row.amount, row.exchange_rate);
    const category =
      accounts.expenseByName.get(row.category) ?? accounts.uncategorised;
    const owed =
      row.claim_id !== null || (row.status !== 3 && row.contact_id !== null);
    const contactId =
      row.claim_id !== null
        ? (claimContact.get(row.claim_id) ?? row.contact_id)
        : row.contact_id;
    const recordId = insertRecord(db, {
      id: row.id,
      kind: LedgerRecordKind.Expense,
      legacyKind: "expense",
      legacyId: row.id,
      date: row.date,
      number: row.expense_number,
      description: row.item_name,
      contactId,
      reference: row.reference,
      remark: row.remark,
      currency: row.currency,
      exchangeRate: row.exchange_rate,
      amount: row.amount,
      extractedText: row.extracted_text ?? null,
      createdBy: row.created_by,
    });
    if (
      Number(
        (
          db
            .query(
              "SELECT count(*) AS n FROM ledger_movements WHERE record_id = ?",
            )
            .get(recordId) as { n: number }
        ).n,
      ) === 0
    ) {
      movement(db, recordId, category, amountMinor, 0);
      const other = movement(
        db,
        recordId,
        owed ? accounts.payable : accounts.bank,
        -amountMinor,
        1,
      );
      if (owed) payableMovementByExpense.set(row.id, other);
    }
  }

  for (const row of incomeRows) {
    const amountMinor = minor(row.amount, row.exchange_rate);
    const category =
      accounts.incomeByName.get(row.category) ??
      ensureAccount(
        db,
        AccountRole.IncomeCategory,
        row.category || "Other",
        `income-${row.id}`,
      );
    const recordId = insertRecord(db, {
      id: nextId,
      kind: LedgerRecordKind.Income,
      legacyKind: "income",
      legacyId: row.id,
      date: row.date,
      number: row.income_number,
      description: row.description_text,
      contactId: row.contact_id,
      reference: row.reference,
      remark: row.remark,
      currency: row.currency,
      exchangeRate: row.exchange_rate,
      amount: row.amount,
      extractedText: row.extracted_text ?? null,
      createdBy: row.created_by,
    });
    if (
      !db
        .query("SELECT 1 FROM ledger_movements WHERE record_id = ?")
        .get(recordId)
    ) {
      movement(db, recordId, accounts.bank, amountMinor, 0);
      movement(db, recordId, category, -amountMinor, 1);
    }
    nextId = Math.max(nextId, recordId + 1);
  }

  for (const claim of claimRows) {
    if (claim.status !== 2) continue;
    const covered = expenseRows.filter(
      (expense) => expense.claim_id === claim.id,
    );
    const total = covered.reduce(
      (sum, expense) => sum + minor(expense.amount, expense.exchange_rate),
      0,
    );
    if (total === 0) continue;
    const recordId = insertRecord(db, {
      id: nextId,
      kind: LedgerRecordKind.Payment,
      legacyKind: "claim",
      legacyId: claim.id,
      date: claim.date,
      number: claim.claim_number,
      description: `Reimbursement ${claim.claim_number}`,
      contactId: claimContact.get(claim.id) ?? null,
      reference: "",
      remark: "",
      currency: "MYR",
      exchangeRate: 1,
      amount: total / 100,
      extractedText: null,
      createdBy: claim.created_by,
    });
    if (
      !db
        .query("SELECT 1 FROM ledger_movements WHERE record_id = ?")
        .get(recordId)
    ) {
      const payment = movement(db, recordId, accounts.payable, total, 0);
      movement(db, recordId, accounts.bank, -total, 1);
      for (const expense of covered) {
        const owed = payableMovementByExpense.get(expense.id);
        if (!owed) continue;
        db.query(
          "INSERT OR IGNORE INTO settlements(payment_movement_id, owed_movement_id, amount_minor, created_by) VALUES (?, ?, ?, ?)",
        ).run(
          payment,
          owed,
          Math.abs(minor(expense.amount, expense.exchange_rate)),
          claim.created_by,
        );
      }
    }
    nextId = Math.max(nextId, recordId + 1);
  }

  for (const [table, owner, kind] of [
    ["expense_attachments", "expense_id", "expense"],
    ["income_attachments", "income_id", "income"],
    ["claim_attachments", "claim_id", "claim"],
  ] as const) {
    if (!exists(db, table)) continue;
    const rows = db
      .query(`SELECT * FROM "${table}" ORDER BY id`)
      .all() as any[];
    for (const row of rows) {
      const record = db
        .query(
          "SELECT id FROM ledger_records WHERE legacy_kind = ? AND legacy_id = ?",
        )
        .get(kind, row[owner]) as { id: number } | null;
      const destination =
        record ??
        (kind === "claim"
          ? (db
              .query(
                "SELECT ledger_records.id FROM expenses JOIN ledger_records ON ledger_records.legacy_kind = 'expense' AND ledger_records.legacy_id = expenses.id WHERE expenses.claim_id = ? ORDER BY expenses.id LIMIT 1",
              )
              .get(row[owner]) as { id: number } | null)
          : null);
      if (!destination) continue;
      db.query(
        "INSERT INTO record_attachments(record_id, filename, display_name, added_date, legacy_filename) SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM record_attachments WHERE legacy_filename = ?)",
      ).run(
        destination.id,
        row.filename,
        row.display_name,
        row.added_date,
        row.filename,
        row.filename,
      );
    }
  }

  indexLegacyRecords(db);

  const unbalanced = Number(
    (
      db
        .query(
          "SELECT count(*) AS n FROM (SELECT record_id FROM ledger_movements GROUP BY record_id HAVING count(*) < 2 OR sum(amount_minor) <> 0)",
        )
        .get() as { n: number }
    ).n,
  );
  if (unbalanced !== 0)
    throw new Error("Legacy ledger conversion is unbalanced.");
  const owedWithoutContact = Number(
    (
      db
        .query(
          "SELECT count(DISTINCT ledger_records.id) AS n FROM ledger_records JOIN ledger_movements ON ledger_movements.record_id = ledger_records.id JOIN accounts ON accounts.id = ledger_movements.account_id WHERE accounts.role IN (6, 7) AND ledger_records.contact_id IS NULL",
        )
        .get() as { n: number }
    ).n,
  );
  if (owedWithoutContact !== 0) {
    throw new Error(
      "Legacy ledger conversion left owed movements without a contact.",
    );
  }
  const summary = snapshotLegacyConversion(db);
  const expenseReportTotal = Number(
    (
      db
        .query(
          "SELECT coalesce(sum(ledger_movements.amount_minor), 0) AS n FROM ledger_movements JOIN accounts ON accounts.id = ledger_movements.account_id WHERE accounts.role = 11",
        )
        .get() as { n: number }
    ).n,
  );
  const incomeReportTotal = -Number(
    (
      db
        .query(
          "SELECT coalesce(sum(ledger_movements.amount_minor), 0) AS n FROM ledger_movements JOIN accounts ON accounts.id = ledger_movements.account_id WHERE accounts.role = 12",
        )
        .get() as { n: number }
    ).n,
  );
  if (
    expenseReportTotal !== summary.expenseTotalMinor ||
    incomeReportTotal !== summary.incomeTotalMinor
  ) {
    throw new Error(
      "Legacy ledger conversion changed expense or income report totals.",
    );
  }
  db.query(
    "INSERT INTO settings(key, value) VALUES ('ledger_upgrade_state', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ phase: "done", summary }));
  return summary;
}

function snapshotLegacyConversion(db: Database): LegacyConversionSummary {
  const balancedRecords = Number(
    (
      db
        .query(
          "SELECT count(*) AS n FROM (SELECT record_id FROM ledger_movements GROUP BY record_id HAVING count(*) >= 2 AND sum(amount_minor) = 0)",
        )
        .get() as { n: number }
    ).n,
  );
  const incompleteImports = exists(db, "import_queue")
    ? Number(
        (
          db
            .query(
              // Failed extraction is still incomplete and must remain available
              // for retry/review. Only confirmed and deliberately skipped jobs
              // are complete.
              "SELECT count(*) AS n FROM import_queue WHERE state NOT IN (6, 8)",
            )
            .get() as { n: number }
        ).n,
      )
    : 0;
  return {
    expenses: count(db, "expenses"),
    incomes: count(db, "incomes"),
    claims: count(db, "claims"),
    attachments:
      count(db, "expense_attachments") + count(db, "income_attachments"),
    incompleteImports,
    balancedRecords,
    expenseTotalMinor: exists(db, "expenses")
      ? (
          db.query("SELECT amount, exchange_rate FROM expenses").all() as {
            amount: number;
            exchange_rate: number;
          }[]
        ).reduce((sum, row) => sum + minor(row.amount, row.exchange_rate), 0)
      : 0,
    incomeTotalMinor: exists(db, "incomes")
      ? (
          db.query("SELECT amount, exchange_rate FROM incomes").all() as {
            amount: number;
            exchange_rate: number;
          }[]
        ).reduce((sum, row) => sum + minor(row.amount, row.exchange_rate), 0)
      : 0,
  };
}
