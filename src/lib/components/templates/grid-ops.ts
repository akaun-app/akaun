// Pure grid layout operations shared by TemplateDesigner (commit) and
// TemplateCanvas (live drag preview).
//
// Editing model: every row is a full-width horizontal band. The cells in a band
// partition the `columns` track evenly by default; gutter-dragging redistributes
// width between two neighbours (keeping the band total constant). Storage stays
// the GridCell shape from Iteration 1, so the PDF renderer is unchanged.
// rowSpan is fixed at 1 in this model.

import type { BlockType, GridCell } from '$lib/pdf/template-types.js';

export type Band = GridCell[];

export function newCell(type: BlockType, columns: number): GridCell {
	return {
		id: crypto.randomUUID(),
		type,
		config: {},
		style: {},
		col: 0,
		row: 0,
		colSpan: columns,
		rowSpan: 1
	};
}

// n spans summing to `columns`, as even as possible (leading cells absorb the remainder).
export function evenSpans(n: number, columns: number): number[] {
	const base = Math.floor(columns / n);
	let rem = columns - base * n;
	const out: number[] = [];
	for (let i = 0; i < n; i++) {
		out.push(base + (rem > 0 ? 1 : 0));
		if (rem > 0) rem--;
	}
	return out;
}

// Group cells into ordered row bands; within each band order by column.
export function toBands(cells: GridCell[]): Band[] {
	const byRow = new Map<number, GridCell[]>();
	for (const c of cells) {
		const arr = byRow.get(c.row);
		if (arr) arr.push(c);
		else byRow.set(c.row, [c]);
	}
	return [...byRow.keys()]
		.sort((a, b) => a - b)
		.map((r) => byRow.get(r)!.slice().sort((a, b) => a.col - b.col));
}

// Re-emit bands to dense rows; recompute sequential cols and force each band's
// colSpans to sum to `columns` (the last cell absorbs any difference).
export function materialize(bands: Band[], columns: number): GridCell[] {
	const out: GridCell[] = [];
	let row = 0;
	for (const band of bands) {
		if (!band.length) continue;
		const cells = band.map((c) => ({ ...c, rowSpan: 1 }));
		const total = cells.reduce((s, c) => s + c.colSpan, 0);
		if (total !== columns) {
			const last = cells[cells.length - 1];
			last.colSpan = Math.max(1, last.colSpan + (columns - total));
		}
		let col = 0;
		for (const c of cells) {
			out.push({ ...c, row, col });
			col += c.colSpan;
		}
		row++;
	}
	return out;
}

function tileEven(band: Band, columns: number): Band {
	const spans = evenSpans(band.length, columns);
	return band.map((c, i) => ({ ...c, colSpan: spans[i] }));
}

// Append a full-width block as a new bottom row.
export function appendRow(cells: GridCell[], block: GridCell, columns: number): GridCell[] {
	const bands = toBands(cells);
	bands.push([{ ...block, colSpan: columns }]);
	return materialize(bands, columns);
}

// Insert a block either as a new full-width row (newRow) or into an existing
// band at `index`, re-tiling that band evenly.
export function insertInto(
	cells: GridCell[],
	block: GridCell,
	row: number,
	index: number,
	columns: number,
	newRow: boolean
): GridCell[] {
	const bands = toBands(cells);
	if (newRow || !bands[row]) {
		const at = Math.min(Math.max(row, 0), bands.length);
		bands.splice(at, 0, [{ ...block, colSpan: columns }]);
	} else {
		const band = bands[row];
		const at = Math.min(Math.max(index, 0), band.length);
		band.splice(at, 0, block);
		bands[row] = tileEven(band, columns);
	}
	return materialize(bands, columns);
}

// Move an existing block to a new band/position. row/index are interpreted
// against the layout with the block already removed (the caller's drag base).
export function moveBlock(
	cells: GridCell[],
	id: string,
	row: number,
	index: number,
	columns: number,
	newRow: boolean
): GridCell[] {
	const block = cells.find((c) => c.id === id);
	if (!block) return cells;
	const without = cells.filter((c) => c.id !== id);
	return insertInto(without, { ...block }, row, index, columns, newRow);
}

// Remove a block; its band's remaining neighbour absorbs the freed width.
export function removeBlock(cells: GridCell[], id: string, columns: number): GridCell[] {
	const bands = toBands(cells)
		.map((b) => b.filter((c) => c.id !== id))
		.filter((b) => b.length > 0);
	return materialize(bands, columns);
}

// Set the width split between two adjacent cells in the same band: the left cell
// takes `leftColSpan`, the right absorbs the remainder of their shared width.
export function setGutter(
	cells: GridCell[],
	leftId: string,
	rightId: string,
	leftColSpan: number,
	columns: number
): GridCell[] {
	const bands = toBands(cells);
	for (const band of bands) {
		const li = band.findIndex((c) => c.id === leftId);
		const ri = band.findIndex((c) => c.id === rightId);
		if (li === -1 || ri === -1) continue;
		const pair = band[li].colSpan + band[ri].colSpan;
		const l = Math.min(Math.max(leftColSpan, 1), pair - 1);
		band[li] = { ...band[li], colSpan: l };
		band[ri] = { ...band[ri], colSpan: pair - l };
	}
	return materialize(bands, columns);
}
