import { and, desc, eq, inArray, type SQL } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { ledgerRecords, importQueue, contacts } from '../db/schema.js';
import { ImportState, DocumentType, LedgerRecordKind } from '$lib/enums.js';
import { normalizeName } from '../queries/contacts.js';
import { getSetting, SETTING_KEYS } from '../settings.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = BunSQLiteDatabase<any>;

type JobSnapshot = {
	originalFilename: string;
	fileHash: string | null;
	itemName: string | null;
	supplier: string | null;
	amount: number | null;
	date: string | null;
	reference: string | null;
	extractedText: string | null;
	documentType: number;
};

type DuplicateResult = {
	duplicateOf: number;
	confidence: number;
	reasons: string[];
} | null;

type Candidate = {
	id: number;
	amount: number | null;
	date: string | null;
	reference: string | null;
	legalName: string | null;
	extractedText: string | null;
	originalFilename: string | null;
};

const DEFAULT_THRESHOLD = 60;
const CONTENT_CHAR_LIMIT = 20_000;
const RECENT_CANDIDATE_LIMIT = 200;

function tokenSet(normalized: string): Set<string> {
	return new Set(normalized.split(' ').filter(Boolean));
}

// Dice coefficient over token sets — same shape as contacts.ts's name-similarity() check,
// generalized from short names to full document text.
function diceSimilarity(a: Set<string>, b: Set<string>): number {
	if (a.size === 0 || b.size === 0) return 0;
	let intersection = 0;
	for (const token of a) if (b.has(token)) intersection++;
	return (2 * intersection) / (a.size + b.size);
}

function stripExtension(filename: string): string {
	return filename.replace(/\.[^.]+$/, '');
}

function daysBetween(a: string, b: string): number {
	const da = new Date(a).getTime();
	const db_ = new Date(b).getTime();
	if (isNaN(da) || isNaN(db_)) return Infinity;
	return Math.abs(da - db_) / 86_400_000;
}

