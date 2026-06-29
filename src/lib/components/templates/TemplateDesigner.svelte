<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { Save, Star, Trash2 } from '@lucide/svelte';
	import type { BlockDef, BlockType, TemplateLayout, TemplateRow, ZoneRow } from '$lib/pdf/template-types.js';
	import { migrateLayout } from '$lib/pdf/template-types.js';
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

	const selectedBlock = $derived(findBlock(layout, selectedBlockId));

	// zone string: "header:0" | "body:0" | "footer:0" | "header:NEW:1" | etc.
	const selectedBlockZone = $derived((): string | null => {
		if (!selectedBlockId) return null;
		for (let ri = 0; ri < layout.header.rows.length; ri++) {
			if (layout.header.rows[ri].blocks.some((b) => b.id === selectedBlockId)) return `header:${ri}`;
		}
		for (let ri = 0; ri < layout.body.rows.length; ri++) {
			if (layout.body.rows[ri].blocks.some((b) => b.id === selectedBlockId)) return `body:${ri}`;
		}
		for (let ri = 0; ri < layout.footer.rows.length; ri++) {
			if (layout.footer.rows[ri].blocks.some((b) => b.id === selectedBlockId)) return `footer:${ri}`;
		}
		return null;
	});

	function allBlocks(l: TemplateLayout): BlockDef[] {
		return [
			...l.header.rows.flatMap((r) => r.blocks),
			...l.body.rows.flatMap((r) => r.blocks),
			...l.footer.rows.flatMap((r) => r.blocks)
		];
	}

	function findBlock(l: TemplateLayout, id: string | null): BlockDef | null {
		if (!id) return null;
		return allBlocks(l).find((b) => b.id === id) ?? null;
	}

	// Parse "header:0" → { section, rowIdx, newRow }
	// Parse "body:NEW:2" → { section: 'body', rowIdx: 2, newRow: true }
	function parseZone(zone: string): { section: string; rowIdx: number; newRow: boolean } {
		const parts = zone.split(':');
		if (parts[1] === 'NEW') {
			return { section: parts[0], rowIdx: parseInt(parts[2] ?? '0') || 0, newRow: true };
		}
		return { section: parts[0], rowIdx: parseInt(parts[1] ?? '0') || 0, newRow: false };
	}

	function getSectionRows(l: TemplateLayout, section: string): ZoneRow[] {
		if (section === 'body') return l.body.rows;
		if (section === 'header') return l.header.rows;
		if (section === 'footer') return l.footer.rows;
		return [];
	}

	function getZoneBlocks(zone: string): BlockDef[] {
		const { section, rowIdx, newRow } = parseZone(zone);
		if (newRow) return [];
		return getSectionRows(layout, section)[rowIdx]?.blocks ?? [];
	}

	function applyZoneBlocks(zone: string, blocks: BlockDef[], base?: TemplateLayout): TemplateLayout {
		const l = base ?? layout;
		const { section, rowIdx, newRow } = parseZone(zone);

		function applyToSection(rows: ZoneRow[]): ZoneRow[] {
			if (newRow) {
				const next = [...rows];
				next.splice(rowIdx, 0, { blocks });
				return next;
			}
			return rows.map((r, i): ZoneRow => (i === rowIdx ? { blocks } : r));
		}

		if (section === 'body') return { ...l, body: { rows: applyToSection(l.body.rows) } };
		if (section === 'header') return { ...l, header: { rows: applyToSection(l.header.rows) } };
		if (section === 'footer') return { ...l, footer: { rows: applyToSection(l.footer.rows) } };
		return l;
	}

	function cleanEmptyRows(l: TemplateLayout): TemplateLayout {
		const clean = (rows: ZoneRow[]): ZoneRow[] => {
			const kept = rows.filter((r) => r.blocks.length > 0);
			return kept.length > 0 ? kept : [{ blocks: [] }];
		};
		return {
			...l,
			header: { rows: clean(l.header.rows) },
			body: { rows: clean(l.body.rows) },
			footer: { rows: clean(l.footer.rows) }
		};
	}

	function addBlockToBody(type: BlockType) {
		const newBlock: BlockDef = { id: crypto.randomUUID(), type, config: {}, style: {} };
		// Append to last body row if it exists and is non-full, otherwise new row
		const lastRow = layout.body.rows[layout.body.rows.length - 1];
		if (lastRow) {
			const rows = [...layout.body.rows];
			rows[rows.length - 1] = { blocks: [...lastRow.blocks, newBlock] };
			layout = { ...layout, body: { rows } };
		} else {
			layout = { ...layout, body: { rows: [{ blocks: [newBlock] }] } };
		}
		selectedBlockId = newBlock.id;
	}

	function addBlockAt(type: BlockType, zone: string, idx: number) {
		const newBlock: BlockDef = { id: crypto.randomUUID(), type, config: {}, style: {} };
		const zoneBlocks = [...getZoneBlocks(zone)];
		zoneBlocks.splice(idx, 0, newBlock);
		layout = applyZoneBlocks(zone, zoneBlocks);
		selectedBlockId = newBlock.id;
	}

	function moveBlock(fromZone: string, fromIdx: number, toZone: string, toIdx: number) {
		if (fromZone === toZone && fromIdx === toIdx) return;

		const srcBlocks = [...getZoneBlocks(fromZone)];
		const [moved] = srcBlocks.splice(fromIdx, 1);

		if (fromZone === toZone) {
			srcBlocks.splice(toIdx, 0, moved);
			layout = cleanEmptyRows(applyZoneBlocks(fromZone, srcBlocks));
		} else {
			const dstBlocks = [...getZoneBlocks(toZone)];
			dstBlocks.splice(toIdx, 0, moved);
			let next = applyZoneBlocks(fromZone, srcBlocks);
			next = applyZoneBlocks(toZone, dstBlocks, next);
			layout = cleanEmptyRows(next);
		}
	}

	function updateSelectedBlock(patch: Partial<BlockDef>) {
		if (!selectedBlockId) return;
		function patchIn(blocks: BlockDef[]): BlockDef[] {
			return blocks.map((b) =>
				b.id === selectedBlockId
					? { ...b, ...patch, config: { ...b.config, ...patch.config }, style: { ...b.style, ...patch.style } }
					: b
			);
		}
		layout = {
			...layout,
			header: { rows: layout.header.rows.map((r) => ({ blocks: patchIn(r.blocks) })) },
			body: { rows: layout.body.rows.map((r) => ({ blocks: patchIn(r.blocks) })) },
			footer: { rows: layout.footer.rows.map((r) => ({ blocks: patchIn(r.blocks) })) }
		};
	}

	function deleteSelectedBlock() {
		if (!selectedBlockId) return;
		function removeFrom(blocks: BlockDef[]): BlockDef[] {
			return blocks.filter((b) => b.id !== selectedBlockId);
		}
		layout = cleanEmptyRows({
			...layout,
			header: { rows: layout.header.rows.map((r) => ({ blocks: removeFrom(r.blocks) })) },
			body: { rows: layout.body.rows.map((r) => ({ blocks: removeFrom(r.blocks) })) },
			footer: { rows: layout.footer.rows.map((r) => ({ blocks: removeFrom(r.blocks) })) }
		});
		selectedBlockId = null;
	}

	function deleteRow(section: 'header' | 'body' | 'footer', rowIdx: number) {
		const row = layout[section].rows[rowIdx];
		if (row.blocks.length > 0 && !window.confirm('Delete this row and all its blocks?')) return;
		if (selectedBlockId && row.blocks.some((b) => b.id === selectedBlockId)) selectedBlockId = null;
		const rows = layout[section].rows.filter((_, i) => i !== rowIdx);
		layout = { ...layout, [section]: { rows: rows.length > 0 ? rows : [{ blocks: [] }] } };
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
				{selectedBlockId}
				{themeColor}
				onSelectBlock={(id) => (selectedBlockId = id)}
				onMoveBlock={moveBlock}
				onDeleteBlock={(id) => { selectedBlockId = id; deleteSelectedBlock(); }}
				onDropFromPalette={addBlockAt}
				onDeleteRow={deleteRow}
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
