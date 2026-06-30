<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { Save, Star, Trash2 } from '@lucide/svelte';
	import type { BlockType, GridCell, TemplateLayout, TemplateRow } from '$lib/pdf/template-types.js';
	import { migrateLayout, GRID_COLUMNS } from '$lib/pdf/template-types.js';
	import { newCell, placeCell, removeBlock, maxRow } from './grid-ops.js';
	import BlockPalette from './BlockPalette.svelte';
	import TemplateCanvas from './TemplateCanvas.svelte';
	import BlockInspector from './BlockInspector.svelte';
	import ThemeEditor from './ThemeEditor.svelte';

	type Props = {
		template: TemplateRow;
		onSave: (updated: TemplateRow) => void;
		onDelete: (id: number) => void;
	};
	let { template, onSave, onDelete }: Props = $props();

	// svelte-ignore state_referenced_locally
	let layout = $state<TemplateLayout>(migrateLayout(JSON.parse(template.layoutJson)));
	// svelte-ignore state_referenced_locally
	let themeColor = $state(template.themeColor);
	// svelte-ignore state_referenced_locally
	let themeFont = $state(template.themeFont);
	// svelte-ignore state_referenced_locally
	let name = $state(template.name);

	let selectedBlockId = $state<string | null>(null);
	let saving = $state(false);
	let sidebarTab = $state<'blocks' | 'theme'>('blocks');

	const columns = $derived(layout.columns || GRID_COLUMNS);
	const selectedBlock = $derived(findCell(layout, selectedBlockId));

	function findCell(l: TemplateLayout, id: string | null): GridCell | null {
		if (!id) return null;
		return l.cells.find((c) => c.id === id) ?? null;
	}

	// The canvas owns all grid interaction (drag/insert/gutter) via grid-ops and
	// commits the resulting cell array through this single apply hook.
	function applyCells(cells: GridCell[]) {
		layout = { ...layout, cells };
	}

	function addBlockToBody(type: BlockType) {
		// Palette click → place a full-width block on a new bottom row.
		const block = newCell(type, columns);
		applyCells(placeCell(layout.cells, block, 0, maxRow(layout.cells), columns));
		selectedBlockId = block.id;
	}

	function deleteCell(id: string) {
		applyCells(removeBlock(layout.cells, id, columns));
		if (selectedBlockId === id) selectedBlockId = null;
	}

	function updateSelectedBlock(patch: Partial<GridCell>) {
		if (!selectedBlockId) return;
		layout = {
			...layout,
			cells: layout.cells.map((c) =>
				c.id === selectedBlockId
					? { ...c, ...patch, config: { ...c.config, ...patch.config }, style: { ...c.style, ...patch.style } }
					: c
			)
		};
	}

	function deleteSelectedBlock() {
		if (selectedBlockId) deleteCell(selectedBlockId);
	}

	async function save() {
		saving = true;
		try {
			const res = await fetch(`/api/templates/${template.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name, themeColor, themeFont, layout })
			});
			if (!res.ok) throw new Error(await res.text());
			const updated = (await res.json()) as TemplateRow;
			toast.success('Template saved');
			onSave(updated);
		} catch {
			toast.error('Failed to save template');
		} finally {
			saving = false;
		}
	}

	async function setDefault() {
		const res = await fetch(`/api/templates/${template.id}/set-default`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ documentType: template.documentType })
		});
		if (res.ok) toast.success('Set as default template');
		else toast.error('Failed to set default');
	}

	async function deleteTemplate() {
		const res = await fetch(`/api/templates/${template.id}`, { method: 'DELETE' });
		if (res.ok) {
			toast.success('Template deleted');
			onDelete(template.id);
		} else {
			const body = await res.json().catch(() => ({}));
			if (body?.error === 'last_template') {
				toast.error('Cannot delete the last template.');
			} else {
				toast.error('Failed to delete template');
			}
		}
	}
</script>

<div class="designer">
	<div class="designer-toolbar">
		<input class="designer-name-input" type="text" bind:value={name} placeholder="Template name" />
		<div class="designer-toolbar-actions">
			<button class="designer-btn" onclick={setDefault} title="Set as default">
				<Star size={14} /> Set default
			</button>
			<button class="designer-btn designer-btn-delete" onclick={deleteTemplate} title="Delete template">
				<Trash2 size={13} />
			</button>
			<button class="designer-btn designer-btn-primary" onclick={save} disabled={saving}>
				<Save size={13} /> {saving ? 'Saving…' : 'Save'}
			</button>
		</div>
	</div>

	<div class="designer-body">
		<aside class="designer-left">
			<div class="designer-left-tabs">
				<button class="designer-ltab" class:active={sidebarTab === 'blocks'} onclick={() => (sidebarTab = 'blocks')}>Blocks</button>
				<button class="designer-ltab" class:active={sidebarTab === 'theme'} onclick={() => (sidebarTab = 'theme')}>Theme</button>
			</div>
			<div class="designer-left-body">
				{#if sidebarTab === 'blocks'}
					<BlockPalette onAddBlock={addBlockToBody} />
				{:else}
					<ThemeEditor color={themeColor} font={themeFont} onColorChange={(c) => (themeColor = c)} onFontChange={(f) => (themeFont = f)} />
				{/if}
			</div>
		</aside>

		<main class="designer-canvas-pane">
			<TemplateCanvas
				{layout}
				{columns}
				{selectedBlockId}
				{themeColor}
				onSelectBlock={(id) => (selectedBlockId = id)}
				onApply={applyCells}
				onDeleteBlock={deleteCell}
			/>
		</main>

		<aside class="designer-right">
			<p class="designer-right-title">Inspector</p>
			{#if selectedBlock}
				<BlockInspector
					block={selectedBlock}
					onUpdate={updateSelectedBlock}
					onDelete={deleteSelectedBlock}
				/>
			{:else}
				<p class="designer-right-empty">Select a block to configure it.</p>
			{/if}
		</aside>
	</div>
</div>

<style>
	.designer { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
	.designer-toolbar {
		display: flex; align-items: center; gap: 10px; padding: 10px 14px;
		border-bottom: 1px solid var(--border); flex-shrink: 0;
	}
	.designer-name-input {
		flex: 1; border: 1px solid var(--border); border-radius: 5px; padding: 6px 10px;
		font-size: 14px; font-weight: 500; color: var(--foreground); background: var(--background);
	}
	.designer-toolbar-actions { display: flex; align-items: center; gap: 6px; }
	.designer-btn {
		display: flex; align-items: center; gap: 5px; padding: 6px 12px;
		border-radius: 5px; border: 1px solid var(--border); background: none;
		font-size: 12px; cursor: pointer; color: var(--foreground);
	}
	.designer-btn:hover { background: var(--accent); border-color: var(--primary); }
	.designer-btn-delete { color: var(--destructive); }
	.designer-btn-delete:hover { border-color: var(--destructive); background: color-mix(in srgb, var(--destructive) 8%, transparent); }
	.designer-btn-primary { background: var(--primary); color: #fff; border-color: var(--primary); }
	.designer-btn-primary:hover { opacity: 0.9; }
	.designer-btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }

	.designer-body { display: flex; flex: 1; overflow: hidden; }
	.designer-left {
		width: 200px; flex-shrink: 0; border-right: 1px solid var(--border);
		display: flex; flex-direction: column; overflow: hidden;
	}
	.designer-left-tabs { display: flex; border-bottom: 1px solid var(--border); }
	.designer-ltab {
		flex: 1; padding: 8px 0; border: none; background: none; font-size: 12px;
		font-weight: 500; cursor: pointer; color: var(--muted-foreground); border-bottom: 2px solid transparent;
	}
	.designer-ltab.active { color: var(--foreground); border-bottom-color: var(--primary); }
	.designer-left-body { flex: 1; overflow-y: auto; padding: 4px 8px; }

	.designer-canvas-pane { flex: 1; overflow-y: auto; padding: 16px; background: var(--muted); }
	.designer-right {
		width: 200px; flex-shrink: 0; border-left: 1px solid var(--border);
		overflow-y: auto; padding: 10px 12px;
	}
	.designer-right-title {
		font-size: 11px; font-weight: 700; text-transform: uppercase;
		letter-spacing: 0.05em; color: var(--muted-foreground); margin-bottom: 8px;
	}
	.designer-right-empty { font-size: 12px; color: var(--muted-foreground); }
</style>