// Shared ledger: no per-user filtering — a duplicate is a duplicate for everyone.
export function detectDuplicate(db: Db, job: JobSnapshot): DuplicateResult {
	// File hash — byte-identical re-upload of a file already imported. Unambiguous, so it
	// short-circuits before the (more expensive) weighted engine below runs at all.
	if (job.fileHash) {
		const byHash = db
			.select({ id: importQueue.resultId })
			.from(importQueue)
			.where(
				and(eq(importQueue.fileHash, job.fileHash), eq(importQueue.state, ImportState.Imported))
			)
			.get();
		if (byHash?.id != null) {
			return { duplicateOf: byHash.id, confidence: 100, reasons: ['file_hash'] };
		}
	}

	const isIncome = job.documentType === DocumentType.Income;
	// One record store since the double-entry conversion. Expenses and incomes are
	// kinds of record, not tables of their own, so the candidate pool is narrowed by
	// `kind` instead of chosen by table. Every field compared below — amount, date,
	// reference, extracted text — lives on the record itself; `ledger_movements` is
	// deliberately NOT joined, because a record has one row per side and joining them
	// would offer the same candidate twice.
	const kind = isIncome ? LedgerRecordKind.Income : LedgerRecordKind.Expense;

	function candidateQuery(extra?: SQL) {
		return db
			.select({
				id: ledgerRecords.id,
				amount: ledgerRecords.amount,
				date: ledgerRecords.date,
				reference: ledgerRecords.reference,
				legalName: contacts.legalName,
				extractedText: ledgerRecords.extractedText,
				originalFilename: importQueue.originalFilename
			})
			.from(ledgerRecords)
			.leftJoin(contacts, eq(contacts.id, ledgerRecords.contactId))
			.leftJoin(
				importQueue,
				and(
					eq(importQueue.resultId, ledgerRecords.id),
					eq(importQueue.resultType, job.documentType),
					eq(importQueue.state, ImportState.Imported)
				)
			)
			.where(extra ? and(eq(ledgerRecords.kind, kind), extra) : eq(ledgerRecords.kind, kind));
	}

	// Bounded candidate pool — never a full-table scan. Union of: the most recent N
	// records (covers "haven't specified a date window, just take what's recent"), any
	// exact reference match (a resubmission may carry a corrected date), and any exact
	// filename match via import_queue (a scanner-reused name from further back in time).
	const candidates = new Map<number, Candidate>();
	for (const row of candidateQuery()
		.orderBy(desc(ledgerRecords.date))
		.limit(RECENT_CANDIDATE_LIMIT)
		.all()) {
		candidates.set(row.id, row);
	}

	if (job.reference && job.reference.trim()) {
		for (const row of candidateQuery(eq(ledgerRecords.reference, job.reference.trim())).all()) {
			candidates.set(row.id, row);
		}
	}

	const filenameHits = db
		.select({ resultId: importQueue.resultId })
		.from(importQueue)
		.where(
			and(
				eq(importQueue.originalFilename, job.originalFilename),
				eq(importQueue.state, ImportState.Imported),
				eq(importQueue.resultType, job.documentType)
			)
		)
		.all();
	const filenameIds = filenameHits.map((r) => r.resultId).filter((id): id is number => id != null);
	if (filenameIds.length) {
		for (const row of candidateQuery(inArray(ledgerRecords.id, filenameIds)).all()) {
			candidates.set(row.id, row);
		}
	}

	if (candidates.size === 0) return null;

	const jobTokens = job.extractedText ? tokenSet(normalizeName(job.extractedText.slice(0, CONTENT_CHAR_LIMIT))) : null;
	const jobFilenameTokens = tokenSet(normalizeName(stripExtension(job.originalFilename)));
	const jobSupplierNorm = job.supplier ? normalizeName(job.supplier) : null;
	const jobSupplierTokens = jobSupplierNorm ? tokenSet(jobSupplierNorm) : null;

	let best: { id: number; score: number; reasons: string[] } | null = null;

	for (const c of candidates.values()) {
		const reasons: { label: string; weight: number }[] = [];

		if (job.reference && job.reference.trim() && c.reference && c.reference.trim() === job.reference.trim()) {
			reasons.push({ label: 'reference', weight: 65 });
		}

		if (job.amount != null && c.amount != null) {
			if (job.amount === c.amount) reasons.push({ label: 'amount', weight: 25 });
			else if (Math.abs(job.amount - c.amount) / Math.max(Math.abs(c.amount), 0.01) <= 0.01) {
				reasons.push({ label: 'amount', weight: 12 });
			}
		}

		if (job.date && c.date) {
			const diff = daysBetween(job.date, c.date);
			if (diff === 0) reasons.push({ label: 'date', weight: 20 });
			else if (diff <= 3) reasons.push({ label: 'date', weight: 10 });
			else if (diff <= 14) reasons.push({ label: 'date', weight: 4 });
		}

		if (jobSupplierNorm && jobSupplierTokens && c.legalName) {
			const candNorm = normalizeName(c.legalName);
			if (candNorm === jobSupplierNorm) reasons.push({ label: 'supplier', weight: 20 });
			else {
				const sim = diceSimilarity(jobSupplierTokens, tokenSet(candNorm));
				if (sim >= 0.7) reasons.push({ label: 'supplier', weight: 10 });
			}
		}

		if (c.originalFilename) {
			const candFilenameNorm = normalizeName(stripExtension(c.originalFilename));
			const candFilenameTokens = tokenSet(candFilenameNorm);
			const jobFilenameNorm = normalizeName(stripExtension(job.originalFilename));
			if (jobFilenameNorm && candFilenameNorm === jobFilenameNorm) {
				reasons.push({ label: 'filename', weight: 25 });
			} else {
				const sim = diceSimilarity(jobFilenameTokens, candFilenameTokens);
				if (sim >= 0.7) reasons.push({ label: 'filename', weight: 12 });
			}
		}

		if (jobTokens && c.extractedText) {
			const candTokens = tokenSet(normalizeName(c.extractedText.slice(0, CONTENT_CHAR_LIMIT)));
			const sim = diceSimilarity(jobTokens, candTokens);
			const weight = Math.round(35 * sim);
			if (weight > 0) reasons.push({ label: 'content', weight });
		}

		if (reasons.length === 0) continue;

		const score = Math.min(
			reasons.reduce((sum, r) => sum + r.weight, 0),
			100
		);
		if (!best || score > best.score) {
			best = {
				id: c.id,
				score,
				reasons: [...reasons].sort((a, b) => b.weight - a.weight).map((r) => r.label)
			};
		}
	}

	if (!best) return null;

	const threshold = parseInt(getSetting(db, SETTING_KEYS.autoImportDuplicateThreshold) ?? String(DEFAULT_THRESHOLD), 10);
	if (best.score < threshold) return null;

	return { duplicateOf: best.id, confidence: best.score, reasons: best.reasons };
}
