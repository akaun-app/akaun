<script lang="ts">
	import { flip } from 'svelte/animate';
	import { scale } from 'svelte/transition';
	import { GripVertical } from '@lucide/svelte';
	import type { BlockType, GridCell, TemplateLayout } from '$lib/pdf/template-types.js';

	type Props = {
		layout: TemplateLayout;
		selectedBlockId: string | null;
		themeColor: string;
		onSelectBlock: (id: string) => void;
		onAddCell: (type: BlockType, col: number, row: number, colSpan?: number) => void;
		onMoveCell: (id: string, col: number, row: number) => void;
		onResizeCell: (id: string, colSpan: number, rowSpan: number) => void;
		onDeleteBlock: (id: string) => void;
	};

	let {
		layout, selectedBlockId, themeColor,
		onSelectBlock, onAddCell, onMoveCell, onResizeCell, onDeleteBlock
	}: Props = $props();

	const GAP = 8;
	const ROW_UNIT = 54; // nominal px per grid row, used for resize/hit-test deltas
	const columns = $derived(layout.columns || 6);

	let gridEl = $state<HTMLDivElement | null>(null);

	// Pointer-drag (move) state
	let drag = $state<{ id: string; colSpan: number; label: string; ghostX: number; ghostY: number } | null>(null);
	let dropTarget = $state<{ col: number; row: number; colSpan: number } | null>(null);
	// Pending interaction before threshold is crossed (click vs drag)
	let pending: { id: string; startX: number; startY: number; moved: boolean } | null = null;
	// Resize state (read in markup → must be reactive)
	let resize = $state<{ id: string; axis: 'x' | 'y' | 'xy'; startX: number; startY: number; startCols: number; startRows: number } | null>(null);
	// HTML5 palette drop target
	let paletteTarget = $state<{ col: number; row: number } | null>(null);

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

	// ── Geometry: map a client point to a grid (col, row) ──────────────────────
	function colFromX(clientX: number): number {
		if (!gridEl) return 0;
		const rect = gridEl.getBoundingClientRect();
		const stride = (rect.width + GAP) / columns;
		return Math.min(columns - 1, Math.max(0, Math.floor((clientX - rect.left) / stride)));
	}

	function rowFromY(clientY: number): number {
		if (!gridEl) return 0;
		const rect = gridEl.getBoundingClientRect();
		const styles = getComputedStyle(gridEl);
		const tracks = styles.gridTemplateRows.split(' ').map((v) => parseFloat(v)).filter((n) => !Number.isNaN(n));
		const gap = parseFloat(styles.rowGap) || GAP;
		let y = rect.top;
		for (let i = 0; i < tracks.length; i++) {
			if (clientY < y + tracks[i]) return i;
			y += tracks[i] + gap;
		}
		return tracks.length; // below the last track → a fresh row
	}

	// ── Move (pointer) ─────────────────────────────────────────────────────────
	function onCellPointerDown(e: PointerEvent, cell: GridCell) {
		if (e.button !== 0) return;
		pending = { id: cell.id, startX: e.clientX, startY: e.clientY, moved: false };
		window.addEventListener('pointermove', onWindowPointerMove);
		window.addEventListener('pointerup', onWindowPointerUp);
	}

	function beginDrag(cell: GridCell, e: PointerEvent) {
		drag = {
			id: cell.id,
			colSpan: cell.colSpan,
			label: blockLabel(cell.type),
			ghostX: e.clientX,
			ghostY: e.clientY
		};
	}

	function onWindowPointerMove(e: PointerEvent) {
		if (resize) {
			const dCols = Math.round((e.clientX - resize.startX) / colTrackPx());
			const dRows = Math.round((e.clientY - resize.startY) / ROW_UNIT);
			const cols = resize.axis === 'y' ? resize.startCols : resize.startCols + dCols;
			const rows = resize.axis === 'x' ? resize.startRows : resize.startRows + dRows;
			onResizeCell(resize.id, cols, rows);
			return;
		}
		if (!pending) return;
		const cell = layout.cells.find((c) => c.id === pending!.id);
		if (!cell) return;
		const dist = Math.hypot(e.clientX - pending.startX, e.clientY - pending.startY);
		if (!drag && dist > 4) {
			pending.moved = true;
			beginDrag(cell, e);
		}
		if (drag) {
			drag.ghostX = e.clientX;
			drag.ghostY = e.clientY;
			const col = Math.min(colFromX(e.clientX), columns - drag.colSpan);
			dropTarget = { col: Math.max(0, col), row: rowFromY(e.clientY), colSpan: drag.colSpan };
		}
	}

	function onWindowPointerUp() {
		if (drag && dropTarget) {
			onMoveCell(drag.id, dropTarget.col, dropTarget.row);
		} else if (pending && !pending.moved) {
			onSelectBlock(pending.id);
		}
		drag = null;
		dropTarget = null;
		pending = null;
		window.removeEventListener('pointermove', onWindowPointerMove);
		window.removeEventListener('pointerup', onWindowPointerUp);
	}

	// ── Resize (pointer) ─────────────────────────────────────────────────────
	function colTrackPx(): number {
		if (!gridEl) return 80;
		return (gridEl.getBoundingClientRect().width + GAP) / columns;
	}

	function onResizePointerDown(e: PointerEvent, cell: GridCell, axis: 'x' | 'y' | 'xy') {
		e.preventDefault();
		e.stopPropagation();
		resize = {
			id: cell.id,
			axis,
			startX: e.clientX,
			startY: e.clientY,
			startCols: cell.colSpan,
			startRows: cell.rowSpan
		};
		window.addEventListener('pointermove', onWindowPointerMove);
		window.addEventListener('pointerup', onResizePointerUp);
	}

	function onResizePointerUp() {
		resize = null;
		window.removeEventListener('pointermove', onWindowPointerMove);
		window.removeEventListener('pointerup', onResizePointerUp);
	}

	// ── Palette drop (HTML5 DnD) ───────────────────────────────────────────────
	function onGridDragOver(e: DragEvent) {
		if (!e.dataTransfer?.types.includes('application/x-block-type')) return;
		e.preventDefault();
		paletteTarget = { col: colFromX(e.clientX), row: rowFromY(e.clientY) };
	}

	function onGridDrop(e: DragEvent) {
		const type = e.dataTransfer?.getData('application/x-block-type') as BlockType | undefined;
		if (type && paletteTarget) {
			onAddCell(type, paletteTarget.col, paletteTarget.row, columns);
		}
		paletteTarget = null;
	}

	const placeholder = $derived(
		dropTarget ?? (paletteTarget ? { col: paletteTarget.col, row: paletteTarget.row, colSpan: columns } : null)
	);
