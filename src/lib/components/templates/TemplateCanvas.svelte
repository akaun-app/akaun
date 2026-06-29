<script lang="ts">
	import { GripVertical, Trash2 } from '@lucide/svelte';
	import type { BlockDef, BlockType, TemplateLayout } from '$lib/pdf/template-types.js';

	type Props = {
		layout: TemplateLayout;
		selectedBlockId: string | null;
		themeColor: string;
		onSelectBlock: (id: string) => void;
		onMoveBlock: (fromZone: string, fromIdx: number, toZone: string, toIdx: number) => void;
		onDeleteBlock: (id: string) => void;
		onDropFromPalette: (type: BlockType, zone: string, idx: number) => void;
		onDeleteRow: (section: 'header' | 'body' | 'footer', rowIdx: number) => void;
	};

	let {
		layout, selectedBlockId, themeColor,
		onSelectBlock, onMoveBlock, onDeleteBlock, onDropFromPalette, onDeleteRow
	}: Props = $props();

	let dragSrc = $state<{ zone: string; idx: number } | null>(null);
	let dragOverKey = $state<string | null>(null);

	function blockLabel(type: BlockDef['type']): string {
		const LABELS: Record<BlockDef['type'], string> = {
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

	function handleDragStart(zone: string, idx: number) {
		dragSrc = { zone, idx };
	}

	function handleDrop(e: DragEvent, toZone: string, toIdx: number) {
		dragOverKey = null;
		if (dragSrc) {
			onMoveBlock(dragSrc.zone, dragSrc.idx, toZone, toIdx);
			dragSrc = null;
		} else {
			const type = e.dataTransfer?.getData('application/x-block-type') as BlockType | undefined;
			if (type) onDropFromPalette(type, toZone, toIdx);
		}
	}

	type Section = 'header' | 'body' | 'footer';

	function zoneRows(section: Section) {
		if (section === 'header') return layout.header.rows;
		if (section === 'body') return layout.body.rows;
		return layout.footer.rows;
	}
</script>

<div class="canvas">
	{#each (['header', 'body', 'footer'] as Section[]) as section}
		<div class="canvas-section">
			<p class="canvas-zone-label">{section}</p>
			{#each zoneRows(section) as row, ri (ri)}
				<!-- Gap above row ri — drop here creates a new row at position ri -->
				<div class="canvas-row-gap"
					class:drag-over={dragOverKey === `gap:${section}:${ri}`}
					role="region"
					aria-label="Drop to create new row"
					ondragover={(e) => { e.preventDefault(); dragOverKey = `gap:${section}:${ri}`; }}
					ondragleave={() => { if (dragOverKey === `gap:${section}:${ri}`) dragOverKey = null; }}
					ondrop={(e) => { e.stopPropagation(); handleDrop(e, `${section}:NEW:${ri}`, 0); }}>
				</div>

				<div class="canvas-row-wrapper">
					<!-- Row zone: dropping on empty flex space appends to this row -->
					<div class="canvas-row-zone" role="region"
						style={section === 'header' && ri === 0 ? `border-top: 3px solid ${themeColor}` : ''}
						ondragover={(e) => { e.preventDefault(); }}
						ondrop={(e) => { handleDrop(e, `${section}:${ri}`, row.blocks.length); }}>

						{#if row.blocks.length === 0}
							<div class="canvas-drop-empty" role="region"
								class:drag-over={dragOverKey === `empty:${section}:${ri}`}
								ondragover={(e) => { e.preventDefault(); dragOverKey = `empty:${section}:${ri}`; }}
								ondragleave={() => { if (dragOverKey === `empty:${section}:${ri}`) dragOverKey = null; }}
								ondrop={(e) => { e.stopPropagation(); dragOverKey = null; handleDrop(e, `${section}:${ri}`, 0); }}>
								Drop here
							</div>
						{:else}
							{#each row.blocks as block, bi (block.id)}
								<button class="canvas-block canvas-row-item"
									class:selected={block.id === selectedBlockId}
									class:drag-over={dragOverKey === `rb:${section}:${ri}:${bi}`}
									draggable="true"
									ondragstart={() => handleDragStart(`${section}:${ri}`, bi)}
									ondragover={(e) => { e.preventDefault(); dragOverKey = `rb:${section}:${ri}:${bi}`; }}
									ondragleave={() => { if (dragOverKey === `rb:${section}:${ri}:${bi}`) dragOverKey = null; }}
									ondrop={(e) => { e.stopPropagation(); dragOverKey = null; handleDrop(e, `${section}:${ri}`, bi); }}
									onclick={() => onSelectBlock(block.id)}>
									<span class="canvas-grip"><GripVertical size={11} /></span>
									<span class="canvas-block-label">{blockLabel(block.type)}</span>
									<span class="canvas-block-del" role="button" tabindex="0" title="Remove block"
										onclick={(e) => { e.stopPropagation(); onDeleteBlock(block.id); }}
										onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onDeleteBlock(block.id); } }}>×</span>
								</button>
							{/each}
						{/if}
					</div>

					{#if zoneRows(section).length > 1}
						<button class="canvas-row-del-btn" title="Remove row"
							onclick={() => onDeleteRow(section, ri)}>
							<Trash2 size={11} />
						</button>
					{/if}
				</div>
			{/each}

			<!-- Gap after the last row — drop here creates a new row at the end -->
			<div class="canvas-row-gap"
				class:drag-over={dragOverKey === `gap:${section}:${zoneRows(section).length}`}
				role="region"
				aria-label="Drop to create new row at end"
				ondragover={(e) => { e.preventDefault(); dragOverKey = `gap:${section}:${zoneRows(section).length}`; }}
				ondragleave={() => { if (dragOverKey === `gap:${section}:${zoneRows(section).length}`) dragOverKey = null; }}
				ondrop={(e) => { e.stopPropagation(); handleDrop(e, `${section}:NEW:${zoneRows(section).length}`, 0); }}>
			</div>
		</div>
	{/each}
</div>

<style>
	.canvas { display: flex; flex-direction: column; gap: 12px; }
	.canvas-section { display: flex; flex-direction: column; }
	.canvas-zone-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted-foreground); margin-bottom: 2px; }

	/* Gap zone between rows — expands on dragover to show drop target */
	.canvas-row-gap {
		height: 8px; border-radius: 4px;
		border: 1px dashed transparent;
		transition: height 0.15s, border-color 0.15s, background 0.15s;
	}
	.canvas-row-gap.drag-over {
		height: 28px;
		border-color: var(--primary);
		background: color-mix(in srgb, var(--primary) 10%, transparent);
	}

	/* Multi-row wrapper — row zone + optional delete button */
	.canvas-row-wrapper { display: flex; align-items: center; gap: 4px; }
	.canvas-row-zone {
		flex: 1; display: flex; align-items: stretch; gap: 4px;
		border: 1px solid var(--border); border-radius: 6px;
		padding: 8px; min-height: 48px;
	}
	.canvas-row-del-btn {
		flex-shrink: 0; width: 22px; height: 22px; padding: 0;
		display: flex; align-items: center; justify-content: center;
		border: 1px solid var(--border); border-radius: 4px; background: none;
		color: var(--muted-foreground); cursor: pointer;
	}
	.canvas-row-del-btn:hover { border-color: var(--destructive); color: var(--destructive); background: color-mix(in srgb, var(--destructive) 8%, transparent); }

	.canvas-row-item { flex: 1; min-width: 60px; }

	/* Empty row drop target */
	.canvas-drop-empty {
		flex: 1; padding: 6px; border-radius: 4px;
		border: 1px dashed var(--border);
		font-size: 11px; color: var(--muted-foreground); text-align: center;
		display: flex; align-items: center; justify-content: center;
	}
	.canvas-drop-empty.drag-over {
		border-color: var(--primary);
		background: color-mix(in srgb, var(--primary) 10%, transparent);
		color: var(--primary);
	}

	/* Shared block button */
	.canvas-block {
		display: flex; align-items: center; gap: 6px; padding: 7px 10px;
		border-radius: 5px; border: 1px solid var(--border); background: var(--background);
		font-size: 12px; color: var(--foreground); cursor: grab; text-align: left; width: 100%;
	}
	.canvas-block:hover { border-color: var(--primary); background: var(--accent); }
	.canvas-block.selected { border-color: var(--primary); background: color-mix(in srgb, var(--primary) 8%, var(--background)); }
	.canvas-block.drag-over { border-color: var(--primary); border-style: dashed; }
	.canvas-grip { color: var(--muted-foreground); flex-shrink: 0; }
	.canvas-block-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.canvas-block-del {
		flex-shrink: 0; background: none; border: none; padding: 0 2px;
		font-size: 16px; line-height: 1; color: var(--muted-foreground);
		cursor: pointer; opacity: 0; transition: opacity 0.1s;
	}
	.canvas-block:hover .canvas-block-del { opacity: 1; }
	.canvas-block-del:hover { color: var(--destructive); }
</style>
