import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AccountSubType, AccountType, LiabilitySubType } from "$lib/enums.js";
import * as schema from "../db/schema.js";
import { users } from "../db/schema.js";
import { createAccount } from "./accounts.js";
import { createStatement, ReconciliationError } from "./reconciliation.js";

let sqlite: Database; let db: any;
const locals = { user: { id: 1 }, isSuperuser: true } as App.Locals;
beforeEach(()=>{sqlite=new Database(":memory:");db=drizzle(sqlite,{schema});migrate(db,{migrationsFolder:"drizzle"});db.insert(users).values({email:"r@test",username:"r",passwordHash:"x"}).run();});
afterEach(()=>sqlite.close());

describe("statement account eligibility",()=>{
  it("Create_WhenLeafIsAnyFixedType_ShouldAcceptIt",()=>{
    for(const type of [AccountType.Asset,AccountType.Liability,AccountType.Equity,AccountType.Revenue,AccountType.Expense]){
      const subType=type===AccountType.Asset?AccountSubType.Bank:type===AccountType.Liability?LiabilitySubType.AccountsPayable:undefined;
      const account=createAccount(db,1,{name:`Type ${type}`,type,subType}); expect(account.ok).toBe(true); if(!account.ok)continue;
      expect(createStatement(db,locals,{originalFilename:`${type}.pdf`,storedFilePath:`${type}.pdf`,accountId:account.value.id}).accountId).toBe(account.value.id);
    }
  });
  it("Create_WhenAccountIsAParent_ShouldRefusePlainly",()=>{
    const parent=createAccount(db,1,{name:"Heading",type:AccountType.Asset,subType:AccountSubType.Bank}); expect(parent.ok).toBe(true); if(!parent.ok)return;
    expect(createAccount(db,1,{name:"Leaf",type:AccountType.Asset,subType:AccountSubType.Bank,parentId:parent.value.id}).ok).toBe(true);
    expect(()=>createStatement(db,locals,{originalFilename:"x.pdf",storedFilePath:"x.pdf",accountId:parent.value.id})).toThrowError(new ReconciliationError("Choose an active account without children for this statement.",409));
  });
});
