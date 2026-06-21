// migrate-from-akaun.ts
// Imports rows from the macOS Akaun (SwiftData/Core Data) SQLite store into the
// current app's DB. Invoked by scripts/migrate-from-akaun.sh, which handles
// prerequisite checks, backups, and attachment file copying — this script only
// touches the database.
//
// Usage: bun run scripts/migrate-from-akaun.ts <path-to-default.store>

import 'dotenv/config';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import * as schema from '../src/lib/server/db/schema.js';
import {
	users,
	claims,
	expenses,
	incomes,
	expenseAttachments,
	incomeAttachments,
	claimAttachments,
	expenseSearchText,
	incomeSearchText,
	appSequences
} from '../src/lib/server/db/schema.js';
import { resolveOrCreateContact } from '../src/lib/server/queries/contacts.js';
import { Role, ExpenseStatus, ClaimStatus } from '../src/lib/enums.js';

// Connects directly to the target SQLite file rather than importing
// db/client.ts, which pulls in SvelteKit's `$env/dynamic/private` — a virtual
// module that only resolves inside Vite, not under a plain `bun run`.
const [sourcePath, targetPath] = process.argv.slice(2);
if (!sourcePath || !targetPath) {
	console.error('Usage: bun run scripts/migrate-from-akaun.ts <path-to-default.store> <path-to-akaun.db>');
	process.exit(1);
}

const src = new Database(sourcePath, { readonly: true });
const raw = new Database(targetPath);
raw.exec('PRAGMA foreign_keys = ON;');
const db = drizzle(raw, { schema });

const actingUser = db.select({ id: users.id }).from(users).limit(1).get();
if (!actingUser) {
	console.error('No user found in target database.');
	process.exit(1);
}
const actingUserId = actingUser.id;

// Core Data stores dates as seconds since 2001-01-01 UTC; the original script
// also applied a +8h (UTC+8) offset before truncating to a calendar date.
const COREDATA_EPOCH_OFFSET = 978307200 + 28800;

function coreDataDateToISO(z: number): string {
	return new Date((z + COREDATA_EPOCH_OFFSET) * 1000).toISOString().slice(0, 10);
}

const claimStatusByLabel: Record<string, number> = {
	pending: ClaimStatus.Pending,
	done: ClaimStatus.Done
};
const expenseStatusByLabel: Record<string, number> = {
	unpaid: ExpenseStatus.Unpaid,
	pending: ExpenseStatus.Pending,
	paid: ExpenseStatus.Paid
};

const claimIdByNumber = new Map<string, number>();
const expenseIdByNumber = new Map<string, number>();
const expenseDateByNumber = new Map<string, string>();
const incomeIdByNumber = new Map<string, number>();
const incomeDateByNumber = new Map<string, string>();

