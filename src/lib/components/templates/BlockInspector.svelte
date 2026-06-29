<script lang="ts">
	import type { GridCell } from '$lib/pdf/template-types.js';
	import { Trash2 } from '@lucide/svelte';

	type Props = {
		block: GridCell;
		columns: number;
		onUpdate: (patch: Partial<GridCell>) => void;
		onResize: (colSpan: number, rowSpan: number) => void;
		onDelete: () => void;
	};
	let { block, columns, onUpdate, onResize, onDelete }: Props = $props();

	// How many columns the block can still grow into from its current start column.
	const maxColSpan = $derived(columns - block.col);

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

	<!-- Size — column / row span -->
	<div class="insp-row">
		<p class="insp-label">Size</p>
		<div class="insp-span">
			<div class="insp-span-field">
				<span class="insp-span-cap">Width (cols)</span>
				<div class="insp-stepper">
					<button class="insp-step-btn" title="Narrower"
						disabled={block.colSpan <= 1}
						onclick={() => onResize(block.colSpan - 1, block.rowSpan)}>−</button>
					<span class="insp-step-val">{block.colSpan}</span>
					<button class="insp-step-btn" title="Wider"
						disabled={block.colSpan >= maxColSpan}
						onclick={() => onResize(block.colSpan + 1, block.rowSpan)}>+</button>
				</div>
			</div>
			<div class="insp-span-field">
				<span class="insp-span-cap">Height (rows)</span>
				<div class="insp-stepper">
					<button class="insp-step-btn" title="Shorter"
						disabled={block.rowSpan <= 1}
						onclick={() => onResize(block.colSpan, block.rowSpan - 1)}>−</button>
					<span class="insp-step-val">{block.rowSpan}</span>
					<button class="insp-step-btn" title="Taller"
						onclick={() => onResize(block.colSpan, block.rowSpan + 1)}>+</button>
				</div>
			</div>
		</div>
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

	.insp-span { display: flex; gap: 8px; }
	.insp-span-field { flex: 1; display: flex; flex-direction: column; gap: 3px; }
	.insp-span-cap { font-size: 10px; color: var(--muted-foreground); }
	.insp-stepper {
		display: flex; align-items: center; border: 1px solid var(--border); border-radius: 5px; overflow: hidden;
	}
	.insp-step-btn {
		width: 26px; padding: 4px 0; border: none; background: none; cursor: pointer;
		font-size: 15px; line-height: 1; color: var(--foreground);
	}
	.insp-step-btn:hover:not(:disabled) { background: var(--accent); }
	.insp-step-btn:disabled { opacity: 0.35; cursor: not-allowed; }
	.insp-step-val { flex: 1; text-align: center; font-size: 13px; font-variant-numeric: tabular-nums; }
	.insp-info { font-size: 11px; color: var(--muted-foreground); line-height: 1.4; }
	.insp-delete {
		display: flex; align-items: center; gap: 6px; margin-top: 8px;
		padding: 7px 10px; border-radius: 5px; border: 1px solid var(--border);
		background: none; font-size: 12px; color: var(--destructive); cursor: pointer;
	}
	.insp-delete:hover { background: color-mix(in srgb, var(--destructive) 8%, transparent); border-color: var(--destructive); }
</style>
