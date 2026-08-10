<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { ArrowLeft, Check, ChevronRight, Search, Undo2 } from '@lucide/svelte';
	import { LeftoverAnnotation, ReconItemType, ReconSessionStatus } from '$lib/enums.js';
	import type { LeftoverAnnotationCode } from '$lib/enums.js';
	import { formatDate, formatMoney } from '$lib/format.js';
	import { useIsMobile } from '$lib/hooks/useIsMobile.svelte.js';
	import { createResourceStream, mergeById } from '$lib/sse.js';
	import MatchPickerSheet from './MatchPickerSheet.svelte';
	import StatementLineSheet from './StatementLineSheet.svelte';
	import type { loadMatchWorkspace } from '$lib/server/loaders/reconciliation.js';

	type Data = ReturnType<typeof loadMatchWorkspace>;
	type Line = Data['lines'][number];
	type Candidate = Data['candidates'][number];
	type StreamEvent =
		| { type: 'line-update'; line: Line }
		| { type: 'line-deleted'; id: number; sessionId: number }
		| { type: 'lines-added'; sessionId: number; lines: Line[] }
		| { type: 'item-state-update'; itemType: number; itemId: number; cleared: boolean; clearedLineId: number | null; annotation: LeftoverAnnotationCode | null }
		| { type: 'session-deleted'; id: number };

	let { data }: { data: Data } = $props();
	// svelte-ignore state_referenced_locally
	let lines = $state(data.lines);
	// svelte-ignore state_referenced_locally
	let candidates = $state(data.candidates);
	// svelte-ignore state_referenced_locally
	let selectedLineId = $state<number | null>(lines[0]?.id ?? null);
	let pickerOpen = $state(false);
	let lineSheetOpen = $state(false);
	let editLine = $state<Line | null>(null);
	let mobileTab = $state<'lines' | 'candidates'>('lines');
	let error = $state('');

	const screen = useIsMobile();
	const isMobile = $derived(screen.current);
	const selectedLine = $derived(lines.find((line) => line.id === selectedLineId) ?? null);
	const unmatchedLines = $derived(lines.filter((line) => line.matchedItemType === null));
	const unclearedItems = $derived(candidates.filter((candidate) => !candidate.cleared));
	const unmatchedLineTotal = $derived(unmatchedLines.reduce((sum, line) => sum + line.amount, 0));
	const unclearedItemTotal = $derived(
		unclearedItems.reduce((sum, item) => sum + item.amount * item.exchangeRate, 0)
	);

	// Mirrors src/lib/server/reconciliation/session-rules.ts's isBankFacing — claimed expenses
	// never move the bank independently and therefore cannot be controlled here.
	function isBankFacing(item: Candidate): boolean {
		return item.itemType !== ReconItemType.Expense || item.claimId == null;
	}

	// Mirrors src/lib/server/reconciliation/session-rules.ts's canMutateSession — the loader's
	// canDelete/canReopen flags are derived from the same highest-id chain rule.
	function canMutateSession(): boolean {
		return data.session.status === ReconSessionStatus.Open && data.session.canDelete;
	}

	const canChange = $derived(data.permissions.change && canMutateSession());

	createResourceStream<StreamEvent>('/api/reconciliation/stream', (event) => {
		if (event.type === 'line-update') lines = mergeById(lines, [event.line]);
		else if (event.type === 'line-deleted') lines = lines.filter((line) => line.id !== event.id);
		else if (event.type === 'lines-added' && event.sessionId === data.session.id) {
			lines = mergeById(lines, event.lines);
		} else if (event.type === 'item-state-update') {
			candidates = candidates.map((item) =>
				item.itemType === event.itemType && item.itemId === event.itemId
					? { ...item, cleared: event.cleared, clearedLineId: event.clearedLineId, annotation: event.annotation }
					: item
			);
		} else if (event.type === 'session-deleted' && event.id === data.session.id) {
			void goto(resolve('/reconciliation'));
		}
	});

	async function mutate(url: string, method: string, body?: object): Promise<boolean> {
		error = '';
		const response = await fetch(url, {
			method,
			headers: body ? { 'content-type': 'application/json' } : undefined,
			body: body ? JSON.stringify(body) : undefined
		});
		if (response.ok) return true;
		const result = await response.json().catch(() => null);
		error = result?.error ?? 'The reconciliation could not be updated.';
		return false;
	}

	async function accept(candidate: Candidate | NonNullable<Line['suggestion']>) {
		if (!selectedLine || !canChange) return;
		await mutate(`/api/reconciliation/${data.session.id}/lines/${selectedLine.id}/match`, 'PUT', {
			itemType: candidate.itemType,
			itemId: candidate.itemId
		});
		pickerOpen = false;
	}

	async function undo(line: Line) {
		if (!canChange) return;
		await mutate(`/api/reconciliation/${data.session.id}/lines/${line.id}/match`, 'DELETE');
	}

	async function annotate(item: Candidate, annotation: number | null) {
		if (!canChange) return;
		await mutate(`/api/reconciliation/${data.session.id}/annotations`, 'PUT', {
			itemType: item.itemType,
			itemId: item.itemId,
			annotation
		});
	}

	function openLine(line: Line) {
		editLine = line;
		lineSheetOpen = true;
	}
