import { eq, inArray } from 'drizzle-orm';
import { db } from '../db/client.js';
import { importQueue, users } from '../db/schema.js';
import { STORAGE_PATH } from '../env.js';
import { createLogger } from '../logger.js';
import { getSetting, SETTING_KEYS } from '../settings.js';
import { extractText } from './extractor.js';
import { callLLM } from './llm.js';
import { detectDuplicate } from './duplicate-detector.js';
import { importEvents } from './events.js';
import { join } from 'path';

const log = createLogger('import:worker');

const DEFAULT_CONCURRENCY = 3;
const TICK_INTERVAL = 2000;

const activeJobs = new Set<string>();

function emitJobUpdate(jobId: string, userId: number) {
	const row = db.select().from(importQueue).where(eq(importQueue.id, jobId)).get();
	if (row) importEvents.emit('job-update', { userId, job: row });
}

export function startImportWorker(): void {
	recoverStaleJobs();
	scheduleTick();
}

function scheduleTick() {
	setTimeout(async () => {
		try {
			await tick();
		} catch (err) {
			log.error({ err }, 'Tick error');
		}
		scheduleTick();
	}, TICK_INTERVAL);
}

function recoverStaleJobs() {
	db.update(importQueue)
		.set({ state: 'queued' })
		.where(inArray(importQueue.state, ['extracting', 'processing']))
		.run();
}

async function tick() {
	const queued = db
		.select()
		.from(importQueue)
		.where(eq(importQueue.state, 'queued'))
		.all();

	const slots = DEFAULT_CONCURRENCY - activeJobs.size;
	if (slots <= 0 || queued.length === 0) return;

	const toProcess = queued.slice(0, slots);
	await Promise.all(toProcess.map((job) => processJob(job)));
}

async function processJob(job: typeof importQueue.$inferSelect) {
	if (activeJobs.has(job.id)) return;
	activeJobs.add(job.id);

	try {
		// Get the owner user for settings lookup
		const ownerUser = db
			.select({ id: users.id })
			.from(users)
			.where(eq(users.id, job.userId))
			.get();
		const userId = ownerUser?.id ?? job.userId;

		const apiKey = getSetting(db, userId, SETTING_KEYS.autoImportApiKey);
		if (!apiKey) {
			markFailed(job.id, userId, 'No OpenRouter API key configured. Go to Settings → Intelligence to add one.');
			return;
		}

		const model = getSetting(db, userId, SETTING_KEYS.autoImportModel) ?? 'anthropic/claude-3.5-sonnet';
		const expCatsRaw = getSetting(db, userId, SETTING_KEYS.expenseCategories);
		const incCatsRaw = getSetting(db, userId, SETTING_KEYS.incomeCategories);
		const expenseCategories: string[] = expCatsRaw ? JSON.parse(expCatsRaw) : [];
		const incomeCategories: string[] = incCatsRaw ? JSON.parse(incCatsRaw) : [];

		log.info({ jobId: job.id, filename: job.originalFilename, model }, 'Processing job');

		// Extracting
		db.update(importQueue)
			.set({ state: 'extracting' })
			.where(eq(importQueue.id, job.id))
			.run();
		emitJobUpdate(job.id, userId);

		const absPath = join(STORAGE_PATH, job.tempFilePath);
		const mimeType = inferMimeType(job.originalFilename);
		let text: string;
		try {
			text = await extractText(absPath, mimeType);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			log.error({ jobId: job.id, err }, 'Text extraction failed');
			markFailed(job.id, userId, msg);
			return;
		}

		if (!text || text.length < 10) {
			log.warn({ jobId: job.id, textLength: text?.length ?? 0 }, 'Insufficient text extracted');
			markFailed(job.id, userId, "Couldn't read enough text from this file. Try a clearer image or a text PDF.");
			return;
		}

		log.debug({ jobId: job.id, textLength: text.length, preview: text.slice(0, 200) }, 'Text extracted');

		// Processing — LLM call
		db.update(importQueue)
			.set({ state: 'processing' })
			.where(eq(importQueue.id, job.id))
			.run();
		emitJobUpdate(job.id, userId);

		let result;
		try {
			result = await callLLM(text, expenseCategories, incomeCategories, apiKey, model);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			log.error({ jobId: job.id, err }, 'LLM extraction failed');
			markFailed(job.id, userId, `AI extraction failed: ${msg}`);
			return;
		}

		log.info({ jobId: job.id, documentType: result.document_type, amount: result.amount, date: result.date }, 'LLM result');

		// Duplicate detection
		const dup = detectDuplicate(db, userId, {
			originalFilename: job.originalFilename,
			itemName: result.item_name,
			supplier: result.supplier,
			amount: result.amount,
			date: result.date,
			reference: result.reference
		});

		const now = new Date().toISOString();
		db.update(importQueue)
			.set({
				state: 'pending_review',
				documentType: result.document_type,
				itemName: result.item_name,
				supplier: result.supplier,
				date: result.date,
				amount: result.amount,
				reference: result.reference,
				category: result.category,
				remark: result.remark,
				duplicateOf: dup?.duplicateOf ?? null,
				duplicateSignal: dup?.duplicateSignal ?? null,
				processedAt: now
			})
			.where(eq(importQueue.id, job.id))
			.run();
		emitJobUpdate(job.id, userId);

		log.info({ jobId: job.id }, 'Job completed — pending review');
	} finally {
		activeJobs.delete(job.id);
	}
}

function markFailed(jobId: string, userId: number, error: string) {
	log.error({ jobId, error }, 'Job failed');
	db.update(importQueue)
		.set({ state: 'failed', error })
		.where(eq(importQueue.id, jobId))
		.run();
	emitJobUpdate(jobId, userId);
}

function inferMimeType(filename: string): string {
	const lower = filename.toLowerCase();
	if (lower.endsWith('.pdf')) return 'application/pdf';
	if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
	if (lower.endsWith('.png')) return 'image/png';
	return 'application/octet-stream';
}
