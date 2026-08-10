<script lang="ts">
	import { Calculator, Plus, Upload, X } from '@lucide/svelte';
	import { useIsMobile } from '$lib/hooks/useIsMobile.svelte.js';
	import * as Sheet from '$lib/components/ui/sheet/index.js';
	import AuditTrail from '$lib/components/ui/AuditTrail.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import StatementLineSheet from './StatementLineSheet.svelte';
	import { formatMoney, formatDate } from '$lib/format.js';
	import { mainCurrencySymbol } from '$lib/currency-state.svelte.js';
	import {
		ReconSessionStatus,
		ReconSessionStatusLabels,
		StatementExtractionState
	} from '$lib/enums.js';
	import type { SessionSummary } from '$lib/server/reconciliation/types.js';

	type Step1Detail = {
		expected?: number;
		entered?: number;
		matched?: boolean;
		difference?: number;
		incomeTotal?: number;
		expenseTotal?: number;
		claimTotal?: number;
		inScopeCounts?: { incomes?: number; directExpenses?: number; claims?: number };
	};
	type DriftDetail = { changed?: unknown[]; deleted?: unknown[] };
	type Detail = { session: SessionSummary; step1: Step1Detail; drift: DriftDetail };

	let {
		open,
		onOpenChange,
		detail,
		canChange,
		canDelete,
		onUpdated,
		onEscalate
	}: {
		open: boolean;
		onOpenChange: (open: boolean) => void;
		detail: Detail | null;
		canChange: boolean;
		canDelete?: boolean;
		onUpdated?: (detail: unknown) => void;
		onEscalate?: () => void;
	} = $props();

	const screen = useIsMobile();
	const isMobile = $derived(screen.current);
	const panelSide = $derived(isMobile ? 'bottom' : 'right');
	const isOpenSession = $derived(detail?.session.status === ReconSessionStatus.Open);
	const difference = $derived(Number(detail?.step1?.difference ?? detail?.session.difference ?? 0));
	const matched = $derived(Boolean(detail?.step1?.matched ?? Math.abs(difference) < 0.005));
	let auditTrailRef = $state<AuditTrail>();
	let saving = $state(false);
	let error = $state('');
	let uploading = $state(false);
	let lineSheetOpen = $state(false);
	let fileInput = $state<HTMLInputElement | null>(null);
	// Files are browser objects and intentionally stay outside Svelte's reactive proxies.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const pendingFiles = new Map<number, File>();

	async function uploadSelected(event: Event) {
		if (!detail || uploading) return;
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		pendingFiles.set(detail.session.id, file);
		uploading = true;
		error = '';
		try {
			const form = new FormData();
			form.set('file', file);
			const response = await fetch(`/api/reconciliation/${detail.session.id}/statement`, {
				method: 'POST',
				body: form
			});
			const result = await response.json().catch(() => null);
			if (!response.ok) throw new Error(result?.error ?? 'Could not upload this statement.');
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Could not upload this statement.';
		} finally {
			pendingFiles.delete(detail.session.id);
			uploading = false;
			input.value = '';
		}
	}

	async function closeSession() {
		if (!detail || saving || !canChange || !isOpenSession) return;
		saving = true;
		error = '';
		try {
			const response = await fetch(`/api/reconciliation/${detail.session.id}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				// The service derives the correct closed status from the arithmetic.
				body: JSON.stringify({ status: ReconSessionStatus.ClosedMatched })
			});
			const result = await response.json().catch(() => null);
			if (!response.ok) throw new Error(result?.error ?? 'Could not close this reconciliation.');
			onUpdated?.(result);
			await auditTrailRef?.refresh();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Could not close this reconciliation.';
		} finally {
			saving = false;
		}
	}

	async function reopenSession() {
		if (!detail || saving || !canChange || !detail.session.canReopen) return;
		saving = true;
		error = '';
		try {
			const response = await fetch(`/api/reconciliation/${detail.session.id}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ status: ReconSessionStatus.Open })
			});
			const result = await response.json().catch(() => null);
			if (!response.ok) throw new Error(result?.error ?? 'Could not reopen this reconciliation.');
			onUpdated?.(result);
			await auditTrailRef?.refresh();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Could not reopen this reconciliation.';
		} finally {
			saving = false;
		}
	}

	async function deleteSession() {
		if (!detail || saving || !canDelete || !detail.session.canDelete) return;
		if (!window.confirm('Delete this reconciliation and return its matched items to uncleared?')) return;
		saving = true;
		const response = await fetch(`/api/reconciliation/${detail.session.id}`, { method: 'DELETE' });
		if (response.ok) onOpenChange(false);
		else {
			const result = await response.json().catch(() => null);
			error = result?.error ?? 'Could not delete this reconciliation.';
			saving = false;
		}
	}
