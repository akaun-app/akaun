import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { eq } from "drizzle-orm";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountType, ImportState } from "$lib/enums.js";
import type { ImportProfileDraft } from "$lib/import-profile-schema.js";
import { starterDraft } from "$lib/import-profile-starters.js";

/**
 * Saving import profiles (006 US6, FR-030, FR-035, FR-038).
 *
 * The database is an in-memory copy migrated from `drizzle/`. The configured
 * paths are mocked to a folder under `os.tmpdir()`, so nothing here can reach
 * `data/`. Nothing in the database layer is mocked.
 */

const sandbox = mkdtempSync(join(tmpdir(), "akaun-import-profiles-spec-"));

vi.mock("$lib/server/env.js", () => ({
  get STORAGE_PATH() {
    return join(sandbox, "storage");
  },
  DATABASE_PATH: "/dev/null",
  OCR_CACHE_PATH: "/dev/null",
}));

const schema = await import("../db/schema.js");
const { auditLog, importProfiles, importQueue, users } = schema;
const { createAccount, patchAccount } = await import("./accounts.js");
const {
  createImportProfile,
  deleteImportProfile,
  getImportProfile,
  listImportProfiles,
  savedProfileIdOf,
  setImportProfileEnabled,
  updateImportProfile,
} = await import("./import-profiles.js");
const { getAuditTrail } = await import("../audit.js");
type LedgerDb = import("../ledger/types.js").LedgerDb;

const userId = 1;

let db: LedgerDb;
let feesCategoryId: number;
let salesCategoryId: number;

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

beforeEach(() => {
  const sqlite = new Database(":memory:");
  db = drizzle(sqlite, { schema }) as unknown as LedgerDb;
  migrate(db as never, { migrationsFolder: "drizzle" });
  db.insert(users)
    .values({ email: "u@test", username: "u", passwordHash: "x" })
    .run();
  feesCategoryId = category("Marketplace Fees", AccountType.Expense);
  salesCategoryId = category("Online Sales", AccountType.Revenue);
});

function category(name: string, type: number): number {
  const result = createAccount(db, userId, {
    name,
    type: type as never,
  });
  if (!result.ok) throw new Error(result.reason);
  return result.value.id;
}

function feeDocument(): ImportProfileDraft {
  const draft = starterDraft("fee_document")!;
  draft.sections[0].feeTypes[0].categoryAccountId = feesCategoryId;
  return draft;
}

function rowCount(): number {
  return db.select().from(importProfiles).all().length;
}

function auditCount(): number {
  return db
    .select()
    .from(auditLog)
    .where(eq(auditLog.recordType, "import_profile"))
    .all().length;
}

function create(draft: unknown = feeDocument()) {
  const result = createImportProfile(db, userId, draft);
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}