</script>

<div class="canvas">
	<div
		class="grid"
		bind:this={gridEl}
		role="application"
		aria-label="Template grid"
		style="grid-template-columns: repeat({columns}, 1fr); --theme: {themeColor};"
		ondragover={onGridDragOver}
		ondragleave={() => (paletteTarget = null)}
		ondrop={onGridDrop}
	>
		{#each layout.cells as cell (cell.id)}
			<div
				class="cell"
				class:selected={cell.id === selectedBlockId}
				class:dragging={drag?.id === cell.id}
				class:resizing={resize?.id === cell.id}
				style="grid-column: {cell.col + 1} / span {cell.colSpan}; grid-row: {cell.row + 1} / span {cell.rowSpan};"
				animate:flip={{ duration: 200 }}
				in:scale={{ duration: 150, start: 0.85 }}
				role="button"
				tabindex="0"
				onpointerdown={(e) => onCellPointerDown(e, cell)}
				onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectBlock(cell.id); } }}
			>
				<span class="cell-grip"><GripVertical size={12} /></span>
				<span class="cell-label">{blockLabel(cell.type)}</span>
				<button class="cell-del" title="Remove block"
					onpointerdown={(e) => e.stopPropagation()}
					onclick={(e) => { e.stopPropagation(); onDeleteBlock(cell.id); }}>×</button>

				<!-- Resize handles -->
				<span class="rh rh-right" role="separator" aria-label="Resize width" title="Resize width"
					onpointerdown={(e) => onResizePointerDown(e, cell, 'x')}></span>
				<span class="rh rh-bottom" role="separator" aria-label="Resize height" title="Resize height"
					onpointerdown={(e) => onResizePointerDown(e, cell, 'y')}></span>
				<span class="rh rh-corner" role="separator" aria-label="Resize block" title="Resize"
					onpointerdown={(e) => onResizePointerDown(e, cell, 'xy')}></span>
			</div>
		{/each}

		{#if placeholder}
			<div class="placeholder"
				style="grid-column: {placeholder.col + 1} / span {placeholder.colSpan}; grid-row: {placeholder.row + 1} / span 1;"></div>
		{/if}

		{#if layout.cells.length === 0 && !placeholder}
			<div class="grid-empty">Drag blocks here or click one in the palette</div>
		{/if}
	</div>

	{#if drag}
		<div class="drag-ghost" style="left: {drag.ghostX}px; top: {drag.ghostY}px;">
			<GripVertical size={12} /> {drag.label}
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
		overflow: hidden;
	}
	.cell:hover { border-color: var(--primary); background: var(--accent); }
	.cell.selected { border-color: var(--primary); background: color-mix(in srgb, var(--primary) 8%, var(--background)); box-shadow: 0 0 0 1px var(--primary); }
	.cell.dragging { opacity: 0.35; }
	.cell.resizing { border-color: var(--primary); border-style: dashed; }
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

	/* Resize handles */
	.rh { position: absolute; opacity: 0; transition: opacity 0.1s; }
	.cell:hover .rh, .cell.resizing .rh { opacity: 1; }
	.rh-right { top: 20%; bottom: 20%; right: 0; width: 7px; cursor: ew-resize; border-right: 2px solid var(--primary); }
	.rh-bottom { left: 20%; right: 20%; bottom: 0; height: 7px; cursor: ns-resize; border-bottom: 2px solid var(--primary); }
	.rh-corner { right: 0; bottom: 0; width: 12px; height: 12px; cursor: nwse-resize; border-right: 2px solid var(--primary); border-bottom: 2px solid var(--primary); border-bottom-right-radius: 6px; }

	/* Drop placeholder */
	.placeholder {
		border: 2px dashed var(--primary);
		border-radius: 6px;
		background: color-mix(in srgb, var(--primary) 10%, transparent);
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
