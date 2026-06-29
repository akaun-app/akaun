<script lang="ts">
	import { FileText, Building2, User, List, Calculator, StickyNote, Stamp, UserCheck, Type, Image, Minus, Space } from '@lucide/svelte';
	import type { BlockType } from '$lib/pdf/template-types.js';
	import { SYSTEM_REQUIRED_BLOCKS } from '$lib/pdf/template-types.js';

	type Props = {
		onAddBlock: (type: BlockType) => void;
	};
	let { onAddBlock }: Props = $props();

	const GROUPS: { label: string; items: { type: BlockType; label: string; icon: typeof FileText }[] }[] = [
		{
			label: 'System',
			items: [
				{ type: 'company-header', label: 'Company Header', icon: Building2 },
				{ type: 'document-meta', label: 'Document Meta', icon: FileText },
				{ type: 'customer-block', label: 'Customer', icon: User },
				{ type: 'line-items-table', label: 'Line Items', icon: List },
				{ type: 'totals-block', label: 'Totals', icon: Calculator }
			]
		},
		{
			label: 'Optional',
			items: [
				{ type: 'notes', label: 'Notes', icon: StickyNote },
				{ type: 'paid-stamp', label: 'Paid Stamp', icon: Stamp },
				{ type: 'issued-by', label: 'Issued By', icon: UserCheck }
			]
		},
		{
			label: 'Custom',
			items: [
				{ type: 'text', label: 'Text Block', icon: Type },
				{ type: 'image', label: 'Image', icon: Image },
				{ type: 'divider', label: 'Divider', icon: Minus },
				{ type: 'spacer', label: 'Spacer', icon: Space }
			]
		}
	];
</script>

<div class="palette">
	{#each GROUPS as group (group.label)}
		<div class="palette-group">
			<p class="palette-group-label">{group.label}</p>
			{#each group.items as item (item.type)}
				<button
					class="palette-item"
					onclick={() => onAddBlock(item.type)}
					title={SYSTEM_REQUIRED_BLOCKS.includes(item.type) ? 'Required — one per layout' : `Add ${item.label}`}
				>
					<item.icon size={13} />
					<span>{item.label}</span>
				</button>
			{/each}
		</div>
	{/each}
</div>

<style>
	.palette { display: flex; flex-direction: column; gap: 14px; padding: 8px 0; }
	.palette-group { display: flex; flex-direction: column; gap: 2px; }
	.palette-group-label {
		font-size: 10px; font-weight: 700; text-transform: uppercase;
		letter-spacing: 0.06em; color: var(--muted-foreground);
		padding: 0 4px 4px;
	}
	.palette-item {
		display: flex; align-items: center; gap: 8px;
		padding: 7px 10px; border-radius: 5px; border: 1px solid var(--border);
		background: none; font-size: 12px; cursor: pointer; color: var(--foreground);
		text-align: left; width: 100%;
	}
	.palette-item:hover { background: var(--accent); border-color: var(--primary); }
</style>