describe("createImportProfile", () => {
  it("saves the cleaned profile, enabled, and audits it", () => {
    const draft = feeDocument();
    draft.name = "  Ads invoice ";
    const saved = create(draft);

    expect(saved).toMatchObject({
      ...draft,
      name: "Ads invoice",
      enabled: true,
    });
    expect(getImportProfile(db, saved.id)).toEqual(saved);
    expect(getAuditTrail(db, "import_profile", saved.id)).toMatchObject([
      { action: "create", changes: null, userId },
    ]);
  });

  it("saves both starters as they are", () => {
    for (const id of ["fee_document", "marketplace_summary"]) {
      const draft = starterDraft(id)!;
      expect(create(draft)).toMatchObject(draft);
    }
    expect(listImportProfiles(db).map((p) => p.name)).toEqual([
      "Fee document",
      "Marketplace statement summary",
    ]);
  });

  it("refuses a profile that breaks a rule, and saves nothing", () => {
    const draft = feeDocument() as unknown as {
      sections: Record<string, unknown>[];
    };
    draft.sections[0].extras = {
      type: "object",
      properties: { amount: { type: "number" } },
    };

    const result = createImportProfile(db, userId, draft);

    expect(result).toMatchObject({
      ok: false,
      errors: [{ path: "sections[0].extras.properties.amount" }],
    });
    expect(!result.ok && result.reason).toMatch(
      /^sections\[0\]\.extras\.properties\.amount: "amount" is a name/,
    );
    expect(rowCount()).toBe(0);
    expect(auditCount()).toBe(0);
  });

  it("refuses a category of the wrong kind, an archived one and a missing one", () => {
    const archived = category("Old Fees", AccountType.Expense);
    const patched = patchAccount(db, archived, userId, { active: false });
    if (!patched.ok) throw new Error(patched.reason);

    const draft = feeDocument();
    draft.sections[0].fixedCategoryAccountId = salesCategoryId;
    draft.sections[0].feeTypes[1].categoryAccountId = archived;
    draft.sections[0].feeTypes[2].categoryAccountId = 999;

    const result = createImportProfile(db, userId, draft);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((e) => e.path)).toEqual([
      "sections[0].fixedCategoryAccountId",
      "sections[0].feeTypes[1].categoryAccountId",
      "sections[0].feeTypes[2].categoryAccountId",
    ]);
    expect(result.errors[0].message).toMatch(/not an expense category/);
    expect(rowCount()).toBe(0);
  });

  it("lets a By sign section pin an income or an expense category", () => {
    const draft = starterDraft("marketplace_summary")!;
    draft.sections[0].fixedCategoryAccountId = salesCategoryId;
    draft.sections[1].feeTypes[0].categoryAccountId = salesCategoryId;
    draft.sections[1].feeTypes[1].categoryAccountId = feesCategoryId;
    expect(createImportProfile(db, userId, draft).ok).toBe(true);

    const wrong = starterDraft("marketplace_summary")!;
    wrong.name = "Another";
    wrong.sections[0].fixedCategoryAccountId = feesCategoryId;
    expect(createImportProfile(db, userId, wrong)).toMatchObject({
      ok: false,
      errors: [{ path: "sections[0].fixedCategoryAccountId" }],
    });
  });

  it("refuses a name another profile has, ignoring case", () => {
    create();
    const draft = feeDocument();
    draft.name = "FEE DOCUMENT";
    expect(createImportProfile(db, userId, draft)).toMatchObject({
      ok: false,
      errors: [{ path: "name" }],
    });
    expect(rowCount()).toBe(1);
  });
});

describe("updateImportProfile", () => {
  it("replaces the form and audits each changed field", () => {
    const saved = create();
    const draft = feeDocument();
    draft.instructions = "- Read the fees only.";
    draft.sections[0].feeTypes.pop();

    const result = updateImportProfile(db, userId, saved.id, draft);

    expect(result.ok).toBe(true);
    const after = getImportProfile(db, saved.id)!;
    expect(after.instructions).toBe("- Read the fees only.");
    expect(after.sections[0].feeTypes).toHaveLength(4);
    const [entry] = getAuditTrail(db, "import_profile", saved.id);
    expect(entry.action).toBe("update");
    expect(entry.changes?.map((c) => c.field)).toEqual([
      "instructions",
      "sections",
    ]);
  });

  it("keeps its own name, and audits nothing when nothing changed", () => {
    const saved = create();
    expect(updateImportProfile(db, userId, saved.id, feeDocument()).ok).toBe(
      true,
    );
    expect(auditCount()).toBe(1);
    expect(getImportProfile(db, saved.id)!.updatedAt).toBe(saved.updatedAt);
  });

  it("refuses a broken profile and leaves the saved one as it was", () => {
    const saved = create();
    const draft = feeDocument();
    draft.sections[0].key = "Fees!";

    const result = updateImportProfile(db, userId, saved.id, draft);

    expect(result).toMatchObject({
      ok: false,
      errors: [{ path: "sections[0].key" }],
    });
    expect(getImportProfile(db, saved.id)).toEqual(saved);
    expect(auditCount()).toBe(1);
  });

  it("refuses a profile that no longer exists", () => {
    expect(updateImportProfile(db, userId, 42, feeDocument())).toMatchObject({
      ok: false,
      missing: true,
    });
    expect(rowCount()).toBe(0);
  });
});

