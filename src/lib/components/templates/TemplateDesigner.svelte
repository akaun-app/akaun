<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { Save, Star, Trash2, ChevronDown } from '@lucide/svelte';
	import type { BlockDef, BlockType, TemplateLayout, TemplateRow } from '$lib/pdf/template-types.js';
	import { makeDefaultLayout, SYSTEM_REQUIRED_BLOCKS } from '$lib/pdf/template-types.js';
	import { TemplateDocumentType } from '$lib/enums.js';
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

	// Local working copy of layout + theme
	// svelte-ignore state_referenced_locally
	let layout = $state<TemplateLayout>(JSON.parse(template.layoutJson) as TemplateLayout);
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

	function findBlock(l: TemplateLayout, id: string | null): BlockDef | null {
		if (!id) return null;
		const all: BlockDef[] = [
			...l.header.columns.flatMap((c) => c.blocks),
			...l.body.blocks,
			...l.footer.columns.flatMap((c) => c.blocks)
		];
		return all.find((b) => b.id === id) ?? null;
	}

	function addBlockToBody(type: BlockType) {
		// Prevent duplicate required blocks
		if (SYSTEM_REQUIRED_BLOCKS.includes(type)) {
			const allBlocks: BlockDef[] = [
				...layout.header.columns.flatMap((c) => c.blocks),
				...layout.body.blocks,
				...layout.footer.columns.flatMap((c) => c.blocks)
			];
			if (allBlocks.some((b) => b.type === type)) {
				toast.error(`A "${type}" block already exists in this template.`);
				return;
			}
		}
		const newBlock: BlockDef = { id: crypto.randomUUID(), type, config: {}, style: {} };
		layout = { ...layout, body: { blocks: [...layout.body.blocks, newBlock] } };
		selectedBlockId = newBlock.id;
	}

	function moveBlock(fromZone: string, fromIdx: number, toZone: string, toIdx: number) {
		if (fromZone === toZone && fromIdx === toIdx) return;

		function getZoneBlocks(zone: string): BlockDef[] {
			if (zone === 'body') return layout.body.blocks;
			const [s, ci] = zone.split(':');
			if (s === 'header') return layout.header.columns[parseInt(ci)].blocks;
			if (s === 'footer') return layout.footer.columns[parseInt(ci)].blocks;
			return [];
		}

		const srcBlocks = [...getZoneBlocks(fromZone)];
		const [moved] = srcBlocks.splice(fromIdx, 1);

		// Prevent moving required blocks out of body
		if (SYSTEM_REQUIRED_BLOCKS.includes(moved.type) && toZone !== 'body' && fromZone === 'body') {
			toast.error('Required blocks must stay in the body zone.');
			return;
		}

		if (fromZone === toZone) {
			srcBlocks.splice(toIdx, 0, moved);
			applyZoneBlocks(fromZone, srcBlocks);
		} else {
			const dstBlocks = [...getZoneBlocks(toZone)];
			dstBlocks.splice(toIdx, 0, moved);
			let next = applyZoneBlocks(fromZone, srcBlocks);
			next = applyZoneBlocks(toZone, dstBlocks, next);
			layout = next;
		}
	}

	function applyZoneBlocks(zone: string, blocks: BlockDef[], base?: TemplateLayout): TemplateLayout {
		const l = base ?? layout;
		if (zone === 'body') return { ...l, body: { blocks } };
		const [s, ciStr] = zone.split(':');
		const ci = parseInt(ciStr);
		if (s === 'header') {
			const cols = l.header.columns.map((c, i) => (i === ci ? { ...c, blocks } : c));
			return { ...l, header: { columns: cols } };
		}
		if (s === 'footer') {
			const cols = l.footer.columns.map((c, i) => (i === ci ? { ...c, blocks } : c));
			return { ...l, footer: { columns: cols } };
		}
		return l;
	}

	function updateSelectedBlock(patch: Partial<BlockDef>) {
		if (!selectedBlockId) return;
		function patchIn(blocks: BlockDef[]): BlockDef[] {
			return blocks.map((b) => (b.id === selectedBlockId ? { ...b, ...patch, config: { ...b.config, ...patch.config }, style: { ...b.style, ...patch.style } } : b));
		}
		layout = {
			...layout,
			header: { columns: layout.header.columns.map((c) => ({ ...c, blocks: patchIn(c.blocks) })) },
			body: { blocks: patchIn(layout.body.blocks) },
			footer: { columns: layout.footer.columns.map((c) => ({ ...c, blocks: patchIn(c.blocks) })) }
		};
	}

	function deleteSelectedBlock() {
		if (!selectedBlockId) return;
		function removeFrom(blocks: BlockDef[]): BlockDef[] {
			return blocks.filter((b) => b.id !== selectedBlockId);
		}
		layout = {
			...layout,
			header: { columns: layout.header.columns.map((c) => ({ ...c, blocks: removeFrom(c.blocks) })) },
			body: { blocks: removeFrom(layout.body.blocks) },
			footer: { columns: layout.footer.columns.map((c) => ({ ...c, blocks: removeFrom(c.blocks) })) }
		};
		selectedBlockId = null;
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
	<!-- Toolbar -->
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

	<!-- 3-pane body -->
	<div class="designer-body">
		<!-- Left: palette / theme -->
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

		<!-- Center: canvas -->
		<main class="designer-canvas-pane">
			<TemplateCanvas
				{layout}
				{selectedBlockId}
				{themeColor}
				onSelectBlock={(id) => (selectedBlockId = id)}
				onMoveBlock={moveBlock}
				onLayoutChange={(l) => (layout = l)}
			/>
		</main>

		<!-- Right: inspector -->
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
