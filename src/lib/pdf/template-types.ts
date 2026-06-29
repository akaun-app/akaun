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

// ---------------------------------------------------------------------------
// Grid model
// ---------------------------------------------------------------------------

// Number of columns in the design grid. A high count keeps gutter-drag resizing
// smooth (each step ≈ 1/24 ≈ 4%) while spans stay integers for clean placement.
// 24 divides evenly by 2/3/4/6/8/12, so common even splits are exact.
export const GRID_COLUMNS = 24;

// A placed block: a BlockDef plus its grid rectangle.
// col/row are 0-based; colSpan in 1..GRID_COLUMNS; rowSpan >= 1.
export type GridCell = BlockDef & {
	col: number;
	row: number;
	colSpan: number;
	rowSpan: number;
};

export type TemplateLayout = {
	columns: number; // = GRID_COLUMNS (stored for forward-compat)
	cells: GridCell[];
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
	const cell = (
		type: BlockType,
		col: number,
		row: number,
		colSpan: number,
		config: Record<string, unknown> = {}
	): GridCell => ({ id: id(), type, config, style: {}, col, row, colSpan, rowSpan: 1 });

	const half = GRID_COLUMNS / 2; // 3
	const full = GRID_COLUMNS; // 6
	return {
		columns: GRID_COLUMNS,
		cells: [
			cell('company-name', 0, 0, half),
			cell('document-title', half, 0, half),
			cell('company-address', 0, 1, half),
			cell('document-meta', half, 1, half, { showTitle: false, showReference: true }),
			cell('company-reg-info', 0, 2, full),
			cell('divider', 0, 3, full),
			cell('customer-block', 0, 4, full),
			cell('line-items-table', 0, 5, full, { showUnitPrice: true, showQty: true }),
			cell('totals-block', 0, 6, full, { showTaxRow: true }),
			cell('notes', 0, 7, full, { label: 'Notes' })
		]
	};
}

// ---------------------------------------------------------------------------
// Grid normalizer — coerces a stored layout to a valid grid.
// (No legacy-shape migration: the DB only ever holds the grid shape.)
// ---------------------------------------------------------------------------

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
	const n = Math.floor(Number(value));
	if (!Number.isFinite(n)) return fallback;
	return Math.min(max, Math.max(min, n));
}

export function migrateLayout(raw: unknown): TemplateLayout {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const l = raw as any;
	if (!l || !Array.isArray(l.cells)) return makeDefaultLayout();

	const columns = clampInt(l.columns, 1, 24, GRID_COLUMNS);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const cells: GridCell[] = l.cells.map((c: any): GridCell => {
		const col = clampInt(c?.col, 0, columns - 1, 0);
		const colSpan = clampInt(c?.colSpan, 1, columns - col, 1);
		return {
			id: typeof c?.id === 'string' ? c.id : crypto.randomUUID(),
			type: c?.type as BlockType,
			config: c?.config && typeof c.config === 'object' ? c.config : {},
			style: c?.style && typeof c.style === 'object' ? c.style : {},
			col,
			colSpan,
			row: clampInt(c?.row, 0, Number.MAX_SAFE_INTEGER, 0),
			rowSpan: clampInt(c?.rowSpan, 1, Number.MAX_SAFE_INTEGER, 1)
		};
	});

	return { columns, cells };
}
