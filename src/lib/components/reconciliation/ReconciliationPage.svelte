<script lang="ts">
	import { goto, pushState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { Plus, Scale } from '@lucide/svelte';
	import StartSessionSheet from './StartSessionSheet.svelte';
	import SessionDetailSheet from './SessionDetailSheet.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import { ReconSessionStatus, ReconSessionStatusLabels } from '$lib/enums.js';
	import { formatDate, formatMoney } from '$lib/format.js';
	import { createResourceStream, mergeById } from '$lib/sse.js';
	import type { loadReconciliationPage } from '$lib/server/loaders/reconciliation.js';

	type PageData = ReturnType<typeof loadReconciliationPage>;
	type Detail = NonNullable<PageData['selectedSession']>;
	type StreamEvent =
		| { type: 'snapshot'; openSession: PageData['openSession']; lines: unknown[] }
		| { type: 'session-update'; session: PageData['sessions'][number] }
		| { type: 'session-deleted'; id: number };

	let { data, openSessionId }: { data: PageData; openSessionId: number | null } = $props();
	// svelte-ignore state_referenced_locally
	let sessions = $state(data.sessions);
	// svelte-ignore state_referenced_locally
	let openSession = $state(data.openSession);
	// svelte-ignore state_referenced_locally
	let detail = $state<Detail | null>(data.selectedSession);
	// svelte-ignore state_referenced_locally
	let detailOpen = $state(data.selectedSession !== null);
	let createOpen = $state(false);
	let loadingDetail = $state(false);

	createResourceStream<StreamEvent>('/api/reconciliation/stream', (event) => {
		if (event.type === 'snapshot') {
			openSession = event.openSession;
			if (event.openSession) sessions = mergeById(sessions, [event.openSession]);
		} else if (event.type === 'session-update') {
			sessions = mergeById(sessions, [event.session]);
			openSession =
				event.session.status === ReconSessionStatus.Open
					? event.session
					: openSession?.id === event.session.id
						? null
						: openSession;
			if (detail?.session.id === event.session.id) void refreshDetail(event.session.id);
		} else if (event.type === 'session-deleted') {
			sessions = sessions.filter((session) => session.id !== event.id);
			if (detail?.session.id === event.id) void closeDetail();
		}
	});

	async function refreshDetail(id: number): Promise<void> {
		const response = await fetch(`/api/reconciliation/${id}`);
		if (response.ok) detail = await response.json();
	}

	async function openDetail(id: number, options: { push?: boolean } = {}): Promise<void> {
		loadingDetail = true;
		try {
			const response = await fetch(`/api/reconciliation/${id}`);
			if (!response.ok) return;
			detail = await response.json();
			detailOpen = true;
			if (options.push !== false) {
				pushState(resolve('/(app)/reconciliation/[id]', { id: String(id) }), { viaPush: true });
			}
		} finally {
			loadingDetail = false;
		}
	}

	async function closeDetail(): Promise<void> {
		detailOpen = false;
		detail = null;
		if (page.state.viaPush) history.back();
		else await goto(resolve('/reconciliation'), { replaceState: true });
	}

	function handleDetailOpenChange(open: boolean): void {
		if (!open) void closeDetail();
		else detailOpen = true;
	}

	async function handleCreated(created: unknown): Promise<void> {
		createOpen = false;
		const payload = created as { session?: { id?: number }; openSessionId?: number };
		const id = payload.session?.id ?? payload.openSessionId;
		if (id) await openDetail(id);
	}

	function openMatchWorkspace(id: number): void {
		window.location.assign(`${resolve('/reconciliation')}/${id}/match`);
	}

	onMount(() => {
		if (openSessionId !== null && detail === null) void openDetail(openSessionId, { push: false });
	});
</script>


<div class="screen">
	<header class="topbar">
		<div class="topbar-left">
			<h1 class="page-title">Reconciliation</h1>
			<p class="page-sub">Compare Akaun with your bank balance and resolve differences.</p>
		</div>
		{#if data.permissions.add}
			<div class="topbar-right">
			<button class="sheet-btn sheet-btn-primary start-button" type="button" onclick={() => (createOpen = true)} disabled={openSession !== null}>
				<Plus size={15} /> Start reconciliation
			</button>
			</div>
		{/if}
	</header>

	<div class="work">
		<div class="work-main reconciliation-content">
			{#if openSession}
				<section class="open-card">
					<div class="open-card-copy">
						<span class="section-label"><Scale size={13} /> Open session</span>
						<strong>{formatDate(openSession.startingDate)} – {formatDate(openSession.periodEndDate)}</strong>
						<span>Statement balance {formatMoney(openSession.statementEndingBalance)}</span>
					</div>
					<button class="sheet-btn sheet-btn-primary" type="button" onclick={() => openSession && openDetail(openSession.id)}>Continue</button>
				</section>
			{/if}

			<section class="history-section">
				<div class="section-heading">
					<div><h2>History</h2><p>{sessions.length} reconciliation session{sessions.length === 1 ? '' : 's'}</p></div>
				</div>
				{#if sessions.length === 0}
					<div class="empty-history">No reconciliation sessions yet.</div>
				{:else}
					<div class="history-list">
						{#each sessions as session (session.id)}
							<button class="history-row related-link" type="button" onclick={() => openDetail(session.id)} disabled={loadingDetail}>
								<div class="history-main">
									<strong>{formatDate(session.startingDate)} – {formatDate(session.periodEndDate)}</strong>
									<span>{formatMoney(session.startingBalance)} → {formatMoney(session.statementEndingBalance)}</span>
									<span>{session.clearedCount} cleared · {session.unclearedCount} uncleared · {session.unmatchedLineCount} unmatched lines</span>
									{#if session.hasDrift}<span class="drift-banner">Underlying ledger data changed after closing</span>{/if}
								</div>
								<StatusBadge status={ReconSessionStatusLabels[session.status]} />
							</button>
						{/each}
					</div>
				{/if}
			</section>
		</div>
	</div>
</div>

<StartSessionSheet open={createOpen} onOpenChange={(open) => (createOpen = open)} prefill={data.prefill} onCreated={handleCreated} />
<SessionDetailSheet open={detailOpen} onOpenChange={handleDetailOpenChange} {detail} canChange={data.permissions.change && Boolean(detail?.session.canDelete)} canDelete={data.permissions.delete && Boolean(detail?.session.canDelete)} onUpdated={(value) => (detail = value as Detail)} onEscalate={() => detail && openMatchWorkspace(detail.session.id)} />

<style>
	.reconciliation-content { display: flex; flex-direction: column; gap: 22px; padding: 20px 28px 28px; overflow-y: auto; }
	.start-button { min-width: 154px; justify-content: center; }
	.open-card { display: flex; justify-content: space-between; align-items: center; gap: 20px; border: 1px solid var(--border); border-radius: var(--radius); padding: 18px 20px; background: var(--card); box-shadow: var(--shadow-sm); }
	.open-card-copy, .history-main { display: grid; gap: 4px; min-width: 0; text-align: left; }
	.open-card-copy > span:last-child, .history-row span, .section-heading p { color: var(--muted-foreground); }
	.section-label { display: flex; align-items: center; gap: 6px; color: var(--primary); font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; }
	.history-section { min-height: 0; }
	.section-heading { display: flex; align-items: end; justify-content: space-between; margin-bottom: 10px; }
	.section-heading h2 { margin: 0; font-size: 16px; }
	.section-heading p { margin: 2px 0 0; font-size: 12px; }
	.history-list { display: grid; gap: 8px; }
	.history-row { width: 100%; display: flex; justify-content: space-between; align-items: center; gap: 16px; border: 1px solid var(--border); border-radius: 9px; padding: 13px 14px; background: var(--card); color: inherit; font: inherit; }
	.history-main { overflow: hidden; }
	.history-main strong, .history-main span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.history-row .drift-banner { color: var(--amber); }
	.empty-history { border: 1px dashed var(--border); border-radius: 10px; padding: 36px 24px; color: var(--muted-foreground); text-align: center; background: var(--card); }
	@media (max-width: 767px) {
		.reconciliation-content { padding: 16px; overflow: visible; }
		.start-button { min-width: 0; }
		.open-card { align-items: stretch; flex-direction: column; padding: 16px; }
		.open-card .sheet-btn { justify-content: center; width: 100%; }
		.history-row { align-items: flex-start; }
		.history-main strong, .history-main span { white-space: normal; }
	}
</style>
