<script lang="ts">
	import { flip } from 'svelte/animate';
	import { scale } from 'svelte/transition';
	import { GripVertical } from '@lucide/svelte';
	import type { BlockType, GridCell, TemplateLayout } from '$lib/pdf/template-types.js';
	import {
		planDrop, setColBoundary, setRowSpan, rightNeighbor, isPlainRow, freeRunAt, newCell,
		type DropTarget
	} from './grid-ops.js';

	type Props = {
		layout: TemplateLayout;
		columns: number;
		selectedBlockId: string | null;
		themeColor: string;
		onSelectBlock: (id: string) => void;
		onApply: (cells: GridCell[]) => void;
		onDeleteBlock: (id: string) => void;
	};

	let {
		layout, columns, selectedBlockId, themeColor,
		onSelectBlock, onApply, onDeleteBlock
	}: Props = $props();

	const PREVIEW_ID = '__preview__';
	const GAP = 8; // must match the grid's `gap` in CSS

	let gridEl = $state<HTMLDivElement | null>(null);

	// Drag (move existing cell, or drop from palette)
	let drag = $state<
		| null
		| { mode: 'move' | 'palette'; id?: string; type?: BlockType; colSpan: number; rowSpan: number; ghostX: number; ghostY: number }
	>(null);
	let target = $state<DropTarget | null>(null);
	// Pre-threshold pointer info for a potential move (distinguishes click vs drag)
	let pending: { id: string; type: BlockType; colSpan: number; rowSpan: number; startX: number; startY: number } | null = null;

	// Column gutter (width) and row gutter (height / rowSpan) drags
	let colGutter: { leftId: string; startX: number; base: GridCell[] } | null = null;
	let rowGutter: { id: string; startY: number; startRowSpan: number; stride: number; base: GridCell[] } | null = null;

	// Geometry snapshot of the drag base (baseCells), captured once when a drag begins.
	// Row geometry uses the grid's disjoint row tracks (so a row-spanning cell can't
	// shadow the rows beneath it); cells carry their rects for into-row indexing.
	// Because baseCells is constant for the whole drag, this never goes stale.
	type CellSnap = { id: string; row: number; col: number; colSpan: number; left: number; right: number; top: number; bottom: number };
	type Snapshot = { tops: number[]; heights: number[]; cells: CellSnap[] };
	let snapshot: Snapshot = { tops: [], heights: [], cells: [] };
	let lastX = 0;
	let lastY = 0;

	function blockLabel(type: GridCell['type']): string {
		const LABELS: Record<GridCell['type'], string> = {
			'company-name':    'Company Name',
			'company-address': 'Company Address',
			'company-reg-info':'Reg Info',
			'document-title':  'Doc Title',
			'document-meta':   'Document Meta',
			'customer-block':  'Customer',
			'line-items-table':'Line Items Table',
			'totals-block':    'Totals',
			notes:             'Notes',
			'paid-stamp':      'Paid Stamp',
			'issued-by':       'Issued By',
			text:              'Text Block',
			image:             'Image',
			divider:           'Divider',
			spacer:            'Spacer'
		};
		return LABELS[type] ?? type;
	}

	// ── Render source: committed cells, or a live make-room preview while dragging ──
	const baseCells = $derived(
		drag?.mode === 'move' && drag.id
			? layout.cells.filter((c) => c.id !== drag!.id)
			: layout.cells
	);
	const previewCells = $derived.by(() => {
		if (!drag || !target) return layout.cells;
		const ph: GridCell = {
			id: PREVIEW_ID,
			type: drag.type ?? 'text',
			config: {},
			style: {},
			col: 0,
			row: 0,
			colSpan: drag.colSpan,
			rowSpan: drag.rowSpan
		};
		return planDrop(baseCells, ph, target, columns);
	});
	// While a drag is starting (before the first target) show baseCells — the dragged
	// cell already removed, no placeholder — so the snapshot frame measures the true base.
	const displayCells = $derived(drag ? (target ? previewCells : baseCells) : layout.cells);

	function rightNeighborId(cell: GridCell): string | null {
		return rightNeighbor(displayCells, cell)?.id ?? null;
	}

	// ── Snapshot + hit-testing ─────────────────────────────────────────────────
	function captureSnapshot() {
		if (!gridEl) {
			snapshot = { tops: [], heights: [], cells: [] };
			return;
		}
		const cs = getComputedStyle(gridEl);
		const heights = cs.gridTemplateRows.split(' ').map(parseFloat).filter((n) => !Number.isNaN(n));
		const rowGap = parseFloat(cs.rowGap) || GAP;
		const rect = gridEl.getBoundingClientRect();
		let y = rect.top + (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.paddingTop) || 0);
		const tops: number[] = [];
		for (const h of heights) {
			tops.push(y);
			y += h + rowGap;
		}
		const cells: CellSnap[] = [];
		for (const el of Array.from(gridEl.querySelectorAll<HTMLElement>('.cell'))) {
			const id = el.dataset.id;
			if (!id || id === PREVIEW_ID) continue;
			const r = el.getBoundingClientRect();
			cells.push({
				id,
				row: parseInt(el.dataset.row ?? '0'),
				col: parseInt(el.dataset.col ?? '0'),
				colSpan: parseInt(el.dataset.colspan ?? '1'),
				left: r.left,
				right: r.right,
				top: r.top,
				bottom: r.bottom
			});
		}
		snapshot = { tops, heights, cells };
	}

	function colFromX(x: number): number {
		if (!gridEl) return 0;
		const rect = gridEl.getBoundingClientRect();
		const colW = (rect.width - (columns - 1) * GAP) / columns;
		const stride = colW + GAP;
		return Math.min(columns - 1, Math.max(0, Math.floor((x - rect.left) / stride)));
	}

	function computeTarget(x: number, y: number): DropTarget {
		const { tops, heights, cells } = snapshot;
		if (!tops.length) return { mode: 'new-row', row: 0 };

		// Over a block → edge zones: bottom edge stacks below it; otherwise add a column on
		// the side the cursor is on (plain rows only). Non-plain rows can only stack.
		const C = cells.find((c) => x >= c.left && x <= c.right && y >= c.top && y <= c.bottom);
		if (C) {
			const edgeV = Math.min(Math.max((C.bottom - C.top) * 0.33, 14), 28);
			if (y > C.bottom - edgeV) return { mode: 'stack-below', targetId: C.id };
			if (isPlainRow(baseCells, C.row)) {
				const rowCells = cells.filter((c) => c.row === C.row).sort((a, b) => a.left - b.left);
				const pos = rowCells.findIndex((c) => c.id === C.id);
				const index = pos + (x < (C.left + C.right) / 2 ? 0 : 1);
				return { mode: 'into-row', row: C.row, index };
			}
			return { mode: 'stack-below', targetId: C.id };
		}

		// Not over a block → find the row track / gap from the pointer-y.
		if (y < tops[0]) return { mode: 'new-row', row: 0 };
		let row = -1;
		for (let i = 0; i < tops.length; i++) {
			if (y <= tops[i] + heights[i]) { row = i; break; } // inside row track i
			const nextTop = tops[i + 1];
			if (nextTop != null && y < nextTop) return { mode: 'new-row', row: i + 1 }; // gap below row i
		}
		if (row === -1) return { mode: 'new-row', row: tops.length }; // below everything

		// Inside a row but not over a block → fill the free columns beside a spanning cell,
		// else a full-width new row.
		const run = freeRunAt(baseCells, colFromX(x), row, columns);
		if (run) return { mode: 'place', col: run.col, row, colSpan: run.colSpan };
		return { mode: 'new-row', row };
	}

	function sameTarget(a: DropTarget | null, b: DropTarget | null): boolean {
		if (a === b) return true;
		if (!a || !b || a.mode !== b.mode) return false;
		if (a.mode === 'new-row' && b.mode === 'new-row') return a.row === b.row;
		if (a.mode === 'into-row' && b.mode === 'into-row') return a.row === b.row && a.index === b.index;
		if (a.mode === 'place' && b.mode === 'place') return a.col === b.col && a.row === b.row && a.colSpan === b.colSpan;
		if (a.mode === 'stack-below' && b.mode === 'stack-below') return a.targetId === b.targetId;
		return false;
	}

	// Capture the base geometry one frame after the drag base is rendered, then set the
	// initial target. baseCells stays constant, so this snapshot is valid for the whole drag.
	function scheduleCapture() {
		requestAnimationFrame(() => {
			if (!drag) return;
			captureSnapshot();
			const next = computeTarget(lastX, lastY);
			if (!sameTarget(target, next)) target = next;
		});
	}

	function updateTarget(x: number, y: number) {
		lastX = x;
		lastY = y;
		if (!snapshot.tops.length) return; // snapshot not ready yet — scheduleCapture will set it
		const next = computeTarget(x, y);
		if (!sameTarget(target, next)) target = next;
	}

	// ── Move (pointer) ─────────────────────────────────────────────────────────
	function onCellPointerDown(e: PointerEvent, cell: GridCell) {
		if (e.button !== 0 || cell.id === PREVIEW_ID) return;
		pending = { id: cell.id, type: cell.type, colSpan: cell.colSpan, rowSpan: cell.rowSpan, startX: e.clientX, startY: e.clientY };
		window.addEventListener('pointermove', onMovePointerMove);
		window.addEventListener('pointerup', onMovePointerUp);
	}

	function onMovePointerMove(e: PointerEvent) {
		if (!pending) return;
		lastX = e.clientX;
		lastY = e.clientY;
		if (!drag) {
			const dist = Math.hypot(e.clientX - pending.startX, e.clientY - pending.startY);
			if (dist <= 4) return;
			// Render baseCells (dragged cell removed) first; measure it next frame.
			drag = { mode: 'move', id: pending.id, type: pending.type, colSpan: pending.colSpan, rowSpan: pending.rowSpan, ghostX: e.clientX, ghostY: e.clientY };
			scheduleCapture();
			return;
		}
		drag.ghostX = e.clientX;
		drag.ghostY = e.clientY;
		updateTarget(e.clientX, e.clientY);
	}

	function onMovePointerUp() {
		if (drag?.id && target) {
			const block = layout.cells.find((c) => c.id === drag!.id);
			if (block) onApply(planDrop(baseCells, block, target, columns));
			onSelectBlock(drag.id);
		} else if (pending && !drag) {
			onSelectBlock(pending.id);
		}
		drag = null;
		target = null;
		pending = null;
		snapshot = { tops: [], heights: [], cells: [] };
		window.removeEventListener('pointermove', onMovePointerMove);
		window.removeEventListener('pointerup', onMovePointerUp);
	}

	// ── Column gutter (width) — moves the whole boundary, including any stack beside it ──
	function onColGutterDown(e: PointerEvent, leftId: string) {
		e.preventDefault();
		e.stopPropagation();
		colGutter = { leftId, startX: e.clientX, base: layout.cells };
		window.addEventListener('pointermove', onColGutterMove);
		window.addEventListener('pointerup', onColGutterUp);
	}
	function onColGutterMove(e: PointerEvent) {
		if (!colGutter || !gridEl) return;
		const colW = (gridEl.getBoundingClientRect().width - (columns - 1) * GAP) / columns;
		const deltaCols = Math.round((e.clientX - colGutter.startX) / (colW + GAP));
		onApply(setColBoundary(colGutter.base, colGutter.leftId, deltaCols));
	}
	function onColGutterUp() {
		colGutter = null;
		window.removeEventListener('pointermove', onColGutterMove);
		window.removeEventListener('pointerup', onColGutterUp);
	}

	// ── Row gutter (height / rowSpan) ─────────────────────────────────────────
	function onRowGutterDown(e: PointerEvent, cell: GridCell) {
		e.preventDefault();
		e.stopPropagation();
		const el = (e.currentTarget as HTMLElement).closest('.cell') as HTMLElement | null;
		const h = el ? el.getBoundingClientRect().height : 46;
		const perRow = (h - (cell.rowSpan - 1) * GAP) / cell.rowSpan;
		rowGutter = { id: cell.id, startY: e.clientY, startRowSpan: cell.rowSpan, stride: perRow + GAP, base: layout.cells };
		window.addEventListener('pointermove', onRowGutterMove);
		window.addEventListener('pointerup', onRowGutterUp);
	}
	function onRowGutterMove(e: PointerEvent) {
		if (!rowGutter) return;
		const deltaRows = Math.round((e.clientY - rowGutter.startY) / rowGutter.stride);
		onApply(setRowSpan(rowGutter.base, rowGutter.id, rowGutter.startRowSpan + deltaRows));
	}
	function onRowGutterUp() {
		rowGutter = null;
		window.removeEventListener('pointermove', onRowGutterMove);
		window.removeEventListener('pointerup', onRowGutterUp);
	}

	// ── Palette drop (HTML5 DnD) ───────────────────────────────────────────────
	function onGridDragEnter(e: DragEvent) {
		if (!e.dataTransfer?.types.includes('application/x-block-type')) return;
		if (!drag) {
			drag = { mode: 'palette', colSpan: columns, rowSpan: 1, ghostX: 0, ghostY: 0 };
			scheduleCapture();
		}
	}
	function onGridDragOver(e: DragEvent) {
		if (!e.dataTransfer?.types.includes('application/x-block-type')) return;
		e.preventDefault();
		if (!drag) onGridDragEnter(e);
		updateTarget(e.clientX, e.clientY);
	}
	function endPaletteDrag() {
		drag = null;
		target = null;
		snapshot = { tops: [], heights: [], cells: [] };
	}
	function onGridDrop(e: DragEvent) {
		e.preventDefault();
		const type = e.dataTransfer?.getData('application/x-block-type') as BlockType | undefined;
		if (type && target) {
			const block = newCell(type, columns);
			onApply(planDrop(baseCells, block, target, columns));
			onSelectBlock(block.id);
		}
		endPaletteDrag();
	}
