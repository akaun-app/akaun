<script lang="ts">
	import { enhance } from '$app/forms';
	import { X } from '@lucide/svelte';
	import * as Sheet from '$lib/components/ui/sheet/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { useIsMobile } from '$lib/hooks/useIsMobile.svelte.js';
	import { mainCurrencySymbol } from '$lib/currency-state.svelte.js';
	import type { AccountView } from '$lib/server/ledger/types.js';

	let {
		open = $bindable(false),
		account = null,
		error = '',
		onclose
	}: {
		open?: boolean;
		account?: AccountView | null;
		error?: string;
		onclose: () => void;
	} = $props();

	const screen = useIsMobile();
	const isMobile = $derived(screen.current);
	const panelSide = $derived(isMobile ? 'bottom' : 'right');

	const today = new Date().toISOString().slice(0, 10);
</script>

<Sheet.Root
	{open}
	onOpenChange={(o) => {
		if (!o) onclose();
	}}
>
	<Sheet.Portal>
		<Sheet.Overlay />
		<Sheet.Content
			side={panelSide}
			style={isMobile
				? 'height:100dvh; border-radius:0; border-top:none; display:flex; flex-direction:column; overflow:hidden; gap:0;'
				: 'width:500px; max-width:95vw; display:flex; flex-direction:column; overflow:hidden; gap:0;'}
		>
			<div
				style="display:flex; align-items:flex-start; justify-content:space-between; padding:22px 22px 16px; border-bottom:1px solid var(--border);"
			>
				<div>
					<div class="sheet-eyebrow">{account?.name ?? 'Account'}</div>
					<div class="sheet-title-text">Starting balance</div>
				</div>
				<Sheet.Close class="sheet-close"><X size={16} /></Sheet.Close>
			</div>

			<form
				method="POST"
				action="?/openingBalance"
				use:enhance
				style="flex:1; display:flex; flex-direction:column; overflow:hidden;"
			>
				<input type="hidden" name="id" value={account?.id ?? ''} />

				<div style="flex:1; overflow-y:auto; padding:20px 22px;">
					{#if error}
						<div
							style="background:var(--red-soft); color:var(--red); border-radius:8px; padding:10px 14px; font-size:13px; margin-bottom:16px;"
						>
							{error}
						</div>
					{/if}

					<p class="lead">
						What was already in this account on the day you started keeping these books? Everything
						recorded since then is added on top of it.
					</p>

					<div class="field">
						<label class="field-label" for="ob-date">On this date *</label>
						<Input id="ob-date" name="date" type="date" required value={today} class="w-full" />
					</div>

					<div class="field">
						<label class="field-label" for="ob-amount">
							Amount ({mainCurrencySymbol()}) *
						</label>
						<Input
							id="ob-amount"
							name="amount"
							type="number"
							step="0.01"
							required
							value="0"
							class="w-full"
						/>
						<p class="hint">
							Enter a negative amount if the account was overdrawn. Setting it to zero removes the
							starting balance entirely.
						</p>
					</div>
				</div>

				<div class="sheet-foot">
					<div class="sheet-foot-note">
						There is only ever one starting balance per account — saving this replaces any earlier
						one.
					</div>
					<div class="sheet-foot-actions">
						<button type="button" class="sheet-btn" onclick={onclose}>Cancel</button>
						<button type="submit" class="sheet-btn sheet-btn-primary">Save starting balance</button>
					</div>
				</div>
			</form>
		</Sheet.Content>
	</Sheet.Portal>
</Sheet.Root>

<style>
	.lead {
		font-size: 13px;
		color: var(--muted-foreground);
		line-height: 1.55;
		margin: 0 0 18px;
	}
</style>
