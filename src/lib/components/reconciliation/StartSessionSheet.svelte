<script lang="ts">
	import { X } from '@lucide/svelte';
	import { useIsMobile } from '$lib/hooks/useIsMobile.svelte.js';
	import { Input } from '$lib/components/ui/input';
	import * as Sheet from '$lib/components/ui/sheet';

	type Prefill = {
		startingBalance: number;
		startingDate: string;
	};

	let {
		open,
		onOpenChange,
		prefill,
		onCreated
	}: {
		open: boolean;
		onOpenChange: (open: boolean) => void;
		prefill: Prefill;
		onCreated?: (detail: unknown) => void;
	} = $props();

	const screen = useIsMobile();
	const isMobile = $derived(screen.current);
	const panelSide = $derived(isMobile ? 'bottom' : 'right');

	let startingBalance = $state(0);
	let startingDate = $state('');
	let periodEndDate = $state('');
	let statementEndingBalance = $state(0);
	let submitting = $state(false);
	let errorMessage = $state('');
	let initializedForOpen = $state(false);

	$effect(() => {
		if (open && !initializedForOpen) {
			startingBalance = prefill.startingBalance;
			startingDate = prefill.startingDate;
			periodEndDate = prefill.startingDate;
			statementEndingBalance = prefill.startingBalance;
			errorMessage = '';
			initializedForOpen = true;
		} else if (!open) {
			initializedForOpen = false;
		}
	});

	function close() {
		if (!submitting) onOpenChange(false);
	}

	async function createSession(event: SubmitEvent) {
		event.preventDefault();
		errorMessage = '';
		submitting = true;

		try {
			const response = await fetch('/api/reconciliation', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					startingBalance,
					startingDate,
					periodEndDate,
					statementEndingBalance
				})
			});
			const detail: unknown = await response.json().catch(() => null);

			if (response.ok) {
				onCreated?.(detail);
				onOpenChange(false);
				return;
			}

			if (response.status === 409 && detail && typeof detail === 'object' && 'openSessionId' in detail) {
				onCreated?.(detail);
				onOpenChange(false);
				return;
			}

			errorMessage =
				detail && typeof detail === 'object' && 'error' in detail && typeof detail.error === 'string'
					? detail.error
					: 'Unable to start the reconciliation session.';
		} catch {
			errorMessage = 'Unable to start the reconciliation session. Check your connection and try again.';
		} finally {
			submitting = false;
		}
	}
</script>

<Sheet.Root {open} onOpenChange={(nextOpen) => (nextOpen ? onOpenChange(true) : close())}>
	<Sheet.Portal>
		<Sheet.Overlay />
		<Sheet.Content
			side={panelSide}
			style={isMobile
				? 'height:100dvh; border-radius:0; border-top:none; display:flex; flex-direction:column; overflow:hidden; gap:0;'
				: 'width:500px; max-width:95vw; display:flex; flex-direction:column; overflow:hidden; gap:0;'}
		>
			<div style="display:flex; align-items:flex-start; justify-content:space-between; padding:22px 22px 16px; border-bottom:1px solid var(--border);">
				<div>
					<div class="sheet-eyebrow">Reconciliation</div>
					<div class="sheet-title-text">Start a session</div>
				</div>
				<Sheet.Close class="sheet-close" disabled={submitting}><X size={16} /></Sheet.Close>
			</div>

			<form onsubmit={createSession} style="flex:1; display:flex; flex-direction:column; overflow:hidden;">
				<div style="flex:1; overflow-y:auto; padding:20px 22px;">
					{#if errorMessage}
						<div role="alert" style="background:var(--red-soft); color:var(--red); border-radius:8px; padding:10px 14px; font-size:13px; margin-bottom:16px;">
							{errorMessage}
						</div>
					{/if}

					<div class="field">
						<label class="field-label" for="startingBalance">Starting balance *</label>
						<Input id="startingBalance" name="startingBalance" type="number" step="0.01" required bind:value={startingBalance} class="w-full" />
					</div>
					<div class="field">
						<label class="field-label" for="startingDate">Starting date *</label>
						<Input id="startingDate" name="startingDate" type="date" required bind:value={startingDate} class="w-full" />
					</div>
					<div class="field">
						<label class="field-label" for="periodEndDate">Period end date *</label>
						<Input id="periodEndDate" name="periodEndDate" type="date" min={startingDate} required bind:value={periodEndDate} class="w-full" />
					</div>
					<div class="field">
						<label class="field-label" for="statementEndingBalance">Statement ending balance *</label>
						<Input id="statementEndingBalance" name="statementEndingBalance" type="number" step="0.01" required bind:value={statementEndingBalance} class="w-full" />
					</div>
				</div>

				<div class="sheet-foot">
					<div class="sheet-foot-actions">
						<button type="button" class="sheet-btn" onclick={close} disabled={submitting}>Cancel</button>
						<button type="submit" class="sheet-btn sheet-btn-primary" disabled={submitting}>
							{submitting ? 'Starting…' : 'Start session'}
						</button>
					</div>
				</div>
			</form>
		</Sheet.Content>
	</Sheet.Portal>
</Sheet.Root>