(db as any).transaction((tx: typeof db) => {
	// 1. Claims
	const claimRows = src.query(`SELECT ZCLAIMNUMBER, ZDATE, ZSTATUS FROM ZCLAIM`).all() as Array<{
		ZCLAIMNUMBER: string;
		ZDATE: number;
		ZSTATUS: string;
	}>;
	for (const c of claimRows) {
		const date = coreDataDateToISO(c.ZDATE);
		const status = claimStatusByLabel[String(c.ZSTATUS).toLowerCase()] ?? ClaimStatus.Pending;
		const row = tx
			.insert(claims)
			.values({ claimNumber: c.ZCLAIMNUMBER, date, status, createdBy: actingUserId, updatedBy: actingUserId })
			.returning({ id: claims.id })
			.get()!;
		claimIdByNumber.set(c.ZCLAIMNUMBER, row.id);
	}

	// 2. Expenses — resolve/create the supplier contact instead of writing free text.
	const expenseRows = src
		.query(
			`SELECT e.ZEXPENSENUMBER, e.ZITEMNAME, e.ZSUPPLIER, e.ZREFERENCE, e.ZREMARK,
			        e.ZCATEGORY, e.ZSTATUS, e.ZDATE, e.ZAMOUNTCENTS, c.ZCLAIMNUMBER AS claimNumber
			 FROM ZEXPENSE e
			 LEFT JOIN ZCLAIM c ON e.ZCLAIM = c.Z_PK`
		)
		.all() as Array<{
		ZEXPENSENUMBER: string;
		ZITEMNAME: string;
		ZSUPPLIER: string | null;
		ZREFERENCE: string | null;
		ZREMARK: string | null;
		ZCATEGORY: string | null;
		ZSTATUS: string;
		ZDATE: number;
		ZAMOUNTCENTS: number;
		claimNumber: string | null;
	}>;
	for (const e of expenseRows) {
		const date = coreDataDateToISO(e.ZDATE);
		const status = expenseStatusByLabel[String(e.ZSTATUS).toLowerCase()] ?? ExpenseStatus.Unpaid;
		const contactId = resolveOrCreateContact(tx, e.ZSUPPLIER ?? '', Role.Supplier, actingUserId);
		const claimId = e.claimNumber ? claimIdByNumber.get(e.claimNumber) ?? null : null;
		const row = tx
			.insert(expenses)
			.values({
				expenseNumber: e.ZEXPENSENUMBER,
				itemName: e.ZITEMNAME,
				contactId,
				reference: e.ZREFERENCE ?? '',
				remark: e.ZREMARK ?? '',
				category: e.ZCATEGORY ?? 'Other',
				status,
				date,
				amount: e.ZAMOUNTCENTS / 100,
				claimId,
				createdBy: actingUserId,
				updatedBy: actingUserId
			})
			.returning({ id: expenses.id })
			.get()!;
		expenseIdByNumber.set(e.ZEXPENSENUMBER, row.id);
		expenseDateByNumber.set(e.ZEXPENSENUMBER, date);
	}

	// 3. Incomes — resolve/create the customer contact instead of writing free text.
	const incomeRows = src
		.query(
			`SELECT ZINCOMENUMBER, ZSOURCE, ZDESCRIPTIONTEXT, ZREFERENCE, ZREMARK, ZCATEGORY, ZDATE, ZAMOUNTCENTS
			 FROM ZINCOME`
		)
		.all() as Array<{
		ZINCOMENUMBER: string;
		ZSOURCE: string | null;
		ZDESCRIPTIONTEXT: string | null;
		ZREFERENCE: string | null;
		ZREMARK: string | null;
		ZCATEGORY: string | null;
		ZDATE: number;
		ZAMOUNTCENTS: number;
	}>;
	for (const i of incomeRows) {
		const date = coreDataDateToISO(i.ZDATE);
		const contactId = resolveOrCreateContact(tx, i.ZSOURCE ?? '', Role.Customer, actingUserId);
		const row = tx
			.insert(incomes)
			.values({
				incomeNumber: i.ZINCOMENUMBER,
				contactId,
				descriptionText: i.ZDESCRIPTIONTEXT ?? '',
				reference: i.ZREFERENCE ?? '',
				remark: i.ZREMARK ?? '',
				category: i.ZCATEGORY ?? 'Other',
				date,
				amount: i.ZAMOUNTCENTS / 100,
				createdBy: actingUserId,
				updatedBy: actingUserId
			})
			.returning({ id: incomes.id })
			.get()!;
		incomeIdByNumber.set(i.ZINCOMENUMBER, row.id);
		incomeDateByNumber.set(i.ZINCOMENUMBER, date);
	}

	// 4. Expense attachments — ZFILENAME = "Expenses/{uuid}_{name}" → "expenses/YYYY/MM/{uuid}_{name}".
	const expenseAttachmentRows = src
		.query(
			`SELECT a.ZFILENAME, a.ZDISPLAYNAME, e.ZEXPENSENUMBER
			 FROM ZATTACHMENT a
			 JOIN ZEXPENSE e ON a.ZEXPENSE = e.Z_PK
			 WHERE a.ZEXPENSE IS NOT NULL`
		)
		.all() as Array<{ ZFILENAME: string; ZDISPLAYNAME: string; ZEXPENSENUMBER: string }>;
	for (const a of expenseAttachmentRows) {
		const expenseId = expenseIdByNumber.get(a.ZEXPENSENUMBER);
		const date = expenseDateByNumber.get(a.ZEXPENSENUMBER);
		if (!expenseId || !date) continue;
		const basename = a.ZFILENAME.slice(a.ZFILENAME.indexOf('/') + 1);
		const filename = `expenses/${date.slice(0, 4)}/${date.slice(5, 7)}/${basename}`;
		tx.insert(expenseAttachments)
			.values({ expenseId, filename, displayName: a.ZDISPLAYNAME, addedDate: date })
			.run();
	}

	// 5. Claim attachments (all stored in ZCLAIMATTACHMENT).
	const claimAttachmentRows = src
		.query(
			`SELECT a.ZFILENAME, a.ZDISPLAYNAME, c.ZCLAIMNUMBER,
			        date(c.ZDATE + ${COREDATA_EPOCH_OFFSET}, 'unixepoch') AS d
			 FROM ZCLAIMATTACHMENT a
			 JOIN ZCLAIM c ON a.ZCLAIM = c.Z_PK`
		)
		.all() as Array<{ ZFILENAME: string; ZDISPLAYNAME: string; ZCLAIMNUMBER: string; d: string }>;
	for (const a of claimAttachmentRows) {
		const claimId = claimIdByNumber.get(a.ZCLAIMNUMBER);
		if (!claimId) continue;
		const basename = a.ZFILENAME.slice(a.ZFILENAME.indexOf('/') + 1);
		const filename = `claims/${a.d.slice(0, 4)}/${a.d.slice(5, 7)}/${basename}`;
		tx.insert(claimAttachments)
			.values({ claimId, filename, displayName: a.ZDISPLAYNAME, addedDate: a.d })
			.run();
	}

	// 6. Income attachments.
	const incomeAttachmentRows = src
		.query(
			`SELECT a.ZFILENAME, a.ZDISPLAYNAME, i.ZINCOMENUMBER
			 FROM ZINCOMEATTACHMENT a
			 JOIN ZINCOME i ON a.ZINCOME = i.Z_PK`
		)
		.all() as Array<{ ZFILENAME: string; ZDISPLAYNAME: string; ZINCOMENUMBER: string }>;
	for (const a of incomeAttachmentRows) {
		const incomeId = incomeIdByNumber.get(a.ZINCOMENUMBER);
		const date = incomeDateByNumber.get(a.ZINCOMENUMBER);
		if (!incomeId || !date) continue;
		const basename = a.ZFILENAME.slice(a.ZFILENAME.indexOf('/') + 1);
		const filename = `income/${date.slice(0, 4)}/${date.slice(5, 7)}/${basename}`;
		tx.insert(incomeAttachments)
			.values({ incomeId, filename, displayName: a.ZDISPLAYNAME, addedDate: date })
			.run();
	}

	// 7. Search text.
	const expenseSearchRows = src
		.query(
			`SELECT s.ZTEXT, e.ZEXPENSENUMBER
			 FROM ZEXPENSESEARCHDATA s
			 JOIN ZEXPENSE e ON s.ZEXPENSE = e.Z_PK
			 WHERE s.ZTEXT IS NOT NULL`
		)
		.all() as Array<{ ZTEXT: string; ZEXPENSENUMBER: string }>;
	for (const s of expenseSearchRows) {
		const expenseId = expenseIdByNumber.get(s.ZEXPENSENUMBER);
		if (!expenseId) continue;
		tx.insert(expenseSearchText).values({ expenseId, text: s.ZTEXT }).run();
	}

	const incomeSearchRows = src
		.query(
			`SELECT s.ZTEXT, i.ZINCOMENUMBER
			 FROM ZINCOMESEARCHDATA s
			 JOIN ZINCOME i ON s.ZINCOME = i.Z_PK
			 WHERE s.ZTEXT IS NOT NULL`
		)
		.all() as Array<{ ZTEXT: string; ZINCOMENUMBER: string }>;
	for (const s of incomeSearchRows) {
		const incomeId = incomeIdByNumber.get(s.ZINCOMENUMBER);
		if (!incomeId) continue;
		tx.insert(incomeSearchText).values({ incomeId, text: s.ZTEXT }).run();
	}

	// 8. App sequences — now global (no per-user split); upsert by prefix+date_key.
	const sequenceRows = src.query(`SELECT ZPREFIX, ZDATEKEY, ZLASTSEQUENCE FROM ZAPPSEQUENCE`).all() as Array<{
		ZPREFIX: string;
		ZDATEKEY: string;
		ZLASTSEQUENCE: number;
	}>;
	for (const s of sequenceRows) {
		tx.insert(appSequences)
			.values({ prefix: s.ZPREFIX, dateKey: s.ZDATEKEY, lastSequence: s.ZLASTSEQUENCE })
			.onConflictDoUpdate({
				target: [appSequences.prefix, appSequences.dateKey],
				set: { lastSequence: s.ZLASTSEQUENCE }
			})
			.run();
	}
});

console.log('DB migration complete.');
console.log('');
console.log('── Row counts ────────────────────────────────────────────────');
const counts: Array<[string, number]> = [
	['expenses', db.select({ id: expenses.id }).from(expenses).all().length],
	['incomes', db.select({ id: incomes.id }).from(incomes).all().length],
	['claims', db.select({ id: claims.id }).from(claims).all().length],
	['expense_attachments', db.select({ id: expenseAttachments.id }).from(expenseAttachments).all().length],
	['claim_attachments', db.select({ id: claimAttachments.id }).from(claimAttachments).all().length],
	['income_attachments', db.select({ id: incomeAttachments.id }).from(incomeAttachments).all().length]
];
for (const [table, count] of counts) {
	console.log(`  ${table.padEnd(30)} ${count}`);
}
