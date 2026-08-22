import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AccountType } from "$lib/enums.js";
import * as schema from "../db/schema.js";
import { accountDefaults, accounts, auditLog, users } from "../db/schema.js";
import { DefaultAccountPurpose } from "$lib/enums.js";
import { getAccount } from "../queries/accounts.js";
import { eq } from "drizzle-orm";
import { createAccount, patchAccount, removeAccount } from "./accounts.js";
import { accountEvents } from "../ledger/events.js";
import type { LedgerDb } from "../ledger/types.js";

let sqlite: Database;
let db: LedgerDb;

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "drizzle" });
  db.insert(users).values({ email: "owner@test", username: "owner", passwordHash: "x" }).run();
});
afterEach(() => sqlite.close());

describe("account service", () => {
  it("Create_WhenNamesRepeat_ShouldAssignDistinctLowestCodes", () => {
    const first = createAccount(db, 1, { name: "Savings", type: AccountType.Asset });
    const second = createAccount(db, 1, { name: "Savings", type: AccountType.Asset });
    expect(first.ok && first.value.code).toBe(1000);
    expect(second.ok && second.value.code).toBe(1001);
  });

  it("Patch_WhenUnusedTypeChanges_ShouldAllocateInNewRange", () => {
    const created = createAccount(db, 1, { name: "Loan", type: AccountType.Asset });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const changed = patchAccount(db, created.value.id, 1, { type: AccountType.Liability });
    expect(changed.ok && changed.value.type).toBe(AccountType.Liability);
    expect(changed.ok && changed.value.code).toBe(2000);
  });

  it("Delete_WhenAccountHasChild_ShouldRefuse", () => {
    const parent = createAccount(db, 1, { name: "Cash", type: AccountType.Asset });
    expect(parent.ok).toBe(true);
    if (!parent.ok) return;
    expect(createAccount(db, 1, { name: "Till", type: AccountType.Asset, parentId: parent.value.id }).ok).toBe(true);
    expect(removeAccount(db, parent.value.id, 1)).toEqual({ ok: false, reason: "Move or delete this account's children first." });
  });

  it("Delete_WhenEventEmits_ShouldHaveCommittedAudit", () => {
    const created = createAccount(db, 1, {
      name: "Temporary",
      type: AccountType.Asset,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    let auditWasVisible = false;
    const onDeleted = ({ id }: { id: number }) => {
      if (id !== created.value.id) return;
      auditWasVisible =
        db
          .select({ action: auditLog.action })
          .from(auditLog)
          .where(eq(auditLog.recordId, id))
          .all()
          .some((row: { action: string }) => row.action === "delete");
    };
    accountEvents.on("account-deleted", onDeleted);
    try {
      expect(removeAccount(db, created.value.id, 1).ok).toBe(true);
    } finally {
      accountEvents.off("account-deleted", onDeleted);
    }

    expect(auditWasVisible).toBe(true);
  });

  it("Archive_WhenSavedDefaultUsesAccount_ShouldRefuse", () => {
    const created=createAccount(db,1,{name:"Bank",type:AccountType.Asset}); expect(created.ok).toBe(true); if(!created.ok)return;
    db.insert(accountDefaults).values({purpose:DefaultAccountPurpose.EverydayTransaction,accountId:created.value.id,updatedBy:1}).run();
    expect(patchAccount(db,created.value.id,1,{active:false})).toEqual({ok:false,reason:"Choose a replacement saved default before deactivating this account."});
  });

  it("CanonicalRead_WhenSourceWasMerged_ShouldResolveSurvivor", () => {
    const survivor=createAccount(db,1,{name:"Sales",type:AccountType.Revenue}); const source=createAccount(db,1,{name:"Old Sales",type:AccountType.Revenue}); if(!survivor.ok||!source.ok)return;
    db.update(accounts).set({mergedIntoAccountId:survivor.value.id,archivedAt:"2026-01-01"}).where(eq(accounts.id,source.value.id)).run();
    expect(getAccount(db,source.value.id)?.id).toBe(survivor.value.id);
  });
});
