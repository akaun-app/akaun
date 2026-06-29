<script lang="ts">
	import type { BlockDef } from '$lib/pdf/template-types.js';
	import { SYSTEM_REQUIRED_BLOCKS } from '$lib/pdf/template-types.js';
	import { Trash2 } from '@lucide/svelte';

	type Props = {
		block: BlockDef;
		onUpdate: (patch: Partial<BlockDef>) => void;
		onDelete: () => void;
	};
	let { block, onUpdate, onDelete }: Props = $props();

	function setConfig(key: string, value: unknown) {
		onUpdate({ config: { ...block.config, [key]: value } });
	}
	function setStyle(key: string, value: unknown) {
		onUpdate({ style: { ...block.style, [key as keyof BlockDef['style']]: value } });
	}
</script>

<div class="inspector">
	<div class="insp-row">
		<p class="insp-label">Block type</p>
		<span class="insp-tag">{block.type}</span>
	</div>

	<div class="insp-row">
		<label class="insp-label" for="insp-mt">Margin top (mm)</label>
		<input
			id="insp-mt"
			class="insp-input"
			type="number"
			min="0"
			max="40"
			value={block.style?.marginTop ?? 0}
			oninput={(e) => setStyle('marginTop', parseFloat((e.target as HTMLInputElement).value) || 0)}
		/>
	</div>
	<div class="insp-row">
		<label class="insp-label" for="insp-mb">Margin bottom (mm)</label>
		<input
			id="insp-mb"
			class="insp-input"
			type="number"
			min="0"
			max="40"
			value={block.style?.marginBottom ?? 0}
			oninput={(e) => setStyle('marginBottom', parseFloat((e.target as HTMLInputElement).value) || 0)}
		/>
	</div>

	{#if block.type === 'text'}
		<div class="insp-row">
			<label class="insp-label" for="insp-title">Title</label>
			<input id="insp-title" class="insp-input" type="text" value={(block.config.title as string) ?? ''}
				oninput={(e) => setConfig('title', (e.target as HTMLInputElement).value)} />
		</div>
		<div class="insp-row">
			<label class="insp-label" for="insp-body">Body</label>
			<textarea id="insp-body" class="insp-textarea" rows={3}
				oninput={(e) => setConfig('body', (e.target as HTMLTextAreaElement).value)}>{(block.config.body as string) ?? ''}</textarea>
		</div>
	{:else if block.type === 'spacer'}
		<div class="insp-row">
			<label class="insp-label" for="insp-h">Height (pt)</label>
			<input id="insp-h" class="insp-input" type="number" min="4" max="200"
				value={(block.config.height as number) ?? 20}
				oninput={(e) => setConfig('height', parseFloat((e.target as HTMLInputElement).value) || 20)} />
		</div>
	{:else if block.type === 'notes'}
		<div class="insp-row">
			<label class="insp-label" for="insp-notes-label">Section label</label>
			<input id="insp-notes-label" class="insp-input" type="text"
				value={(block.config.label as string) ?? 'Notes'}
				oninput={(e) => setConfig('label', (e.target as HTMLInputElement).value)} />
		</div>
	{:else if block.type === 'customer-block'}
		<div class="insp-row">
			<label class="insp-label" for="insp-cust-label">Label</label>
			<input id="insp-cust-label" class="insp-input" type="text"
				value={(block.config.label as string) ?? 'BILL TO'}
				oninput={(e) => setConfig('label', (e.target as HTMLInputElement).value)} />
		</div>
	{:else if block.type === 'company-header'}
		<div class="insp-row insp-checkbox">
			<label>
				<input type="checkbox" checked={(block.config.showAddress as boolean) !== false}
					onchange={(e) => setConfig('showAddress', (e.target as HTMLInputElement).checked)} />
				Show address
			</label>
		</div>
	{:else if block.type === 'totals-block'}
		<div class="insp-row insp-checkbox">
			<label>
				<input type="checkbox" checked={(block.config.showTaxRow as boolean) !== false}
					onchange={(e) => setConfig('showTaxRow', (e.target as HTMLInputElement).checked)} />
				Show tax row
			</label>
		</div>
	{/if}

	{#if !SYSTEM_REQUIRED_BLOCKS.includes(block.type)}
		<button class="insp-delete" onclick={onDelete}>
			<Trash2 size={13} /> Remove block
		</button>
	{/if}
</div>

<style>
	.inspector { display: flex; flex-direction: column; gap: 10px; padding: 8px 0; }
	.insp-row { display: flex; flex-direction: column; gap: 4px; }
	.insp-label { font-size: 11px; font-weight: 600; color: var(--muted-foreground); text-transform: uppercase; letter-spacing: 0.04em; }
	.insp-tag { font-size: 12px; background: var(--accent); border: 1px solid var(--border); border-radius: 4px; padding: 2px 7px; width: fit-content; }
	.insp-input, .insp-textarea {
		border: 1px solid var(--border); border-radius: 5px; padding: 6px 8px;
		font-size: 13px; color: var(--foreground); background: var(--background); width: 100%;
	}
	.insp-textarea { resize: vertical; font-family: inherit; }
	.insp-checkbox label { display: flex; align-items: center; gap: 6px; font-size: 13px; cursor: pointer; }
	.insp-delete {
		display: flex; align-items: center; gap: 6px; margin-top: 8px;
		padding: 7px 10px; border-radius: 5px; border: 1px solid var(--border);
		background: none; font-size: 12px; color: var(--destructive); cursor: pointer;
	}
	.insp-delete:hover { background: color-mix(in srgb, var(--destructive) 8%, transparent); border-color: var(--destructive); }
</style>
