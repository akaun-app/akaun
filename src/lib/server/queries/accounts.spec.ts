import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AccountType, LedgerRecordKind } from "$lib/enums.js";
import * as schema from "../db/schema.js";
import { ledgerMovements, ledgerRecords, users } from "../db/schema.js";
import { createAccount } from "../services/accounts.js";
import { listAccounts } from "./accounts.js";

let sqlite: Database; let db: any;
beforeEach(() => { sqlite=new Database(":memory:"); db=drizzle(sqlite,{schema}); migrate(db,{migrationsFolder:"drizzle"}); db.insert(users).values({email:"q@test",username:"q",passwordHash:"x"}).run(); });
afterEach(()=>sqlite.close());

describe("account hierarchy queries",()=>{
  it("Search_WhenChildMatches_ShouldIncludeItsFullAncestorPath",()=>{
    const parent=createAccount(db,1,{name:"Operations",type:AccountType.Expense}); expect(parent.ok).toBe(true); if(!parent.ok)return;
    const child=createAccount(db,1,{name:"Fuel",type:AccountType.Expense,parentId:parent.value.id}); expect(child.ok).toBe(true);
    expect(listAccounts(db,{search:"fuel"})[0].path).toEqual(["Operations","Fuel"]);
  });
  it("Rollup_WhenNested_ShouldCountEachLeafMovementOnce",()=>{
    const parent=createAccount(db,1,{name:"Cash",type:AccountType.Asset}); expect(parent.ok).toBe(true); if(!parent.ok)return;
    const first=createAccount(db,1,{name:"Till",type:AccountType.Asset,parentId:parent.value.id}); const second=createAccount(db,1,{name:"Safe",type:AccountType.Asset,parentId:parent.value.id}); if(!first.ok||!second.ok)return;
    const record=db.insert(ledgerRecords).values({kind:LedgerRecordKind.Journal,date:"2026-01-01",description:"test",amount:0,createdBy:1,updatedBy:1}).returning().get();
    db.insert(ledgerMovements).values([{recordId:record.id,accountId:first.value.id,amountMinor:250,sortOrder:0},{recordId:record.id,accountId:second.value.id,amountMinor:-50,sortOrder:1}]).run();
    const rows=listAccounts(db); expect(rows.find((a)=>a.id===parent.value.id)?.directBalanceMinor).toBe(0); expect(rows.find((a)=>a.id===parent.value.id)?.rolledUpBalanceMinor).toBe(200);
  });
});