</script>

<Sheet.Root {open} {onOpenChange}>
	<Sheet.Portal>
		<Sheet.Overlay />
		<Sheet.Content
			side={panelSide}
			style={isMobile
				? 'height:100dvh; border-radius:0; border-top:none; display:flex; flex-direction:column; overflow:hidden; gap:0;'
				: 'width:500px; max-width:95vw; display:flex; flex-direction:column; overflow:hidden; gap:0;'}
		>
			{#if detail}
				<div class="sheet-header">
					<div>
						<div class="sheet-eyebrow"><Calculator size={12} /> Reconciliation #{detail.session.id}</div>
						<div class="sheet-title-text">Balance check</div>
					</div>
					<Sheet.Close class="sheet-close"><X size={16} /></Sheet.Close>
				</div>

				<div class="sheet-body">
					{#if error}<div class="error-banner" role="alert">{error}</div>{/if}
					<div class="detail-amount" class:difference-negative={difference < 0}>
						<span class="detail-amount-cur">{difference > 0 ? '+' : difference < 0 ? '−' : ''}{mainCurrencySymbol()}</span>
						<span class="detail-amount-val">{formatMoney(Math.abs(difference))}</span>
					</div>
					<div class="difference-caption">{matched ? 'The balances match' : difference > 0 ? 'Akaun is above the statement' : 'Akaun is below the statement'}</div>
					<div class="detail-statusrow">
						<StatusBadge status={ReconSessionStatusLabels[detail.session.status]} />
						<span class="period">{formatDate(detail.session.startingDate)} – {formatDate(detail.session.periodEndDate)}</span>
					</div>

					<div class="detail-section-label">Balance totals</div>
					<div class="totals">
						<div><span>Starting balance</span><strong>{mainCurrencySymbol()} {formatMoney(detail.session.startingBalance)}</strong></div>
						<div><span>Income ({detail.step1?.inScopeCounts?.incomes ?? 0})</span><strong class="positive">+{mainCurrencySymbol()} {formatMoney(detail.step1?.incomeTotal ?? 0)}</strong></div>
						<div><span>Direct expenses ({detail.step1?.inScopeCounts?.directExpenses ?? 0})</span><strong>−{mainCurrencySymbol()} {formatMoney(detail.step1?.expenseTotal ?? 0)}</strong></div>
						<div><span>Claims ({detail.step1?.inScopeCounts?.claims ?? 0})</span><strong>−{mainCurrencySymbol()} {formatMoney(detail.step1?.claimTotal ?? 0)}</strong></div>
						<div class="total"><span>Expected ending balance</span><strong>{mainCurrencySymbol()} {formatMoney(detail.step1?.expected ?? detail.session.computedBalance ?? 0)}</strong></div>
						<div><span>Statement ending balance</span><strong>{mainCurrencySymbol()} {formatMoney(detail.step1?.entered ?? detail.session.statementEndingBalance)}</strong></div>
					</div>

					{#if detail.drift && ((detail.drift.changed?.length ?? 0) + (detail.drift.deleted?.length ?? 0) > 0)}
						<div class="drift-note">Underlying records have changed since this reconciliation was closed.</div>
					{/if}

					{#if isOpenSession}
						<div class="detail-section-label">Bank statement</div>
						<div class="statement-actions">
							{#if detail.session.statementState === StatementExtractionState.Extracting}
								<p>Extracting statement transactions…</p>
							{:else if detail.session.statementState === StatementExtractionState.Failed}
								<p class="statement-error">{detail.session.statementError ?? 'Statement extraction failed.'}</p>
							{:else if detail.session.statementState === StatementExtractionState.Ready}
								<p>Statement lines are ready for review.</p>
							{:else}
								<p>Upload a PDF or image, or enter statement lines manually.</p>
							{/if}
							<div class="statement-buttons">
								<input bind:this={fileInput} class="visually-hidden" type="file" accept="application/pdf,image/jpeg,image/png" onchange={uploadSelected} />
								<button type="button" class="sheet-btn" disabled={uploading || !canChange} onclick={() => fileInput?.click()}>
									<Upload size={14} /> {uploading ? 'Uploading…' : 'Upload statement'}
								</button>
								<button type="button" class="sheet-btn" disabled={!canChange} onclick={() => (lineSheetOpen = true)}>
									<Plus size={14} /> Add line manually
								</button>
							</div>
						</div>
					{/if}
					<AuditTrail bind:this={auditTrailRef} recordType="reconciliation" recordId={detail.session.id} />
				</div>

				<div class="sheet-foot">
					<div class="sheet-foot-actions">
						{#if canDelete && detail.session.canDelete}
							<button type="button" class="sheet-btn sheet-btn-delete" disabled={saving} onclick={deleteSession}>Delete</button>
						{/if}
						<button type="button" class="sheet-btn" onclick={() => onOpenChange(false)}>Close</button>
						{#if !matched && onEscalate}
							<button type="button" class="sheet-btn" onclick={onEscalate}>Escalate to line-by-line</button>
						{/if}
						{#if isOpenSession && canChange}
							<button type="button" class="sheet-btn sheet-btn-primary" disabled={saving} onclick={closeSession}>
								{saving ? 'Closing…' : 'Close reconciliation'}
							</button>
						{/if}
						{#if !isOpenSession && canChange && detail.session.canReopen}
							<button type="button" class="sheet-btn sheet-btn-primary" disabled={saving} onclick={reopenSession}>Reopen</button>
						{/if}
					</div>
				</div>
			{/if}
		</Sheet.Content>
	</Sheet.Portal>
</Sheet.Root>

{#if detail}
	<StatementLineSheet
		open={lineSheetOpen}
		onOpenChange={(value) => (lineSheetOpen = value)}
		sessionId={detail.session.id}
		canDelete={canChange}
	/>
{/if}

<style>
	.sheet-header { display:flex; align-items:flex-start; justify-content:space-between; padding:22px 22px 16px; border-bottom:1px solid var(--border); }
	.sheet-body { flex:1; overflow-y:auto; padding:20px 22px; }
	.difference-caption { margin-top:4px; color:var(--muted-foreground); font-size:12px; }
	.detail-statusrow { display:flex; align-items:center; gap:8px; margin-top:12px; }
	.period { font-size:12px; color:var(--muted-foreground); }
	.totals { border:1px solid var(--border); border-radius:8px; overflow:hidden; }
	.totals > div { display:flex; justify-content:space-between; gap:16px; padding:10px 12px; border-bottom:1px solid var(--border); font-size:13px; }
	.totals > div:last-child { border-bottom:0; }
	.totals span { color:var(--muted-foreground); }
	.totals strong { font-family:'Geist Mono', monospace; font-weight:600; text-align:right; }
	.totals .total { background:var(--muted); }
	.positive { color:var(--green); }
	.difference-negative .detail-amount-val, .difference-negative .detail-amount-cur { color:var(--red); }
	.error-banner, .drift-note { margin-bottom:16px; padding:10px 12px; border-radius:8px; font-size:13px; }
	.error-banner { color:var(--red); background:var(--red-soft); }
	.drift-note { margin-top:16px; color:var(--amber); background:var(--amber-soft); }
	.statement-actions { display:grid; gap:12px; border:1px solid var(--border); border-radius:8px; padding:12px; }
	.statement-actions p { margin:0; color:var(--muted-foreground); font-size:13px; }
	.statement-actions .statement-error { color:var(--red); }
	.statement-buttons { display:flex; flex-wrap:wrap; gap:8px; }
	.statement-buttons .sheet-btn { display:inline-flex; align-items:center; gap:6px; }
	.visually-hidden { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; }
</style>
