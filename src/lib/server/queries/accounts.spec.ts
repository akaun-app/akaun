import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AccountSubType,
  AccountType,
  EntityType,
  LedgerRecordKind,
} from "$lib/enums.js";
import * as schema from "../db/schema.js";
import { contacts, ledgerMovements, ledgerRecords, users } from "../db/schema.js";
import { createAccount } from "../services/accounts.js";
import { listAccounts, lastPaymentAccountForContact } from "./accounts.js";

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
    const parent=createAccount(db,1,{name:"Cash",type:AccountType.Asset,subType:AccountSubType.Cash}); expect(parent.ok).toBe(true); if(!parent.ok)return;
    const first=createAccount(db,1,{name:"Till",type:AccountType.Asset,subType:AccountSubType.Cash,parentId:parent.value.id}); const second=createAccount(db,1,{name:"Safe",type:AccountType.Asset,subType:AccountSubType.Cash,parentId:parent.value.id}); if(!first.ok||!second.ok)return;
    const record=db.insert(ledgerRecords).values({kind:LedgerRecordKind.Journal,date:"2026-01-01",description:"test",amount:0,createdBy:1,updatedBy:1}).returning().get();
    db.insert(ledgerMovements).values([{recordId:record.id,accountId:first.value.id,amountMinor:250,sortOrder:0},{recordId:record.id,accountId:second.value.id,amountMinor:-50,sortOrder:1}]).run();
    const rows=listAccounts(db); expect(rows.find((a)=>a.id===parent.value.id)?.directBalanceMinor).toBe(0); expect(rows.find((a)=>a.id===parent.value.id)?.rolledUpBalanceMinor).toBe(200);
  });
});

describe("lastPaymentAccountForContact",()=>{
  function makeContact(){
    return db.insert(contacts).values({entityType:EntityType.Business,legalName:"Vendor"}).returning().get().id;
  }
  function record(kind:number,date:string,contactId:number,sides:{accountId:number,amountMinor:number}[]){
    const rec=db.insert(ledgerRecords).values({kind,date,description:"test",amount:0,contactId,createdBy:1,updatedBy:1}).returning().get();
    db.insert(ledgerMovements).values(sides.map((s,i)=>({recordId:rec.id,accountId:s.accountId,amountMinor:s.amountMinor,sortOrder:i}))).run();
    return rec.id;
  }

  it("NoHistory_ShouldReturnNull",()=>{
    const contactId=makeContact();
    expect(lastPaymentAccountForContact(db,contactId,LedgerRecordKind.Expense)).toBeNull();
  });

  it("Expense_WhenPaidFromABankAccount_ShouldReturnThatAccount",()=>{
    const contactId=makeContact();
    const category=createAccount(db,1,{name:"Fuel",type:AccountType.Expense}); const bank=createAccount(db,1,{name:"Bank",type:AccountType.Asset,subType:AccountSubType.Bank});
    if(!category.ok||!bank.ok)return;
    record(LedgerRecordKind.Expense,"2026-01-01",contactId,[{accountId:category.value.id,amountMinor:1000},{accountId:bank.value.id,amountMinor:-1000}]);
    expect(lastPaymentAccountForContact(db,contactId,LedgerRecordKind.Expense)).toBe(bank.value.id);
  });

  it("Expense_WhenRecordedAsOwed_ShouldReturnThePayableAccount",()=>{
    const contactId=makeContact();
    const category=createAccount(db,1,{name:"Fuel",type:AccountType.Expense}); const payable=createAccount(db,1,{name:"Accounts Payable",type:AccountType.Liability,subType:AccountSubType.AccountsPayable});
    if(!category.ok||!payable.ok)return;
    record(LedgerRecordKind.Expense,"2026-01-01",contactId,[{accountId:category.value.id,amountMinor:500},{accountId:payable.value.id,amountMinor:-500}]);
    expect(lastPaymentAccountForContact(db,contactId,LedgerRecordKind.Expense)).toBe(payable.value.id);
  });

  it("Income_WhenReceivedIntoAWallet_ShouldReturnThatAccount",()=>{
    const contactId=makeContact();
    const category=createAccount(db,1,{name:"Sales",type:AccountType.Revenue}); const wallet=createAccount(db,1,{name:"Wallet",type:AccountType.Asset,subType:AccountSubType.Wallet});
    if(!category.ok||!wallet.ok)return;
    record(LedgerRecordKind.Income,"2026-01-01",contactId,[{accountId:wallet.value.id,amountMinor:700},{accountId:category.value.id,amountMinor:-700}]);
    expect(lastPaymentAccountForContact(db,contactId,LedgerRecordKind.Income)).toBe(wallet.value.id);
  });

  it("KindMismatch_WhenContactOnlyHasTheOtherKind_ShouldReturnNull",()=>{
    const contactId=makeContact();
    const category=createAccount(db,1,{name:"Sales",type:AccountType.Revenue}); const wallet=createAccount(db,1,{name:"Wallet",type:AccountType.Asset,subType:AccountSubType.Wallet});
    if(!category.ok||!wallet.ok)return;
    record(LedgerRecordKind.Income,"2026-01-01",contactId,[{accountId:wallet.value.id,amountMinor:700},{accountId:category.value.id,amountMinor:-700}]);
    expect(lastPaymentAccountForContact(db,contactId,LedgerRecordKind.Expense)).toBeNull();
  });

  it("MultipleRecords_ShouldPreferTheMostRecentByDate",()=>{
    const contactId=makeContact();
    const category=createAccount(db,1,{name:"Fuel",type:AccountType.Expense}); const bank=createAccount(db,1,{name:"Bank",type:AccountType.Asset,subType:AccountSubType.Bank}); const card=createAccount(db,1,{name:"Card",type:AccountType.Asset,subType:AccountSubType.Card});
    if(!category.ok||!bank.ok||!card.ok)return;
    record(LedgerRecordKind.Expense,"2026-01-01",contactId,[{accountId:category.value.id,amountMinor:1000},{accountId:bank.value.id,amountMinor:-1000}]);
    record(LedgerRecordKind.Expense,"2026-02-01",contactId,[{accountId:category.value.id,amountMinor:1000},{accountId:card.value.id,amountMinor:-1000}]);
    expect(lastPaymentAccountForContact(db,contactId,LedgerRecordKind.Expense)).toBe(card.value.id);
  });
});
