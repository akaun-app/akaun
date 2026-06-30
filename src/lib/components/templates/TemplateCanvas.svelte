<script lang="ts">
	import { flip } from 'svelte/animate';
	import { scale } from 'svelte/transition';
	import { GripVertical } from '@lucide/svelte';
	import type { BlockType, GridCell, TemplateLayout } from '$lib/pdf/template-types.js';
	import {
		planDrop, setColGutter, setRowSpan, rightNeighbor, isPlainRow, maxRow, newCell,
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
	let colGutter: { leftId: string; rightId: string; startX: number; startLeft: number; base: GridCell[] } | null = null;
	let rowGutter: { id: string; startY: number; startRowSpan: number; stride: number; base: GridCell[] } | null = null;

	// Geometry snapshot of the committed layout, captured when a drag begins so
	// hit-testing stays stable while the preview reflows.
	type CellSnap = { id: string; col: number; colSpan: number; left: number; right: number };
	type BandSnap = { row: number; top: number; bottom: number; cells: CellSnap[] };
	let snapshot: BandSnap[] = [];

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
	const displayCells = $derived(drag && target ? previewCells : layout.cells);

	function rightNeighborId(cell: GridCell): string | null {
		return rightNeighbor(displayCells, cell)?.id ?? null;
	}

	// ── Snapshot + hit-testing ─────────────────────────────────────────────────
	function captureSnapshot(excludeId?: string) {
		snapshot = [];
		if (!gridEl) return;
		const rows: Record<number, (CellSnap & { top: number; bottom: number })[]> = {};
		let excluded: { row: number; height: number } | null = null;
		for (const el of Array.from(gridEl.querySelectorAll<HTMLElement>('.cell'))) {
			const id = el.dataset.id;
			if (!id || id === PREVIEW_ID) continue;
			const row = parseInt(el.dataset.row ?? '0');
			const r = el.getBoundingClientRect();
			if (id === excludeId) {
				excluded = { row, height: r.height };
				continue;
			}
			(rows[row] ??= []).push({
				id,
				col: parseInt(el.dataset.col ?? '0'),
				colSpan: parseInt(el.dataset.colspan ?? '1'),
				left: r.left,
				right: r.right,
				top: r.top,
				bottom: r.bottom
			});
		}
		// If the dragged cell was the sole occupant of its row, that row collapses once
		// the preview removes it — shift every band below up to match what the user sees.
		const shift = excluded && !rows[excluded.row] ? excluded.height + GAP : 0;
		snapshot = Object.keys(rows)
			.map(Number)
			.sort((a, b) => a - b)
			.map((row) => {
				const cs = rows[row].sort((a, b) => a.left - b.left);
				const dy = shift && excluded && row > excluded.row ? shift : 0;
				return {
					row,
					top: Math.min(...cs.map((c) => c.top)) - dy,
					bottom: Math.max(...cs.map((c) => c.bottom)) - dy,
					cells: cs.map((c) => ({ id: c.id, col: c.col, colSpan: c.colSpan, left: c.left, right: c.right }))
				};
			});
	}

	function colFromX(x: number): number {
		if (!gridEl) return 0;
		const rect = gridEl.getBoundingClientRect();
		const colW = (rect.width - (columns - 1) * GAP) / columns;
		const stride = colW + GAP;
		return Math.min(columns - 1, Math.max(0, Math.floor((x - rect.left) / stride)));
	}

	function computeTarget(x: number, y: number): DropTarget {
		if (!snapshot.length) return { mode: 'new-row', row: 0 };
		for (const b of snapshot) {
			if (y < b.top) return { mode: 'new-row', row: b.row }; // in the gap above this band
			if (y <= b.bottom) {
				if (isPlainRow(baseCells, b.row)) {
					let index = b.cells.length;
					for (let j = 0; j < b.cells.length; j++) {
						const mid = (b.cells[j].left + b.cells[j].right) / 2;
						if (x < mid) { index = j; break; }
					}
					return { mode: 'into-row', row: b.row, index };
				}
				return { mode: 'place', col: colFromX(x), row: b.row };
			}
		}
		return { mode: 'new-row', row: maxRow(baseCells) }; // below everything
	}

	function sameTarget(a: DropTarget | null, b: DropTarget | null): boolean {
		if (a === b) return true;
		if (!a || !b || a.mode !== b.mode) return false;
		if (a.mode === 'new-row' && b.mode === 'new-row') return a.row === b.row;
		if (a.mode === 'into-row' && b.mode === 'into-row') return a.row === b.row && a.index === b.index;
		if (a.mode === 'place' && b.mode === 'place') return a.col === b.col && a.row === b.row;
		return false;
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
		if (!drag) {
			const dist = Math.hypot(e.clientX - pending.startX, e.clientY - pending.startY);
			if (dist <= 4) return;
			captureSnapshot(pending.id); // base = layout minus the dragged cell
			drag = { mode: 'move', id: pending.id, type: pending.type, colSpan: pending.colSpan, rowSpan: pending.rowSpan, ghostX: e.clientX, ghostY: e.clientY };
		}
		drag.ghostX = e.clientX;
		drag.ghostY = e.clientY;
		// Only rebuild the preview when the drop slot actually changes (avoids flip thrash).
		const next = computeTarget(e.clientX, e.clientY);
		if (!sameTarget(target, next)) target = next;
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
		snapshot = [];
		window.removeEventListener('pointermove', onMovePointerMove);
		window.removeEventListener('pointerup', onMovePointerUp);
	}

	// ── Column gutter (width) ─────────────────────────────────────────────────
	function onColGutterDown(e: PointerEvent, leftId: string, rightId: string) {
		e.preventDefault();
		e.stopPropagation();
		const left = layout.cells.find((c) => c.id === leftId);
		if (!left) return;
		colGutter = { leftId, rightId, startX: e.clientX, startLeft: left.colSpan, base: layout.cells };
		window.addEventListener('pointermove', onColGutterMove);
		window.addEventListener('pointerup', onColGutterUp);
	}
	function onColGutterMove(e: PointerEvent) {
		if (!colGutter || !gridEl) return;
		const colW = (gridEl.getBoundingClientRect().width - (columns - 1) * GAP) / columns;
		const deltaCols = Math.round((e.clientX - colGutter.startX) / (colW + GAP));
		onApply(setColGutter(colGutter.base, colGutter.leftId, colGutter.rightId, colGutter.startLeft + deltaCols));
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
			captureSnapshot();
			drag = { mode: 'palette', colSpan: columns, rowSpan: 1, ghostX: 0, ghostY: 0 };
		}
	}
	function onGridDragOver(e: DragEvent) {
		if (!e.dataTransfer?.types.includes('application/x-block-type')) return;
		e.preventDefault();
		if (!drag) onGridDragEnter(e);
		const next = computeTarget(e.clientX, e.clientY);
		if (!sameTarget(target, next)) target = next;
	}
	function endPaletteDrag() {
		drag = null;
		target = null;
		snapshot = [];
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
							onpointerdown={(e) => onColGutterDown(e, cell.id, rn)}></span>
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