</script>

<div class="canvas">
	<div
		class="grid"
		bind:this={gridEl}
		role="application"
		aria-label="Template grid"
		style="grid-template-columns: repeat({columns}, 1fr); --theme: {themeColor};"
		ondragenter={onGridDragEnter}
		ondragover={onGridDragOver}
		ondragleave={(e) => { if (e.relatedTarget === null) endPaletteDrag(); }}
		ondrop={onGridDrop}
	>
		{#each displayCells as cell (cell.id)}
			{@const isPreview = cell.id === PREVIEW_ID}
			{@const rn = isPreview ? null : rightNeighborId(cell)}
			<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
			<div
				class="cell"
				class:placeholder={isPreview}
				class:selected={cell.id === selectedBlockId}
				class:dragging={drag?.id === cell.id}
				data-id={cell.id}
				data-row={cell.row}
				data-col={cell.col}
				data-colspan={cell.colSpan}
				style="grid-column: {cell.col + 1} / span {cell.colSpan}; grid-row: {cell.row + 1} / span {cell.rowSpan};"
				animate:flip={{ duration: 180 }}
				in:scale={{ duration: 150, start: 0.85 }}
				role={isPreview ? undefined : 'button'}
				tabindex={isPreview ? undefined : 0}
				aria-hidden={isPreview ? 'true' : undefined}
				onpointerdown={(e) => onCellPointerDown(e, cell)}
				onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectBlock(cell.id); } }}
			>
				{#if !isPreview}
					<span class="cell-grip"><GripVertical size={12} /></span>
					<span class="cell-label">{blockLabel(cell.type)}</span>
					<button class="cell-del" title="Remove block"
						onpointerdown={(e) => e.stopPropagation()}
						onclick={(e) => { e.stopPropagation(); onDeleteBlock(cell.id); }}>×</button>

					{#if rn}
						<span class="col-gutter" role="separator" aria-label="Resize width" title="Drag to resize width"
							onpointerdown={(e) => onColGutterDown(e, cell.id)}></span>
					{/if}
					<span class="row-gutter" role="separator" aria-label="Resize height" title="Drag to span rows"
						onpointerdown={(e) => onRowGutterDown(e, cell)}></span>
				{/if}
			</div>
		{/each}

		{#if displayCells.length === 0}
			<div class="grid-empty">Drag blocks here or click one in the palette</div>
		{/if}
	</div>

	{#if drag?.mode === 'move' && drag.type}
		<div class="drag-ghost" style="left: {drag.ghostX}px; top: {drag.ghostY}px;">
			<GripVertical size={12} /> {blockLabel(drag.type)}
		</div>
	{/if}
</div>

<style>
	.canvas { display: flex; flex-direction: column; }

	.grid {
		display: grid;
		grid-auto-rows: minmax(46px, auto);
		gap: 8px;
		position: relative;
		border-top: 3px solid var(--theme, var(--primary));
		padding: 14px 0 40px;
		min-height: 320px;
	}

	.cell {
		position: relative;
		display: flex; align-items: center; gap: 6px;
		padding: 8px 26px 8px 10px;
		border-radius: 6px; border: 1px solid var(--border); background: var(--background);
		font-size: 12px; color: var(--foreground);
		cursor: grab; user-select: none; touch-action: none;
		transition: border-color 0.12s, background 0.12s, box-shadow 0.12s;
		/* visible (not hidden) so the gutters can sit in the gaps; .cell-label clips its own text */
		overflow: visible;
	}
	.cell:hover { border-color: var(--primary); background: var(--accent); }
	.cell.selected { border-color: var(--primary); background: color-mix(in srgb, var(--primary) 8%, var(--background)); box-shadow: 0 0 0 1px var(--primary); }
	.cell.dragging { opacity: 0.35; }
	.cell-grip { color: var(--muted-foreground); flex-shrink: 0; }
	.cell-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.cell-del {
		position: absolute; top: 4px; right: 6px;
		background: none; border: none; padding: 0 2px;
		font-size: 16px; line-height: 1; color: var(--muted-foreground);
		cursor: pointer; opacity: 0; transition: opacity 0.1s;
	}
	.cell:hover .cell-del { opacity: 1; }
	.cell-del:hover { color: var(--destructive); }

	/* Gutters — centered on the 8px gap between this cell and its neighbour, so the
	   user grabs the divider between two blocks, not one block's edge. */
	.col-gutter {
		position: absolute; top: 6px; bottom: 6px; right: -12px; width: 16px;
		cursor: col-resize; z-index: 3;
		display: flex; align-items: center; justify-content: center;
	}
	.col-gutter::before {
		content: ''; width: 2px; height: 100%; border-radius: 2px;
		background: var(--border); transition: background 0.12s, width 0.12s;
	}
	.col-gutter:hover::before { background: var(--primary); width: 3px; }

	.row-gutter {
		position: absolute; left: 6px; right: 14px; bottom: -12px; height: 16px;
		cursor: row-resize; z-index: 3;
		display: flex; align-items: center; justify-content: center;
	}
	.row-gutter::before {
		content: ''; height: 2px; width: 100%; border-radius: 2px;
		background: var(--border); transition: background 0.12s, height 0.12s;
		opacity: 0;
	}
	.cell:hover .row-gutter::before { opacity: 1; }
	.row-gutter:hover::before { background: var(--primary); height: 3px; }

	/* Drop placeholder — the slot that opens to make room */
	.cell.placeholder {
		border: 2px dashed var(--primary);
		background: color-mix(in srgb, var(--primary) 10%, transparent);
		cursor: default;
		pointer-events: none;
		animation: ph-pulse 0.9s ease-in-out infinite alternate;
	}
	@keyframes ph-pulse { from { opacity: 0.55; } to { opacity: 1; } }

	.grid-empty {
		grid-column: 1 / -1;
		display: flex; align-items: center; justify-content: center;
		min-height: 120px; border: 1px dashed var(--border); border-radius: 8px;
		font-size: 12px; color: var(--muted-foreground);
	}

	/* Floating drag ghost */
	.drag-ghost {
		position: fixed; z-index: 50; pointer-events: none;
		transform: translate(-50%, -50%);
		display: flex; align-items: center; gap: 6px;
		padding: 7px 12px; border-radius: 6px;
		border: 1px solid var(--primary); background: var(--background);
		font-size: 12px; color: var(--foreground);
		box-shadow: 0 6px 18px rgba(0, 0, 0, 0.18);
	}
</style>
