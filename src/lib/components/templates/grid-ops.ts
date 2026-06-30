// Pure 2D-grid layout operations shared by TemplateDesigner (commit) and
// TemplateCanvas (live drag preview).
//
// Model: cells are non-overlapping rectangles on a `columns`-wide grid, each with
// col/row/colSpan/rowSpan. A cell with rowSpan > 1 occupies its columns across
// several rows, so neighbours flow into the free columns beside it — that is how
// row-span is expressed. Storage is the GridCell shape, which the PDF renderer
// (column-bottom sweep) consumes directly.

import type { BlockType, GridCell } from '$lib/pdf/template-types.js';

export type DropTarget =
	| { mode: 'new-row'; row: number }
	| { mode: 'into-row'; row: number; index: number }
	| { mode: 'place'; col: number; row: number };

export function newCell(type: BlockType, columns: number): GridCell {
	return { id: crypto.randomUUID(), type, config: {}, style: {}, col: 0, row: 0, colSpan: columns, rowSpan: 1 };
}

export function maxRow(cells: GridCell[]): number {
	return cells.reduce((m, c) => Math.max(m, c.row + c.rowSpan), 0);
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

// Two grid rectangles overlap if they intersect on both axes.
export function overlaps(a: GridCell, b: GridCell): boolean {
	const colsClash = a.col < b.col + b.colSpan && b.col < a.col + a.colSpan;
	const rowsClash = a.row < b.row + b.rowSpan && b.row < a.row + a.rowSpan;
	return colsClash && rowsClash;
}

// Keep `movedId` fixed; push every other cell that collides straight down,
// processing top-to-bottom so a single downward pass resolves all clashes.
export function resolveOverlaps(cells: GridCell[], movedId: string): GridCell[] {
	const moved = cells.find((c) => c.id === movedId);
	if (!moved) return cells;
	const rest = cells
		.filter((c) => c.id !== movedId)
		.sort((a, b) => a.row - b.row || a.col - b.col);
	const locked: GridCell[] = [moved];
	for (const cell of rest) {
		let c = cell;
		while (locked.some((l) => overlaps(l, c))) c = { ...c, row: c.row + 1 };
		locked.push(c);
	}
	return locked;
}

// Gravity: pull every cell up to its topmost non-overlapping slot, preserving
// order. Removes the empty rows left behind by moves/deletes/resizes.
export function compact(cells: GridCell[]): GridCell[] {
	const sorted = [...cells].sort((a, b) => a.row - b.row || a.col - b.col);
	const placed: GridCell[] = [];
	for (const cell of sorted) {
		let c = cell;
		while (c.row > 0) {
			const up = { ...c, row: c.row - 1 };
			if (placed.some((p) => overlaps(p, up))) break;
			c = up;
		}
		placed.push(c);
	}
	return placed;
}

function finalize(cells: GridCell[], movedId: string): GridCell[] {
	return compact(resolveOverlaps(cells, movedId));
}

// Place (or reposition) a block at a free 2D coordinate; colliding cells flow down.
export function placeCell(
	cells: GridCell[],
	block: GridCell,
	col: number,
	row: number,
	columns: number
): GridCell[] {
	const c = Math.min(Math.max(col, 0), columns - 1);
	const span = Math.min(Math.max(block.colSpan, 1), columns - c);
	const placed: GridCell = { ...block, col: c, colSpan: span, row: Math.max(row, 0) };
	return finalize([...cells.filter((x) => x.id !== placed.id), placed], placed.id);
}

// Insert a block into a plain (rowSpan-1, no spanning) row and re-tile that row evenly.
export function insertIntoRow(
	cells: GridCell[],
	block: GridCell,
	row: number,
	index: number,
	columns: number
): GridCell[] {
	const others = cells.filter((c) => c.row !== row && c.id !== block.id);
	const rowCells = cells.filter((c) => c.row === row && c.id !== block.id).sort((a, b) => a.col - b.col);
	const list = [...rowCells];
	list.splice(Math.min(Math.max(index, 0), list.length), 0, block);
	const spans = evenSpans(list.length, columns);
	let col = 0;
	const tiled = list.map((c, i) => {
		const nc: GridCell = { ...c, row, col, colSpan: spans[i], rowSpan: 1 };
		col += spans[i];
		return nc;
	});
	return [...others, ...tiled];
}

// Set a block's row-span (the bottom-gutter op); colliding cells flow down.
export function setRowSpan(cells: GridCell[], id: string, rowSpan: number): GridCell[] {
	const next = cells.map((c) => (c.id === id ? { ...c, rowSpan: Math.max(rowSpan, 1) } : c));
	return finalize(next, id);
}

// Move the shared boundary between two horizontally-adjacent cells: the left cell
// takes `leftColSpan`, the right absorbs the rest of their shared width.
export function setColGutter(
	cells: GridCell[],
	leftId: string,
	rightId: string,
	leftColSpan: number
): GridCell[] {
	const left = cells.find((c) => c.id === leftId);
	const right = cells.find((c) => c.id === rightId);
	if (!left || !right) return cells;
	const pair = left.colSpan + right.colSpan;
	const l = Math.min(Math.max(leftColSpan, 1), pair - 1);
	const next = cells.map((c) => {
		if (c.id === leftId) return { ...c, colSpan: l };
		if (c.id === rightId) return { ...c, col: left.col + l, colSpan: pair - l };
		return c;
	});
	// If either cell row-spans, widening it can collide with cells in the spanned
	// rows below — push those out, then compact so they spring back on narrowing.
	return finalize(next, leftId);
}

export function removeBlock(cells: GridCell[], id: string): GridCell[] {
	return compact(cells.filter((c) => c.id !== id));
}

// A row is "plain" if it holds cells, all rowSpan 1, with nothing spanning into it
// from above — the case where dropping should distribute the row evenly.
export function isPlainRow(cells: GridCell[], row: number): boolean {
	const atRow = cells.filter((c) => c.row === row);
	if (!atRow.length) return false;
	if (atRow.some((c) => c.rowSpan !== 1)) return false;
	if (cells.some((c) => c.row < row && c.row + c.rowSpan > row)) return false;
	return true;
}

// The cell immediately to the right of `cell` whose row range overlaps it.
export function rightNeighbor(cells: GridCell[], cell: GridCell): GridCell | null {
	return (
		cells.find(
			(c) =>
				c.id !== cell.id &&
				c.col === cell.col + cell.colSpan &&
				c.row < cell.row + cell.rowSpan &&
				cell.row < c.row + c.rowSpan
		) ?? null
	);
}

// Apply a drag drop (used for both the live preview and the commit). `cells` is the
// drag base (the dragged block already removed when moving). Returns the new layout.
export function planDrop(
	cells: GridCell[],
	block: GridCell,
	target: DropTarget,
	columns: number
): GridCell[] {
	if (target.mode === 'new-row') {
		return placeCell(cells, { ...block, col: 0, colSpan: columns }, 0, target.row, columns);
	}
	if (target.mode === 'into-row' && isPlainRow(cells, target.row)) {
		return insertIntoRow(cells, block, target.row, target.index, columns);
	}
	const col = target.mode === 'place' ? target.col : 0;
	return placeCell(cells, block, col, target.row, columns);
}