describe("setImportProfileEnabled", () => {
  it("hides a disabled profile from the enabled list, and audits it", () => {
    const fees = create();
    const marketplace = create(starterDraft("marketplace_summary")!);

    const result = setImportProfileEnabled(db, userId, fees.id, false);

    expect(result.ok && result.value.enabled).toBe(false);
    expect(
      listImportProfiles(db, { enabledOnly: true }).map((p) => p.id),
    ).toEqual([marketplace.id]);
    expect(listImportProfiles(db)).toHaveLength(2);
    expect(getAuditTrail(db, "import_profile", fees.id)[0]).toMatchObject({
      action: "update",
      changes: [{ field: "enabled", before: true, after: false }],
    });
  });

  it("changes and audits nothing when it is already so", () => {
    const fees = create();
    expect(setImportProfileEnabled(db, userId, fees.id, true).ok).toBe(true);
    expect(auditCount()).toBe(1);
  });
});

describe("deleteImportProfile", () => {
  it("removes the profile and keeps what it was in the audit trail", () => {
    const saved = create();

    expect(deleteImportProfile(db, userId, saved.id)).toEqual({
      ok: true,
      value: null,
    });

    expect(getImportProfile(db, saved.id)).toBeNull();
    const [entry] = getAuditTrail(db, "import_profile", saved.id);
    expect(entry.action).toBe("delete");
    expect(entry.changes).toContainEqual({
      field: "name",
      before: "Fee document",
      after: null,
    });
    expect(deleteImportProfile(db, userId, saved.id)).toMatchObject({
      ok: false,
      missing: true,
    });
  });

  it("leaves a document already read with it as it was (FR-038)", () => {
    const saved = create();
    const snapshot = JSON.stringify({ name: saved.name, id: saved.id });
    db.insert(importQueue)
      .values({
        id: "job-1",
        createdBy: userId,
        state: ImportState.Grouped,
        tempFilePath: "import/temp/job-1.pdf",
        originalFilename: "fees.pdf",
        readAs: "profile",
        profileId: String(saved.id),
        profileSnapshot: snapshot,
      })
      .run();

    expect(setImportProfileEnabled(db, userId, saved.id, false).ok).toBe(true);
    expect(deleteImportProfile(db, userId, saved.id).ok).toBe(true);

    expect(
      db
        .select({
          profileId: importQueue.profileId,
          profileSnapshot: importQueue.profileSnapshot,
          state: importQueue.state,
        })
        .from(importQueue)
        .get(),
    ).toEqual({
      profileId: String(saved.id),
      profileSnapshot: snapshot,
      state: ImportState.Grouped,
    });
  });

  it("never gives a deleted profile's id to a new one", () => {
    const first = create();
    deleteImportProfile(db, userId, first.id);
    expect(create().id).toBeGreaterThan(first.id);
  });
});

describe("savedProfileIdOf", () => {
  it("names a saved profile only for a row read as one", () => {
    expect(savedProfileIdOf({ readAs: "profile", profileId: "12" })).toBe(12);
    // The built-in several-items reading stores its schema id (006 S1).
    expect(
      savedProfileIdOf({ readAs: "items", profileId: "builtin:items@1" }),
    ).toBeNull();
    expect(
      savedProfileIdOf({ readAs: "profile", profileId: "builtin:items@1" }),
    ).toBeNull();
    expect(savedProfileIdOf({ readAs: null, profileId: null })).toBeNull();
    expect(savedProfileIdOf({ readAs: "profile", profileId: "012" })).toBe(
      null,
    );
  });
});
