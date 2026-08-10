<script lang="ts">
	import { ChevronRight, Search, Sparkles, X } from '@lucide/svelte';
	import { mainCurrencySymbol, formatMoney } from '$lib/currency-state.svelte.js';
	import { ReconItemTypeLabels } from '$lib/enums.js';
	import { useIsMobile } from '$lib/hooks/useIsMobile.svelte.js';
	import { Input } from '$lib/components/ui/input';
	import * as Sheet from '$lib/components/ui/sheet';
	import type { BankFacingItem, RankedCandidate } from '$lib/server/reconciliation/types.js';

	type Candidate = BankFacingItem | RankedCandidate;

	let {
		open,
		onOpenChange,
		candidates,
		allItems = candidates,
		selectedLineId,
		sessionId,
		onSelect
	}: {
		open: boolean;
		onOpenChange: (open: boolean) => void;
		candidates: Candidate[];
		allItems?: Candidate[];
		selectedLineId: number;
		sessionId: number;
		onSelect?: (candidate: Candidate) => void;
	} = $props();

	const screen = useIsMobile();
	const isMobile = $derived(screen.current);
	const panelSide = $derived(isMobile ? 'bottom' : 'right');

	let search = $state('');
	let initializedOpen = $state(false);

	const rankedCandidates = $derived(
		[...candidates].sort((a, b) => ('score' in b ? b.score : 0) - ('score' in a ? a.score : 0))
	);
	const rankedKeys = $derived(new Set(candidates.map(candidateKey)));
	const manualResults = $derived.by(() => {
		const query = search.trim().toLocaleLowerCase();
		if (!query) return [];
		return allItems.filter((candidate) => {
			const haystack = [
				candidate.label,
				candidate.date,
				ReconItemTypeLabels[candidate.itemType],
				'contactName' in candidate ? candidate.contactName : ''
			]
				.filter(Boolean)
				.join(' ')
				.toLocaleLowerCase();
			return haystack.includes(query);
		});
	});

	$effect(() => {
		if (open && !initializedOpen) {
			search = '';
			initializedOpen = true;
		} else if (!open) {
			initializedOpen = false;
		}
	});

	function candidateKey(candidate: Candidate): string {
		return `${candidate.itemType}:${candidate.itemId}`;
	}

	function typeLabel(candidate: Candidate): string {
		const label = ReconItemTypeLabels[candidate.itemType] ?? 'item';
		return label.charAt(0).toUpperCase() + label.slice(1);
	}

	function isUnavailable(candidate: Candidate): boolean {
		return (
			'cleared' in candidate &&
			candidate.cleared === true &&
			(candidate.clearedSessionId !== sessionId || candidate.clearedLineId !== selectedLineId)
		);
	}

	function select(candidate: Candidate) {
		if (isUnavailable(candidate)) return;
		onSelect?.(candidate);
		onOpenChange(false);
	}
</script>

<Sheet.Root {open} onOpenChange={onOpenChange}>
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
					<div class="sheet-eyebrow"><Sparkles size={12} /> Reconciliation match</div>
					<div class="sheet-title-text">Choose an Akaun item</div>
				</div>
				<Sheet.Close class="sheet-close"><X size={16} /></Sheet.Close>
			</div>

			<div class="sheet-body">
				<div class="search-wrap">
					<Search size={15} aria-hidden="true" />
					<Input
						id="match-item-search"
						type="search"
						placeholder="Search all eligible items"
						aria-label="Search all eligible items"
						bind:value={search}
					/>
				</div>

				{#if search.trim()}
					<div class="section-label">Search results ({manualResults.length})</div>
					<div class="candidate-list">
						{#each manualResults as candidate (candidateKey(candidate))}
							<button
								type="button"
								class="candidate-row related-link"
								disabled={isUnavailable(candidate)}
								onclick={() => select(candidate)}
							>
								<div class="candidate-main">
									<div class="candidate-name">{candidate.label}</div>
									<div class="candidate-sub">
										{typeLabel(candidate)} · {candidate.date}{rankedKeys.has(candidateKey(candidate)) ? ' · Suggested' : ''}
									</div>
								</div>
								<div class="candidate-amount num">{mainCurrencySymbol()} {formatMoney(candidate.amount)}</div>
								<ChevronRight size={13} class="candidate-chevron" />
							</button>
						{:else}
							<div class="empty-state">No eligible items match “{search.trim()}”.</div>
						{/each}
					</div>
				{:else}
					<div class="section-label">Suggested matches ({rankedCandidates.length})</div>
					<div class="candidate-list">
						{#each rankedCandidates as candidate (candidateKey(candidate))}
							<button
								type="button"
								class="candidate-row related-link"
								disabled={isUnavailable(candidate)}
								onclick={() => select(candidate)}
							>
								<div class="candidate-main">
									<div class="candidate-name">{candidate.label}</div>
									<div class="candidate-sub">
										{typeLabel(candidate)} · {candidate.date}{'score' in candidate ? ` · Score ${candidate.score}` : ''}
									</div>
								</div>
								<div class="candidate-amount num">{mainCurrencySymbol()} {formatMoney(candidate.amount)}</div>
								<ChevronRight size={13} class="candidate-chevron" />
							</button>
						{:else}
							<div class="empty-state">No suggested matches. Search above to choose an item manually.</div>
						{/each}
					</div>
				{/if}
			</div>

			<div class="sheet-foot">
				<div class="sheet-foot-actions">
					<button type="button" class="sheet-btn" onclick={() => onOpenChange(false)}>Cancel</button>
				</div>
			</div>
		</Sheet.Content>
	</Sheet.Portal>
</Sheet.Root>

<style>
	.sheet-header { display:flex; align-items:flex-start; justify-content:space-between; padding:22px 22px 16px; border-bottom:1px solid var(--border); }
	.sheet-body { flex:1; overflow-y:auto; padding:20px 22px; }
	.search-wrap { position:relative; display:flex; align-items:center; margin-bottom:20px; }
	.search-wrap :global(svg) { position:absolute; left:11px; z-index:1; color:var(--muted-foreground); pointer-events:none; }
	.search-wrap :global(input) { padding-left:34px; width:100%; }
	.section-label { margin-bottom:9px; color:var(--muted-foreground); font-size:11px; font-weight:600; letter-spacing:.055em; text-transform:uppercase; }
	.candidate-list { display:flex; flex-direction:column; gap:8px; }
	.candidate-row { display:flex; align-items:center; gap:11px; width:100%; border:1px solid var(--border); border-radius:9px; padding:10px 12px; background:var(--card); color:var(--foreground); font-family:inherit; text-align:left; }
	.candidate-row:disabled { cursor:not-allowed; opacity:.5; }
	.candidate-main { flex:1; min-width:0; }
	.candidate-name { overflow:hidden; font-size:13px; font-weight:500; text-overflow:ellipsis; white-space:nowrap; }
	.candidate-sub { margin-top:2px; color:var(--muted-foreground); font-size:11.5px; }
	.candidate-amount { flex-shrink:0; font-size:13px; font-weight:600; }
	:global(.candidate-chevron) { flex-shrink:0; color:var(--muted-foreground); }
	.empty-state { padding:28px 12px; color:var(--muted-foreground); font-size:13px; text-align:center; }
</style>
