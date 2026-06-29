<script lang="ts">
	import type { GridCell } from '$lib/pdf/template-types.js';
	import { Trash2 } from '@lucide/svelte';

	type Props = {
		block: GridCell;
		onUpdate: (patch: Partial<GridCell>) => void;
		onDelete: () => void;
	};
	let { block, onUpdate, onDelete }: Props = $props();

	function setConfig(key: string, value: unknown) {
		onUpdate({ config: { ...block.config, [key]: value } });
	}
	function setStyle(key: string, value: unknown) {
		onUpdate({ style: { ...block.style, [key as keyof GridCell['style']]: value } });
	}
</script>

<div class="inspector">
	<div class="insp-row">
		<p class="insp-label">Block type</p>
		<span class="insp-tag">{block.type}</span>
	</div>

	<!-- Alignment — universal control -->
	<div class="insp-row">
		<p class="insp-label">Alignment</p>
		<div class="insp-align">
			{#each ['left', 'center', 'right'] as a (a)}
				<button class="insp-align-btn" class:active={(block.style?.align ?? 'left') === a}
					onclick={() => setStyle('align', a)}
					title={a}>
					{a === 'left' ? '⇤' : a === 'center' ? '⇔' : '⇥'}
				</button>
			{/each}
		</div>
	</div>

	<p class="insp-hint">Drag the block on the canvas to move it, and drag the divider between two blocks to adjust their width.</p>

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
		<p class="insp-info">Horizontal pusher — fills available space between adjacent blocks.</p>
	{:else if block.type === 'notes'}
		<div class="insp-row">
			<label class="insp-label" for="insp-notes-label">Section label</label>
			<input id="insp-notes-label" class="insp-input" type="text"
				value={(block.config.label as string) ?? 'Notes'}
				oninput={(e) => setConfig('label', (e.target as HTMLInputElement).value)} />
		</div>
	{:else if block.type === 'customer-block'}
		<p class="insp-info">Shows bill-to name, address, reg no., and phone from the linked contact.</p>
	{:else if block.type === 'document-meta'}
		<p class="insp-info">Shows document number and date.</p>
	{:else if block.type === 'totals-block'}
		<div class="insp-row insp-checkbox">
			<label>
				<input type="checkbox" checked={(block.config.showTaxRow as boolean) !== false}
					onchange={(e) => setConfig('showTaxRow', (e.target as HTMLInputElement).checked)} />
				Show tax row
			</label>
		</div>
	{/if}

	<button class="insp-delete" onclick={onDelete}>
		<Trash2 size={13} /> Remove block
	</button>
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
	.insp-align { display: flex; gap: 4px; }
	.insp-align-btn {
		flex: 1; padding: 5px 2px; border: 1px solid var(--border);
		border-radius: 4px; background: none; font-size: 14px; cursor: pointer;
	}
	.insp-align-btn.active { background: var(--primary); color: #fff; border-color: var(--primary); }

	.insp-info { font-size: 11px; color: var(--muted-foreground); line-height: 1.4; }
	.insp-hint { font-size: 11px; color: var(--muted-foreground); line-height: 1.4; padding: 2px 0; }
	.insp-delete {
		display: flex; align-items: center; gap: 6px; margin-top: 8px;
		padding: 7px 10px; border-radius: 5px; border: 1px solid var(--border);
		background: none; font-size: 12px; color: var(--destructive); cursor: pointer;
	}
	.insp-delete:hover { background: color-mix(in srgb, var(--destructive) 8%, transparent); border-color: var(--destructive); }
</style>
