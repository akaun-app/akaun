// Shared template types — safe to import in both server and browser code.
// Server-only DB helpers live in $lib/server/pdf/template-types.ts.

// ---------------------------------------------------------------------------
// TemplateRow — mirrors document_templates schema as a plain interface
// ---------------------------------------------------------------------------

export type TemplateRow = {
	id: number;
	uuid: string;
	name: string;
	documentType: number;
	isDefault: number;
	themeColor: string;
	themeFont: number;
	layoutJson: string;
	createdBy: number | null;
	updatedBy: number | null;
	createdAt: string;
	updatedAt: string;
};

// ---------------------------------------------------------------------------
// Block types
// ---------------------------------------------------------------------------

export type BlockType =
	| 'company-name'
	| 'company-address'
	| 'company-reg-info'
	| 'document-title'
	| 'document-meta'
	| 'customer-block'
	| 'line-items-table'
	| 'totals-block'
	| 'notes'
	| 'paid-stamp'
	| 'issued-by'
	| 'text'
	| 'image'
	| 'divider'
	| 'spacer';

export type BlockStyle = {
	align?: 'left' | 'center' | 'right';
};

export type BlockDef = {
	id: string;
	type: BlockType;
	config: Record<string, unknown>;
	style?: BlockStyle;
};

// A single horizontal row of blocks (used in all zones).
export type ZoneRow = { blocks: BlockDef[] };

export type TemplateLayout = {
	header: { rows: ZoneRow[] };
	body: { rows: ZoneRow[] };
	footer: { rows: ZoneRow[] };
};

export type ThemeData = {
	color: string;
	font: number;
};

// ---------------------------------------------------------------------------
// Block classification constants
// ---------------------------------------------------------------------------

export const SYSTEM_REQUIRED_BLOCKS: BlockType[] = [
	'company-name',
	'company-address',
	'company-reg-info',
	'document-title',
	'document-meta',
	'customer-block',
	'line-items-table',
	'totals-block'
];
export const SYSTEM_OPTIONAL_BLOCKS: BlockType[] = ['notes', 'paid-stamp', 'issued-by'];
export const CUSTOM_BLOCKS: BlockType[] = ['text', 'image', 'divider', 'spacer'];

// ---------------------------------------------------------------------------
// Default layout factory
// ---------------------------------------------------------------------------

export function makeDefaultLayout(): TemplateLayout {
	const id = () => crypto.randomUUID();
	return {
		header: {
			rows: [
				{
					blocks: [
						{ id: id(), type: 'company-name', config: {} },
						{ id: id(), type: 'document-title', config: {} }
					]
				},
				{
					blocks: [
						{ id: id(), type: 'company-address', config: {} },
						{ id: id(), type: 'document-meta', config: { showTitle: false, showReference: true } }
					]
				},
				{
					blocks: [
						{ id: id(), type: 'company-reg-info', config: {} }
					]
				}
			]
		},
		body: {
			rows: [
				{ blocks: [{ id: id(), type: 'customer-block', config: {} }] },
				{ blocks: [{ id: id(), type: 'line-items-table', config: { showUnitPrice: true, showQty: true } }] },
				{ blocks: [{ id: id(), type: 'totals-block', config: { showTaxRow: true } }] },
				{ blocks: [{ id: id(), type: 'notes', config: { label: 'Notes' } }] }
			]
		},
		footer: { rows: [{ blocks: [] }] }
	};
}

// ---------------------------------------------------------------------------
// Migration helper — converts old formats to current { rows } shape
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function migrateBlock(b: any): any[] {
	// company-header → three granular blocks
	if (b?.type === 'company-header') {
		const newId = () => crypto.randomUUID();
		return [
			{ id: newId(), type: 'company-name',     config: {}, style: {} },
			{ id: newId(), type: 'company-address',  config: {}, style: {} },
			{ id: newId(), type: 'company-reg-info', config: {}, style: {} }
		];
	}
	// Strip legacy marginTop/marginBottom from style
	if (b?.style) {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		const { marginTop, marginBottom, ...rest } = b.style;
		b = { ...b, style: Object.keys(rest).length ? rest : undefined };
	}
	return [b];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function migrateLayout(raw: unknown): TemplateLayout {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const l = raw as any;

	// Old: { columns: ColumnDef[] } → flatten into single row
	if (l?.header?.columns) {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		l.header = { rows: [{ blocks: l.header.columns.flatMap((c: any) => c.blocks ?? []) }] };
	}
	if (l?.footer?.columns) {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		l.footer = { rows: [{ blocks: l.footer.columns.flatMap((c: any) => c.blocks ?? []) }] };
	}

	// Previous flat: { blocks: BlockDef[] } → wrap in single row
	if (Array.isArray(l?.header?.blocks)) {
		l.header = { rows: [{ blocks: l.header.blocks }] };
	}
	if (Array.isArray(l?.footer?.blocks)) {
		l.footer = { rows: [{ blocks: l.footer.blocks }] };
	}

	// Old flat body: { blocks: [] } → each block becomes its own row
	if (Array.isArray(l?.body?.blocks)) {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		l.body = { rows: l.body.blocks.map((b: any) => ({ blocks: [b] })) };
	}

	// Migrate blocks in every row of every zone (company-header split + strip margins)
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	function migrateRows(rows: any[]): any[] {
		return rows.map((row: any) => ({
			blocks: row.blocks.flatMap(migrateBlock)
		}));
	}
	if (Array.isArray(l?.header?.rows)) l.header.rows = migrateRows(l.header.rows);
	if (Array.isArray(l?.body?.rows))   l.body.rows   = migrateRows(l.body.rows);
	if (Array.isArray(l?.footer?.rows)) l.footer.rows = migrateRows(l.footer.rows);

	// Ensure at least one row exists in every zone
	if (!l?.header?.rows?.length) l.header = { rows: [{ blocks: [] }] };
	if (!l?.body?.rows?.length) l.body = { rows: [{ blocks: [] }] };
	if (!l?.footer?.rows?.length) l.footer = { rows: [{ blocks: [] }] };

	return l as TemplateLayout;
}
