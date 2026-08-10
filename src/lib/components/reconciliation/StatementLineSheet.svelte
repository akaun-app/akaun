<script lang="ts">
	import { FileText, Trash2, X } from '@lucide/svelte';
	import { useIsMobile } from '$lib/hooks/useIsMobile.svelte.js';
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
	import { Input } from '$lib/components/ui/input';
	import * as Sheet from '$lib/components/ui/sheet';

	type StatementLine = {
		id: number;
		date: string;
		description: string;
		amount: number;
		direction: number;
		note: string;
	};

	let {
		open,
		onOpenChange,
		sessionId,
		line = null,
		canDelete,
		onSaved,
		onDeleted
	}: {
		open: boolean;
		onOpenChange: (open: boolean) => void;
		sessionId: number;
		line?: StatementLine | null;
		canDelete: boolean;
		onSaved?: (line: unknown) => void;
		onDeleted?: () => void;
	} = $props();

	const screen = useIsMobile();
	const isMobile = $derived(screen.current);
	const panelSide = $derived(isMobile ? 'bottom' : 'right');
	const isEditing = $derived(line !== null);

	let date = $state('');
	let description = $state('');
	let amount = $state(0);
	let direction = $state(1);
	let note = $state('');
	let saving = $state(false);
	let deleting = $state(false);
	let deleteConfirmOpen = $state(false);
	let error = $state('');
	let initializedKey = $state('');

	$effect(() => {
		const key = open ? `${sessionId}:${line?.id ?? 'new'}` : '';
		if (key && key !== initializedKey) {
			date = line?.date ?? '';
			description = line?.description ?? '';
			amount = line?.amount ?? 0;
			direction = line?.direction ?? 1;
			note = line?.note ?? '';
			error = '';
			initializedKey = key;
		} else if (!open) {
			initializedKey = '';
		}
	});

	function close() {
		if (!saving && !deleting) onOpenChange(false);
	}

	function responseError(result: unknown, fallback: string) {
		return result && typeof result === 'object' && 'error' in result && typeof result.error === 'string'
			? result.error
			: fallback;
	}

	async function save(event: SubmitEvent) {
		event.preventDefault();
		if (saving || deleting) return;

		saving = true;
		error = '';
		try {
			const endpoint = line
				? `/api/reconciliation/${sessionId}/lines/${line.id}`
				: `/api/reconciliation/${sessionId}/lines`;
			const response = await fetch(endpoint, {
				method: line ? 'PATCH' : 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ date, description, amount, direction, note })
			});
			const result: unknown = await response.json().catch(() => null);
			if (!response.ok) throw new Error(responseError(result, 'Unable to save this statement line.'));

			onSaved?.(result);
			onOpenChange(false);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Unable to save this statement line.';
		} finally {
			saving = false;
		}
	}

	async function deleteLine() {
		if (!line || !canDelete || saving || deleting) return;

		deleting = true;
		error = '';
		try {
			const response = await fetch(`/api/reconciliation/${sessionId}/lines/${line.id}`, {
				method: 'DELETE'
			});
			if (!response.ok) {
				const result: unknown = await response.json().catch(() => null);
				throw new Error(responseError(result, 'Unable to delete this statement line.'));
			}

			onDeleted?.();
			onOpenChange(false);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Unable to delete this statement line.';
		} finally {
			deleting = false;
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
			<div class="sheet-header">
				<div>
					<div class="sheet-eyebrow"><FileText size={12} /> Statement line</div>
					<div class="sheet-title-text">{isEditing ? 'Edit statement line' : 'Add statement line'}</div>
				</div>
				<Sheet.Close class="sheet-close" disabled={saving || deleting}><X size={16} /></Sheet.Close>
			</div>

			<form onsubmit={save} style="flex:1; display:flex; flex-direction:column; overflow:hidden;">
				<div class="sheet-body">
					{#if error}<div class="error-banner" role="alert">{error}</div>{/if}

					<div class="field">
						<label class="field-label" for="statement-line-date">Date *</label>
						<Input id="statement-line-date" type="date" required bind:value={date} class="w-full" />
					</div>
					<div class="field">
						<label class="field-label" for="statement-line-description">Description</label>
						<Input id="statement-line-description" bind:value={description} class="w-full" />
					</div>
					<div class="field">
						<label class="field-label" for="statement-line-amount">Amount *</label>
						<Input id="statement-line-amount" type="number" min="0.01" step="0.01" required bind:value={amount} class="w-full" />
					</div>
					<div class="field">
						<label class="field-label" for="statement-line-direction">Direction *</label>
						<select id="statement-line-direction" bind:value={direction} required>
							<option value={1}>Money in</option>
							<option value={2}>Money out</option>
						</select>
					</div>
					<div class="field">
						<label class="field-label" for="statement-line-note">Note</label>
						<textarea id="statement-line-note" rows="4" bind:value={note}></textarea>
					</div>
				</div>

				<div class="sheet-foot">
					<div class="sheet-foot-actions">
						{#if isEditing}
							<button
								type="button"
								class="sheet-btn sheet-btn-delete"
								style="margin-right:auto;"
								disabled={!canDelete || saving || deleting}
								title={canDelete ? 'Delete statement line' : 'You do not have permission to delete this line'}
								onclick={() => (deleteConfirmOpen = true)}
							>
								<Trash2 size={14} /> Delete
							</button>
						{/if}
						<button type="button" class="sheet-btn" onclick={close} disabled={saving || deleting}>Cancel</button>
						<button type="submit" class="sheet-btn sheet-btn-primary" disabled={saving || deleting}>
							{saving ? 'Saving…' : 'Save'}
						</button>
					</div>
				</div>
			</form>
		</Sheet.Content>
	</Sheet.Portal>
</Sheet.Root>

<ConfirmDialog
	bind:open={deleteConfirmOpen}
	title="Delete statement line?"
	description="This removes the line from the reconciliation. If it is matched, the linked item will become uncleared."
	confirmLabel="Delete line"
	danger
	onConfirm={deleteLine}
/>

<style>
	.sheet-header { display:flex; align-items:flex-start; justify-content:space-between; padding:22px 22px 16px; border-bottom:1px solid var(--border); }
	.sheet-body { flex:1; overflow-y:auto; padding:20px 22px; }
	.error-banner { margin-bottom:16px; padding:10px 12px; border-radius:8px; font-size:13px; color:var(--red); background:var(--red-soft); }
	select, textarea { width:100%; border:1px solid var(--input); border-radius:6px; background:var(--background); color:var(--foreground); font:inherit; font-size:14px; }
	select { height:36px; padding:0 10px; }
	textarea { min-height:88px; padding:8px 10px; resize:vertical; }
	select:focus, textarea:focus { outline:2px solid color-mix(in srgb, var(--ring) 35%, transparent); outline-offset:1px; border-color:var(--ring); }
</style>
