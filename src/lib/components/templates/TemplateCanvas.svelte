<script lang="ts">
	import { flip } from 'svelte/animate';
	import { scale } from 'svelte/transition';
	import { GripVertical } from '@lucide/svelte';
	import type { BlockType, GridCell, TemplateLayout } from '$lib/pdf/template-types.js';
	import { insertInto, moveBlock, setGutter, newCell } from './grid-ops.js';

	type Target = { row: number; index: number; newRow: boolean };

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

	let gridEl = $state<HTMLDivElement | null>(null);

	// Drag (move existing cell, or drop from palette)
	let drag = $state<
		| null
		| { mode: 'move' | 'palette'; id?: string; type?: BlockType; ghostX: number; ghostY: number }
	>(null);
	let target = $state<Target | null>(null);
	// Pre-threshold pointer info for a potential move (distinguishes click vs drag)
	let pending: { id: string; type: BlockType; startX: number; startY: number } | null = null;

	// Gutter resize
	let gutter: { leftId: string; rightId: string; startX: number; startLeft: number; base: GridCell[] } | null = null;

	// Geometry snapshot of the committed layout, captured when a drag begins so
	// hit-testing stays stable while the preview reflows. Indexed by dense band order.
	type BandSnap = { top: number; bottom: number; cells: { id: string; left: number; right: number }[] };
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
		const placeholder: GridCell = {
			id: PREVIEW_ID,
			type: drag.type ?? 'text',
			config: {},
			style: {},
			col: 0,
			row: 0,
			colSpan: columns,
			rowSpan: 1
		};
		return insertInto(baseCells, placeholder, target.row, target.index, columns, target.newRow);
	});
	const displayCells = $derived(drag && target ? previewCells : layout.cells);

	function rightNeighborId(cell: GridCell): string | null {
		const n = displayCells.find(
			(c) => c.id !== cell.id && c.row === cell.row && c.col === cell.col + cell.colSpan
		);
		return n?.id ?? null;
	}

	// ── Snapshot + hit-testing ─────────────────────────────────────────────────
	function captureSnapshot(excludeId?: string) {
		snapshot = [];
		if (!gridEl) return;
		const rows: Record<number, { id: string; left: number; right: number; top: number; bottom: number }[]> = {};
		for (const el of Array.from(gridEl.querySelectorAll<HTMLElement>('.cell'))) {
			const id = el.dataset.id;
			if (!id || id === PREVIEW_ID || id === excludeId) continue;
			const r = parseInt(el.dataset.row ?? '0');
			const rect = el.getBoundingClientRect();
			(rows[r] ??= []).push({ id, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom });
		}
		snapshot = Object.keys(rows)
			.map(Number)
			.sort((a, b) => a - b)
			.map((r) => {
				const cs = rows[r].sort((a, b) => a.left - b.left);
				return {
					top: Math.min(...cs.map((c) => c.top)),
					bottom: Math.max(...cs.map((c) => c.bottom)),
					cells: cs.map((c) => ({ id: c.id, left: c.left, right: c.right }))
				};
			});
	}

	function computeTarget(x: number, y: number): Target {
		if (!snapshot.length) return { row: 0, index: 0, newRow: true };
		for (let i = 0; i < snapshot.length; i++) {
			const b = snapshot[i];
			// In the gap above this band → open a new row here.
			if (y < b.top) return { row: i, index: 0, newRow: true };
			// Inside the band → join it; pick the insert slot by x.
			if (y <= b.bottom) {
				let index = b.cells.length;
				for (let j = 0; j < b.cells.length; j++) {
					const mid = (b.cells[j].left + b.cells[j].right) / 2;
					if (x < mid) { index = j; break; }
				}
				return { row: i, index, newRow: false };
			}
		}
		return { row: snapshot.length, index: 0, newRow: true };
	}

	// ── Move (pointer) ─────────────────────────────────────────────────────────
	function onCellPointerDown(e: PointerEvent, cell: GridCell) {
		if (e.button !== 0 || cell.id === PREVIEW_ID) return;
		pending = { id: cell.id, type: cell.type, startX: e.clientX, startY: e.clientY };
		window.addEventListener('pointermove', onMovePointerMove);
		window.addEventListener('pointerup', onMovePointerUp);
	}

	function onMovePointerMove(e: PointerEvent) {
		if (!pending) return;
		if (!drag) {
			const dist = Math.hypot(e.clientX - pending.startX, e.clientY - pending.startY);
			if (dist <= 4) return;
			captureSnapshot(pending.id); // base = layout minus the dragged cell
			drag = { mode: 'move', id: pending.id, type: pending.type, ghostX: e.clientX, ghostY: e.clientY };
		}
		drag.ghostX = e.clientX;
		drag.ghostY = e.clientY;
		target = computeTarget(e.clientX, e.clientY);
	}

	function onMovePointerUp() {
		if (drag && drag.id && target) {
			onApply(moveBlock(layout.cells, drag.id, target.row, target.index, columns, target.newRow));
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

	// ── Gutter resize (pointer) ──────────────────────────────────────────────
	function onGutterPointerDown(e: PointerEvent, leftId: string, rightId: string) {
		e.preventDefault();
		e.stopPropagation();
		const left = layout.cells.find((c) => c.id === leftId);
		if (!left) return;
		gutter = { leftId, rightId, startX: e.clientX, startLeft: left.colSpan, base: layout.cells };
		window.addEventListener('pointermove', onGutterPointerMove);
		window.addEventListener('pointerup', onGutterPointerUp);
	}

	function onGutterPointerMove(e: PointerEvent) {
		if (!gutter || !gridEl) return;
		const pxPerCol = gridEl.getBoundingClientRect().width / columns;
		const deltaCols = Math.round((e.clientX - gutter.startX) / pxPerCol);
		onApply(setGutter(gutter.base, gutter.leftId, gutter.rightId, gutter.startLeft + deltaCols, columns));
	}

	function onGutterPointerUp() {
		gutter = null;
		window.removeEventListener('pointermove', onGutterPointerMove);
		window.removeEventListener('pointerup', onGutterPointerUp);
	}

	// ── Palette drop (HTML5 DnD) ───────────────────────────────────────────────
	function onGridDragEnter(e: DragEvent) {
		if (!e.dataTransfer?.types.includes('application/x-block-type')) return;
		if (!drag) {
			captureSnapshot();
			drag = { mode: 'palette', ghostX: 0, ghostY: 0 };
		}
	}

	function onGridDragOver(e: DragEvent) {
		if (!e.dataTransfer?.types.includes('application/x-block-type')) return;
		e.preventDefault();
		if (!drag) onGridDragEnter(e);
		target = computeTarget(e.clientX, e.clientY);
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
			onApply(insertInto(layout.cells, block, target.row, target.index, columns, target.newRow));
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
				style="grid-column: {cell.col + 1} / span {cell.colSpan}; grid-row: {cell.row + 1};"
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
						<span class="col-gutter" role="separator" aria-label="Resize columns" title="Drag to resize"
							onpointerdown={(e) => onGutterPointerDown(e, cell.id, rn)}></span>
					{/if}
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
		overflow: hidden;
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

	/* Column gutter — sits in the gap on the cell's right edge, between neighbours */
	.col-gutter {
		position: absolute; top: 6px; bottom: 6px; right: -8px; width: 16px;
		cursor: col-resize; z-index: 2;
		display: flex; align-items: center; justify-content: center;
	}
	.col-gutter::before {
		content: ''; width: 2px; height: 100%; border-radius: 2px;
		background: var(--border); transition: background 0.12s, width 0.12s;
	}
	.col-gutter:hover::before { background: var(--primary); width: 3px; }

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