</script>

<div class="workspace">
	<header class="workspace-head">
		<button class="sheet-btn" type="button" onclick={() => goto(resolve('/(app)/reconciliation/[id]', { id: String(data.session.id) }))}>
			<ArrowLeft size={14} /> Back
		</button>
		<div><span>Reconciliation #{data.session.id}</span><strong>{formatDate(data.session.startingDate)} – {formatDate(data.session.periodEndDate)}</strong></div>
		<div class="difference">Difference {formatMoney(data.step1.difference ?? 0)}</div>
	</header>

	{#if error}<div class="error-banner">{error}</div>{/if}
	{#if isMobile}
		<div class="mobile-tabs">
			<button class:active={mobileTab === 'lines'} onclick={() => (mobileTab = 'lines')}>Statement lines</button>
			<button class:active={mobileTab === 'candidates'} onclick={() => (mobileTab = 'candidates')}>Candidates</button>
		</div>
	{/if}

	<div class="columns">
		<section class:hidden={isMobile && mobileTab !== 'lines'}>
			<h2>Statement lines <span>{unmatchedLines.length} unmatched</span></h2>
			<div class="rows">
				{#each lines as line (line.id)}
					<div class="line-row" class:selected={line.id === selectedLineId} class:duplicate={line.isDuplicate}>
						<button type="button" onclick={() => (selectedLineId = line.id)}>
							<span><strong>{line.description}</strong><small>{formatDate(line.date)}{line.isDuplicate ? ' · Possible duplicate' : ''}</small></span>
							<b>{formatMoney(line.amount)}</b>
						</button>
						<div class="row-actions">
							<button class="icon-btn" title="Edit line" onclick={() => openLine(line)}><ChevronRight size={14} /></button>
							{#if line.matchedItemType !== null}<button class="icon-btn" title="Undo match" disabled={!canChange} onclick={() => undo(line)}><Undo2 size={14} /></button>{/if}
						</div>
					</div>
				{/each}
			</div>
		</section>

		<section class:hidden={isMobile && mobileTab !== 'candidates'}>
			<h2>Suggested matches <span>{unclearedItems.length} remaining</span></h2>
			{#if selectedLine}
				{#if selectedLine.suggestion}
					<button class="candidate related-link" disabled={!canChange} onclick={() => accept(selectedLine.suggestion!)}>
						<span><strong>{selectedLine.suggestion.label}</strong><small>Score {selectedLine.suggestion.score}</small></span>
						<Check size={15} />
					</button>
				{/if}
				<button class="sheet-btn search-all" disabled={!canChange} onclick={() => (pickerOpen = true)}><Search size={14} /> Search all candidates</button>
			{:else}<p>Select a statement line.</p>{/if}

			<h3>Akaun leftovers</h3>
			<div class="rows">
				{#each unclearedItems.filter(isBankFacing) as item (`${item.itemType}-${item.itemId}`)}
					<div class="leftover-row">
						<span><strong>{item.label}</strong><small>{formatDate(item.date)} · {formatMoney(item.amount * item.exchangeRate)}</small></span>
						<div>
							<button title="Not yet cleared" disabled={!canChange} class:active={item.annotation === LeftoverAnnotation.NotYetCleared} onclick={() => annotate(item, LeftoverAnnotation.NotYetCleared)}>Later</button>
							<button title="Will not clear" disabled={!canChange} class:active={item.annotation === LeftoverAnnotation.WillNotClear} onclick={() => annotate(item, LeftoverAnnotation.WillNotClear)}>Never</button>
						</div>
					</div>
				{/each}
			</div>
		</section>
	</div>

	<footer class="workspace-foot">
		<span>Bank leftovers: {formatMoney(unmatchedLineTotal)}</span>
		<span>Akaun leftovers: {formatMoney(unclearedItemTotal)}</span>
		<strong>Step 1 difference: {formatMoney(data.step1.difference ?? 0)}</strong>
	</footer>
</div>

<MatchPickerSheet open={pickerOpen} onOpenChange={(open) => (pickerOpen = open)} {candidates} selectedLineId={selectedLineId ?? 0} sessionId={data.session.id} onSelect={accept} />
<StatementLineSheet open={lineSheetOpen} onOpenChange={(open) => (lineSheetOpen = open)} sessionId={data.session.id} line={editLine} canDelete={data.permissions.delete && canChange} />

<style>
	.workspace { display:grid; gap:14px; min-height:calc(100dvh - 110px); }
	.workspace-head { display:flex; align-items:center; gap:14px; }
	.workspace-head > div { display:grid; flex:1; }
	.workspace-head span, h2 span, small { color:var(--muted-foreground); font-size:12px; font-weight:400; }
	.difference { text-align:right; font-family:'Geist Mono',monospace; }
	.columns { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:14px; min-height:0; }
	.columns > section { border:1px solid var(--border); border-radius:10px; padding:14px; min-width:0; }
	h2 { display:flex; justify-content:space-between; margin:0 0 12px; font-size:15px; }
	h3 { margin:20px 0 8px; font-size:13px; }
	.rows { display:grid; gap:7px; }
	.line-row, .leftover-row, .candidate { display:flex; align-items:center; border:1px solid var(--border); border-radius:8px; background:var(--card); }
	.line-row > button, .candidate { flex:1; display:flex; justify-content:space-between; padding:10px; text-align:left; }
	.line-row span, .candidate span, .leftover-row > span { display:grid; }
	.line-row.selected { border-color:var(--primary); }
	.line-row.duplicate { box-shadow:inset 3px 0 var(--amber); }
	.row-actions { display:flex; padding-right:6px; }
	.icon-btn { padding:7px; border-radius:6px; }
	.leftover-row { justify-content:space-between; gap:10px; padding:10px; }
	.leftover-row > div { display:flex; gap:4px; }
	.leftover-row button { padding:5px 7px; border:1px solid var(--border); border-radius:6px; font-size:11px; }
	.leftover-row button.active { border-color:var(--primary); background:var(--accent); }
	.search-all { margin-top:8px; display:flex; align-items:center; gap:6px; }
	.workspace-foot { display:flex; justify-content:flex-end; flex-wrap:wrap; gap:16px; color:var(--muted-foreground); font-size:12px; }
	.workspace-foot strong { color:var(--foreground); }
	.mobile-tabs { display:grid; grid-template-columns:1fr 1fr; border:1px solid var(--border); border-radius:8px; padding:3px; }
	.mobile-tabs button { padding:8px; border-radius:6px; }
	.mobile-tabs button.active { background:var(--accent); }
	.hidden { display:none; }
	.error-banner { color:var(--red); background:var(--red-soft); padding:10px 12px; border-radius:8px; }
	@media (max-width: 720px) { .columns { grid-template-columns:1fr; } .workspace-head { align-items:flex-start; flex-wrap:wrap; } .difference { width:100%; text-align:left; } }
</style>
