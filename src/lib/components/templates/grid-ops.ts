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
	| { mode: 'place'; col: number; row: number; colSpan: number }
	| { mode: 'stack-below'; targetId: string };

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

// Move a whole vertical column boundary by `deltaCols`. Grabbing the gutter on cell
// `leftId` identifies the boundary X = left.col + left.colSpan; every cell touching X —
// left side (`col + colSpan === X`) and right side (`col === X`) — within the connected
// row band moves together, so a tall cell and the full stack of cells beside it stay
// aligned. Left cells widen by d, right cells shift right by d; the boundary stays
// straight, so no overlaps are introduced and no resolve/compact is needed.
export function setColBoundary(cells: GridCell[], leftId: string, deltaCols: number): GridCell[] {
	const seed = cells.find((c) => c.id === leftId);
	if (!seed) return cells;
	const X = seed.col + seed.colSpan;
	const touches = (c: GridCell) => c.col + c.colSpan === X || c.col === X;
	const overlapsRange = (c: GridCell, lo: number, hi: number) => c.row < hi && lo < c.row + c.rowSpan;

	// BFS: grow the row range to pull in every boundary-touching cell that connects to it.
	let lo = seed.row;
	let hi = seed.row + seed.rowSpan;
	const involved = new Set<GridCell>([seed]);
	for (;;) {
		let grew = false;
		for (const c of cells) {
			if (involved.has(c) || !touches(c) || !overlapsRange(c, lo, hi)) continue;
			involved.add(c);
			lo = Math.min(lo, c.row);
			hi = Math.max(hi, c.row + c.rowSpan);
			grew = true;
		}
		if (!grew) break;
	}

	const leftCells = [...involved].filter((c) => c.col + c.colSpan === X);
	const rightCells = [...involved].filter((c) => c.col === X);
	if (!leftCells.length || !rightCells.length) return cells;

	const minLeft = Math.min(...leftCells.map((c) => c.colSpan));
	const minRight = Math.min(...rightCells.map((c) => c.colSpan));
	const d = Math.min(Math.max(deltaCols, 1 - minLeft), minRight - 1);
	if (d === 0) return cells;

	return cells.map((c) => {
		if (leftCells.includes(c)) return { ...c, colSpan: c.colSpan + d };
		if (rightCells.includes(c)) return { ...c, col: c.col + d, colSpan: c.colSpan - d };
		return c;
	});
}

export function removeBlock(cells: GridCell[], id: string, columns: number): GridCell[] {
	const removed = cells.find((c) => c.id === id);
	let rest = cells.filter((c) => c.id !== id);
	// If the removed cell's row is still a plain row, re-tile its remaining cells evenly so
	// they use up the freed space instead of leaving a gap.
	if (removed && isPlainRow(rest, removed.row)) {
		const rowCells = rest.filter((c) => c.row === removed.row).sort((a, b) => a.col - b.col);
		if (rowCells.length) {
			const spans = evenSpans(rowCells.length, columns);
			let col = 0;
			const tiled = rowCells.map((c, i) => {
				const nc: GridCell = { ...c, col, colSpan: spans[i] };
				col += spans[i];
				return nc;
			});
			rest = [...rest.filter((c) => c.row !== removed.row), ...tiled];
		}
	}
	return compact(rest);
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

// Which columns of `row` are occupied — including cells that span into it from above.
export function occupancyAt(cells: GridCell[], row: number, columns: number): boolean[] {
	const occ = new Array<boolean>(columns).fill(false);
	for (const c of cells) {
		if (c.row <= row && row < c.row + c.rowSpan) {
			for (let i = c.col; i < c.col + c.colSpan && i < columns; i++) occ[i] = true;
		}
	}
	return occ;
}

// The contiguous run of free columns in `row` containing `col`, or null if `col` is occupied.
export function freeRunAt(
	cells: GridCell[],
	col: number,
	row: number,
	columns: number
): { col: number; colSpan: number } | null {
	const occ = occupancyAt(cells, row, columns);
	if (col < 0 || col >= columns || occ[col]) return null;
	let start = col;
	while (start > 0 && !occ[start - 1]) start--;
	let end = col;
	while (end < columns - 1 && !occ[end + 1]) end++;
	return { col: start, colSpan: end - start + 1 };
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

// Place `block` directly below `targetId`, in the target's columns. A new grid row is
// opened just under the target and the target's siblings (cells beside it) auto-span down
// to cover it — so a partial target grows a stacked column, while a full-width target just
// gets a plain new row below it.
export function stackBelow(cells: GridCell[], targetId: string, block: GridCell): GridCell[] {
	const target = cells.find((c) => c.id === targetId);
	if (!target) return cells;
	const B = target.row + target.rowSpan; // the new row index, just under the target
	const tLo = target.row;
	const tHi = target.row + target.rowSpan;

	const shifted = cells.map((c) => {
		if (c.id === targetId) return c;
		if (c.row >= B) return { ...c, row: c.row + 1 }; // pushed below the new row
		if (c.row < B && c.row + c.rowSpan > B) return { ...c, rowSpan: c.rowSpan + 1 }; // spans across B
		// sibling sharing the target's rows → extend it to cover the new row
		if (c.row < tHi && tLo < c.row + c.rowSpan) {
			return { ...c, rowSpan: Math.max(c.rowSpan, B + 1 - c.row) };
		}
		return c;
	});

	const placed: GridCell = { ...block, col: target.col, colSpan: target.colSpan, row: B, rowSpan: 1 };
	return [...shifted.filter((c) => c.id !== placed.id), placed];
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
	if (target.mode === 'stack-below') {
		return stackBelow(cells, target.targetId, block);
	}
	if (target.mode === 'into-row' && isPlainRow(cells, target.row)) {
		return insertIntoRow(cells, block, target.row, target.index, columns);
	}
	if (target.mode === 'place') {
		return placeCell(cells, { ...block, colSpan: target.colSpan }, target.col, target.row, columns);
	}
	// into-row on a non-plain row → fall back to placing at the row start.
	return placeCell(cells, block, 0, target.row, columns);
}
