<script lang="ts">
	import { X } from '@lucide/svelte';
	import * as Sheet from '$lib/components/ui/sheet/index.js';
	import { useIsMobile } from '$lib/hooks/useIsMobile.svelte.js';
	import RecordForm from './RecordForm.svelte';
	import type { AccountView, RecordView } from '$lib/server/ledger/types.js';

	/**
	 * Adding a record to the ledger.
	 *
	 * Create only. Reading and editing one happens on `/records/[id]`: this used
	 * to be both, and being both is what made it fifteen sections long in a
	 * 456px column. The fields themselves live in `RecordForm`, so the drawer and
	 * the page can never offer two different forms.
	 *
	 * Writes go through `/api/records`, and the list updates from the SSE event
	 * rather than from this component's response — one driver, no race.
	 */
	let {
		open = $bindable(false),
		accounts,
		categories,
		allAccounts = [],
		contacts = [],
		defaultAccountId = null,
		lastForeignCurrency = null,
		canAdjust = false,
		onclose,
		onsaved
	}: {
		open?: boolean;
		/** Every place money sits — what "which account?" offers. */
		accounts: AccountView[];
		/** The category accounts — what a record was for, either direction. */
		categories: AccountView[];
		/** Every account, for the full list a user with `adjustments` can reach. */
		allAccounts?: AccountView[];
		contacts?: { id: number; legalName: string }[];
		defaultAccountId?: number | null;
		/** The last foreign currency this user recorded in. */
		lastForeignCurrency?: string | null;
		/** Free choice of account, and a third side (FR-031). */
		canAdjust?: boolean;
		onclose: () => void;
		onsaved?: (record: RecordView) => void;
	} = $props();

	const screen = useIsMobile();
	const isMobile = $derived(screen.current);
	const panelSide = $derived(isMobile ? 'bottom' : 'right');

	let formRef = $state<{
		submit: () => Promise<RecordView | null>;
		revert: () => void;
		blockedBy: () => string | null;
	} | null>(null);
	let saving = $state(false);
	let error = $state('');

	async function save(event: SubmitEvent) {
		event.preventDefault();
		const saved = await formRef?.submit();
		if (saved) {
			onsaved?.(saved);
			onclose();
		}
	}
</script>

<Sheet.Root
	{open}
	onOpenChange={(o) => {
		if (!o) onclose();
	}}
>
	<Sheet.Content
		side={panelSide}
		style={isMobile
			? 'height:100dvh; border-radius:0; border-top:none; display:flex; flex-direction:column; overflow:hidden; gap:0;'
			: 'width:560px; max-width:95vw; display:flex; flex-direction:column; overflow:hidden; gap:0;'}
	>
		<div class="sheet-head">
			<div>
				<div class="sheet-eyebrow">New</div>
				<div class="sheet-title-text">New record</div>
			</div>
			<Sheet.Close class="sheet-close"><X size={16} /></Sheet.Close>
		</div>

		<form onsubmit={save} class="sheet-form">
			<div class="sheet-body">
				{#if open}
					<RecordForm
						bind:this={formRef}
						bind:saving
						bind:error
						record={null}
						{accounts}
						{categories}
						{allAccounts}
						{contacts}
						{defaultAccountId}
						{lastForeignCurrency}
						canChange={true}
						{canAdjust}
					/>
				{/if}
			</div>

			<footer class="sheet-foot">
				{#if formRef?.blockedBy()}
					<p class="sheet-foot-note">{formRef.blockedBy()}</p>
				{/if}
				<div class="sheet-foot-actions">
					<button type="button" class="sheet-btn" onclick={onclose}>Cancel</button>
					<button
						type="submit"
						class="sheet-btn sheet-btn-primary"
						disabled={saving || formRef?.blockedBy() != null}
					>
						{saving ? 'Saving…' : 'Save record'}
					</button>
				</div>
			</footer>
		</form>
	</Sheet.Content>
</Sheet.Root>

<style>
	.sheet-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		padding: 22px 22px 16px;
		border-bottom: 1px solid var(--border);
	}
	.sheet-form {
		flex: 1;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
	/* The form's own cards give the sections their frames, so the body only
	   supplies the gutter and the scroll. */
	.sheet-body {
		flex: 1;
		overflow-y: auto;
		padding: 18px 22px;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
</style>
