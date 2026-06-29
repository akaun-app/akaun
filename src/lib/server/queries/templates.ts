import { and, count, eq, inArray, sql } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import * as schema from '../db/schema.js';
import { documentTemplates } from '../db/schema.js';
import { getSetting, setSetting, SETTING_KEYS } from '../settings.js';
import { TemplateDocumentType } from '$lib/enums.js';
import type { TemplateLayout, TemplateRow } from '../pdf/template-types.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = BunSQLiteDatabase<typeof schema> | BunSQLiteDatabase<any>;

export type TemplateCreate = {
	name: string;
	documentType: number;
	themeColor?: string;
	themeFont?: number;
	layout: TemplateLayout;
};

export type TemplatePatch = Partial<TemplateCreate>;

export function listTemplates(db: Db, documentType?: number): TemplateRow[] {
	if (documentType !== undefined) {
		return db
			.select()
			.from(documentTemplates)
			.where(inArray(documentTemplates.documentType, [documentType, TemplateDocumentType.Both]))
			.all() as TemplateRow[];
	}
	return db.select().from(documentTemplates).all() as TemplateRow[];
}

export function getTemplate(db: Db, id: number): TemplateRow | null {
	return (
		(db
			.select()
			.from(documentTemplates)
			.where(eq(documentTemplates.id, id))
			.get() as TemplateRow | undefined) ?? null
	);
}

export function getTemplateByUuid(db: Db, uuid: string): TemplateRow | null {
	return (
		(db
			.select()
			.from(documentTemplates)
			.where(eq(documentTemplates.uuid, uuid))
			.get() as TemplateRow | undefined) ?? null
	);
}

export function getActiveTemplate(db: Db, documentType: 1 | 2): TemplateRow | null {
	const key =
		documentType === TemplateDocumentType.Quotation
			? SETTING_KEYS.templateQuotationDefaultId
			: SETTING_KEYS.templateInvoiceDefaultId;
	const idStr = getSetting(db, key);
	if (idStr) {
		const t = getTemplate(db, parseInt(idStr));
		if (t) return t;
	}
	// Fallback: first template matching this doc type or Both
	return (
		(db
			.select()
			.from(documentTemplates)
			.where(inArray(documentTemplates.documentType, [documentType, TemplateDocumentType.Both]))
			.get() as TemplateRow | undefined) ?? null
	);
}

export function createTemplate(db: Db, userId: number, data: TemplateCreate): TemplateRow {
	const uuid = crypto.randomUUID();
	return db
		.insert(documentTemplates)
		.values({
			uuid,
			name: data.name,
			documentType: data.documentType,
			isDefault: 0,
			themeColor: data.themeColor ?? '#1a56db',
			themeFont: data.themeFont ?? 1,
			layoutJson: JSON.stringify(data.layout),
			createdBy: userId,
			updatedBy: userId
		})
		.returning()
		.get() as TemplateRow;
}

export function updateTemplate(
	db: Db,
	id: number,
	userId: number,
	patch: TemplatePatch
): TemplateRow | null {
	const existing = getTemplate(db, id);
	if (!existing) return null;

	const updates: Record<string, unknown> = {
		updatedBy: userId,
		updatedAt: new Date().toISOString()
	};
	if (patch.name !== undefined) updates.name = patch.name;
	if (patch.documentType !== undefined) updates.documentType = patch.documentType;
	if (patch.themeColor !== undefined) updates.themeColor = patch.themeColor;
	if (patch.themeFont !== undefined) updates.themeFont = patch.themeFont;
	if (patch.layout !== undefined) updates.layoutJson = JSON.stringify(patch.layout);

	return (
		(db
			.update(documentTemplates)
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			.set(updates as any)
			.where(eq(documentTemplates.id, id))
			.returning()
			.get() as TemplateRow | undefined) ?? null
	);
}

export function deleteTemplate(
	db: Db,
	id: number
): { ok: boolean; reason?: 'last_template' | 'not_found' } {
	const total = (db.select({ n: count() }).from(documentTemplates).get() as { n: number }).n;
	if (total <= 1) return { ok: false, reason: 'last_template' };
	const existing = getTemplate(db, id);
	if (!existing) return { ok: false, reason: 'not_found' };
	db.delete(documentTemplates).where(eq(documentTemplates.id, id)).run();
	return { ok: true };
}

export function setDefaultTemplate(db: Db, templateId: number, documentType: 1 | 2): void {
	const key =
		documentType === TemplateDocumentType.Quotation
			? SETTING_KEYS.templateQuotationDefaultId
			: SETTING_KEYS.templateInvoiceDefaultId;
	setSetting(db, key, String(templateId));
	// Clear isDefault on other templates with overlapping document_type
	db.update(documentTemplates)
		.set({ isDefault: 0 })
		.where(
			and(
				inArray(documentTemplates.documentType, [documentType, TemplateDocumentType.Both]),
				sql`${documentTemplates.id} != ${templateId}`
			)
		)
		.run();
	// Set isDefault on this template
	db.update(documentTemplates)
		.set({ isDefault: 1 })
		.where(eq(documentTemplates.id, templateId))
		.run();
}
