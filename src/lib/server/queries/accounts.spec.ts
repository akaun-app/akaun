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

describe("account queries",()=>{
  it("Search_WhenNameMatches_ShouldIncludeIt",()=>{
    const account=createAccount(db,1,{name:"Fuel",type:AccountType.Expense}); expect(account.ok).toBe(true); if(!account.ok)return;
    expect(listAccounts(db,{search:"fuel"})[0].name).toBe("Fuel");
  });
  it("Balance_ShouldSumItsOwnMovementsOnly",()=>{
    const account=createAccount(db,1,{name:"Cash",type:AccountType.Asset,subType:AccountSubType.Cash}); expect(account.ok).toBe(true); if(!account.ok)return;
    const record=db.insert(ledgerRecords).values({kind:LedgerRecordKind.Journal,date:"2026-01-01",description:"test",amount:0,createdBy:1,updatedBy:1}).returning().get();
    db.insert(ledgerMovements).values([{recordId:record.id,accountId:account.value.id,amountMinor:250,sortOrder:0}]).run();
    expect(listAccounts(db).find((a)=>a.id===account.value.id)?.balanceMinor).toBe(250);
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
