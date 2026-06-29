<script lang="ts">
	import { Plus, FileText, Star } from '@lucide/svelte';
	import type { TemplateRow } from '$lib/pdf/template-types.js';
	import { TemplateDocumentTypeLabels } from '$lib/enums.js';

	type Props = {
		templates: TemplateRow[];
		selectedId: number | null;
		onSelect: (t: TemplateRow) => void;
		onCreate: () => void;
	};

	let { templates, selectedId, onSelect, onCreate }: Props = $props();
</script>

<div class="tpl-list">
	<div class="tpl-list-head">
		<span class="tpl-list-title">Templates</span>
		<button class="tpl-list-add" onclick={onCreate} title="New template">
			<Plus size={14} />
		</button>
	</div>
	{#each templates as t (t.id)}
		<button
			class="tpl-list-item"
			class:selected={t.id === selectedId}
			onclick={() => onSelect(t)}
		>
			<FileText size={14} class="tpl-list-icon" />
			<span class="tpl-list-name">{t.name}</span>
			<span class="tpl-list-meta">{TemplateDocumentTypeLabels[t.documentType] ?? '?'}</span>
			{#if t.isDefault}
				<span class="tpl-list-star"><Star size={11} /></span>
			{/if}
		</button>
	{:else}
		<p class="tpl-list-empty">No templates yet.</p>
	{/each}
</div>

<style>
	.tpl-list {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 0 8px;
	}
	.tpl-list-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 6px 4px 8px;
	}
	.tpl-list-title {
		font-size: 11px;
		font-weight: 600;
		color: var(--muted-foreground);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.tpl-list-add {
		background: none;
		border: 1px solid var(--border);
		border-radius: 5px;
		padding: 3px 6px;
		cursor: pointer;
		color: var(--muted-foreground);
		display: flex;
		align-items: center;
	}
	.tpl-list-add:hover { color: var(--foreground); border-color: var(--primary); }
	.tpl-list-item {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 10px;
		border-radius: 6px;
		border: none;
		background: none;
		cursor: pointer;
		text-align: left;
		width: 100%;
		color: var(--foreground);
		font-size: 13px;
	}
	.tpl-list-item:hover { background: var(--accent); }
	.tpl-list-item.selected { background: var(--accent); font-weight: 500; }
	.tpl-list-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.tpl-list-meta { font-size: 11px; color: var(--muted-foreground); text-transform: capitalize; }
	.tpl-list-star { color: var(--primary); flex-shrink: 0; }
	.tpl-list-empty { padding: 12px 4px; font-size: 13px; color: var(--muted-foreground); }
</style>
