<script lang="ts">
	import { GripVertical, LayoutTemplate } from '@lucide/svelte';
	import type { BlockDef, TemplateLayout } from '$lib/pdf/template-types.js';
	import { SYSTEM_REQUIRED_BLOCKS } from '$lib/pdf/template-types.js';

	type Props = {
		layout: TemplateLayout;
		selectedBlockId: string | null;
		themeColor: string;
		onSelectBlock: (id: string) => void;
		onMoveBlock: (fromZone: string, fromIdx: number, toZone: string, toIdx: number) => void;
		onLayoutChange: (layout: TemplateLayout) => void;
	};

	let { layout, selectedBlockId, themeColor, onSelectBlock, onMoveBlock, onLayoutChange }: Props = $props();

	// Simple drag state without external DnD library since we need zone awareness
	let dragSrc = $state<{ zone: string; idx: number } | null>(null);

	function blockLabel(type: BlockDef['type']): string {
		const LABELS: Record<BlockDef['type'], string> = {
			'company-header': 'Company Header',
			'document-meta': 'Document Meta',
			'customer-block': 'Customer',
			'line-items-table': 'Line Items Table',
			'totals-block': 'Totals',
			notes: 'Notes',
			'paid-stamp': 'Paid Stamp',
			'issued-by': 'Issued By',
			text: 'Text Block',
			image: 'Image',
			divider: 'Divider',
			spacer: 'Spacer'
		};
		return LABELS[type] ?? type;
	}

	function isRequired(type: BlockDef['type']): boolean {
		return SYSTEM_REQUIRED_BLOCKS.includes(type);
	}

	function getZoneBlocks(zone: string): BlockDef[] {
		if (zone === 'body') return layout.body.blocks;
		const [section, colIdxStr] = zone.split(':');
		const colIdx = parseInt(colIdxStr);
		if (section === 'header') return layout.header.columns[colIdx]?.blocks ?? [];
		if (section === 'footer') return layout.footer.columns[colIdx]?.blocks ?? [];
		return [];
	}

	function handleDragStart(zone: string, idx: number) {
		dragSrc = { zone, idx };
	}

	function handleDrop(toZone: string, toIdx: number) {
		if (!dragSrc) return;
		onMoveBlock(dragSrc.zone, dragSrc.idx, toZone, toIdx);
		dragSrc = null;
	}
</script>

<div class="canvas">
	<!-- Header zone -->
	<div class="canvas-section">
		<p class="canvas-zone-label">Header</p>
		<div class="canvas-columns" style="border-top: 3px solid {themeColor}">
			{#each layout.header.columns as col, ci (ci)}
				<div class="canvas-col" style="flex: {col.width} 0 0">
					{#each col.blocks as block, bi (block.id)}
						<button
							class="canvas-block"
							class:selected={block.id === selectedBlockId}
							class:required={isRequired(block.type)}
							draggable="true"
							ondragstart={() => handleDragStart(`header:${ci}`, bi)}
							ondragover={(e) => e.preventDefault()}
							ondrop={() => handleDrop(`header:${ci}`, bi)}
							onclick={() => onSelectBlock(block.id)}
						>
							<span class="canvas-grip"><GripVertical size={11} /></span>
							<span class="canvas-block-label">{blockLabel(block.type)}</span>
						</button>
					{/each}
					<div class="canvas-drop-target" role="region" aria-label="Drop zone"
						ondragover={(e) => e.preventDefault()}
						ondrop={() => handleDrop(`header:${ci}`, col.blocks.length)}>
						Drop here
					</div>
				</div>
			{/each}
		</div>
	</div>

	<!-- Body zone -->
	<div class="canvas-section">
		<p class="canvas-zone-label">Body</p>
		<div class="canvas-body-zone">
			{#each layout.body.blocks as block, bi (block.id)}
				<button
					class="canvas-block"
					class:selected={block.id === selectedBlockId}
					class:required={isRequired(block.type)}
					draggable="true"
					ondragstart={() => handleDragStart('body', bi)}
					ondragover={(e) => e.preventDefault()}
					ondrop={() => handleDrop('body', bi)}
					onclick={() => onSelectBlock(block.id)}
				>
					<span class="canvas-grip"><GripVertical size={11} /></span>
					<span class="canvas-block-label">{blockLabel(block.type)}</span>
				</button>
			{/each}
			<div class="canvas-drop-target" role="region" aria-label="Drop zone"
				ondragover={(e) => e.preventDefault()}
				ondrop={() => handleDrop('body', layout.body.blocks.length)}>
				Drop here
			</div>
		</div>
	</div>

	<!-- Footer zone -->
	{#if layout.footer.columns.some((c) => c.blocks.length > 0) || true}
		<div class="canvas-section">
			<p class="canvas-zone-label">Footer</p>
			<div class="canvas-columns">
				{#each layout.footer.columns as col, ci (ci)}
					<div class="canvas-col" style="flex: {col.width} 0 0">
						{#each col.blocks as block, bi (block.id)}
							<button
								class="canvas-block"
								class:selected={block.id === selectedBlockId}
								class:required={isRequired(block.type)}
								draggable="true"
								ondragstart={() => handleDragStart(`footer:${ci}`, bi)}
								ondragover={(e) => e.preventDefault()}
								ondrop={() => handleDrop(`footer:${ci}`, bi)}
								onclick={() => onSelectBlock(block.id)}
							>
								<span class="canvas-grip"><GripVertical size={11} /></span>
								<span class="canvas-block-label">{blockLabel(block.type)}</span>
							</button>
						{/each}
						<div class="canvas-drop-target" role="region" aria-label="Drop zone"
							ondragover={(e) => e.preventDefault()}
							ondrop={() => handleDrop(`footer:${ci}`, col.blocks.length)}>
							Drop here
						</div>
					</div>
				{/each}
			</div>
		</div>
	{/if}
</div>

<style>
	.canvas { display: flex; flex-direction: column; gap: 12px; }
	.canvas-section { display: flex; flex-direction: column; gap: 4px; }
	.canvas-zone-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted-foreground); }
	.canvas-columns { display: flex; gap: 8px; border: 1px solid var(--border); border-radius: 6px; padding: 8px; min-height: 60px; }
	.canvas-body-zone { border: 1px solid var(--border); border-radius: 6px; padding: 8px; display: flex; flex-direction: column; gap: 4px; min-height: 80px; }
	.canvas-col { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
	.canvas-block {
		display: flex; align-items: center; gap: 6px; padding: 7px 10px;
		border-radius: 5px; border: 1px solid var(--border); background: var(--background);
		font-size: 12px; color: var(--foreground); cursor: grab; text-align: left; width: 100%;
	}
	.canvas-block:hover { border-color: var(--primary); background: var(--accent); }
	.canvas-block.selected { border-color: var(--primary); background: color-mix(in srgb, var(--primary) 8%, var(--background)); }
	.canvas-block.required .canvas-block-label::after { content: ' *'; color: var(--muted-foreground); font-size: 10px; }
	.canvas-grip { color: var(--muted-foreground); flex-shrink: 0; }
	.canvas-block-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.canvas-drop-target {
		padding: 6px; border-radius: 4px; border: 1px dashed var(--border);
		font-size: 11px; color: var(--muted-foreground); text-align: center;
	}
</style>
