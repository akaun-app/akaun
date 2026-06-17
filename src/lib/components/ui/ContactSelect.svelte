<script lang="ts">
	import { onMount } from 'svelte';

	type Candidate = { id: number; legalName: string; score?: number };

	let {
		value = $bindable(null),
		newName = $bindable(null),
		role,
		disabled = false,
		placeholder = 'Search contact…',
		initialLabel = null,
		suggestions = [],
		onChange = undefined
	}: {
		value?: number | null;
		newName?: string | null;
		role: number;
		disabled?: boolean;
		placeholder?: string;
		// Label to show when `value` is pre-set but we haven't fetched its name yet.
		initialLabel?: string | null;
		// Optional fuzzy candidates to show first (import match_candidates).
		suggestions?: Candidate[];
		// Fired whenever the selection changes (existing pick / new name / cleared).
		onChange?: (v: { value: number | null; newName: string | null }) => void;
	} = $props();

	let open = $state(false);
	let query = $state('');
	let debounced = $state('');
	let results = $state<Candidate[]>([]);
	// svelte-ignore state_referenced_locally
	let selectedLabel = $state<string | null>(initialLabel);
	let rootEl: HTMLDivElement;

	// Debounce the search term (mirrors the SearchInput 300ms pattern).
	$effect(() => {
		const t = setTimeout(() => (debounced = query), 300);
		return () => clearTimeout(t);
	});

	$effect(() => {
		const term = debounced.trim();
		if (!open) return;
		const url = `/api/contacts?role=${role}${term ? `&search=${encodeURIComponent(term)}` : ''}`;
		fetch(url)
			.then((r) => (r.ok ? r.json() : []))
			.then((rows: Candidate[]) => {
				results = rows.map((r) => ({ id: r.id, legalName: r.legalName }));
			})
			.catch(() => (results = []));
	});

	// Merge fuzzy suggestions ahead of live results (dedup by id).
	const shown = $derived.by(() => {
		const seen = new Set<number>();
		const out: Candidate[] = [];
		for (const c of [...suggestions, ...results]) {
			if (seen.has(c.id)) continue;
			seen.add(c.id);
			out.push(c);
		}
		return out;
	});

	const typed = $derived(query.trim());
	const showCreate = $derived(
		typed.length > 0 &&
			!shown.some((c) => c.legalName.toLowerCase() === typed.toLowerCase())
	);

	function pick(c: Candidate) {
		value = c.id;
		newName = null;
		selectedLabel = c.legalName;
		open = false;
		query = '';
		onChange?.({ value, newName });
	}

	function createNew() {
		value = null;
		newName = typed;
		selectedLabel = `${typed} (new)`;
		open = false;
		query = '';
		onChange?.({ value, newName });
	}

	function clear() {
		value = null;
		newName = null;
		selectedLabel = null;
		query = '';
		onChange?.({ value, newName });
	}

	onMount(() => {
		const onDocClick = (e: MouseEvent) => {
			if (rootEl && !rootEl.contains(e.target as Node)) open = false;
		};
		document.addEventListener('click', onDocClick);
		return () => document.removeEventListener('click', onDocClick);
	});
</script>

<div class="contact-select" bind:this={rootEl}>
	{#if selectedLabel && !open}
		<button type="button" class="cs-display" {disabled} onclick={() => (open = true)}>
			<span class="cs-label">{selectedLabel}</span>
			{#if !disabled}
				<span
					class="cs-clear"
					role="button"
					tabindex="0"
					aria-label="Clear contact"
					onclick={(e) => {
						e.stopPropagation();
						clear();
					}}
					onkeydown={(e) => {
						if (e.key === 'Enter' || e.key === ' ') {
							e.preventDefault();
							clear();
						}
					}}
				>×</span>
			{/if}
		</button>
	{:else}
		<input
			class="cs-input"
			type="text"
			{placeholder}
			{disabled}
			bind:value={query}
			onfocus={() => (open = true)}
		/>
	{/if}

	{#if open && !disabled}
		<div class="cs-menu">
			{#each shown as c (c.id)}
				<button type="button" class="cs-item" onclick={() => pick(c)}>
					{c.legalName}
				</button>
			{:else}
				{#if !showCreate}
					<div class="cs-empty">No matching contacts</div>
				{/if}
			{/each}
			{#if showCreate}
				<button type="button" class="cs-item cs-create" onclick={createNew}>
					Create “{typed}” <span class="cs-hint">(Business, on confirm)</span>
				</button>
			{/if}
		</div>
	{/if}
</div>

<style>
	.contact-select {
		position: relative;
		width: 100%;
	}
	.cs-input,
	.cs-display {
		width: 100%;
		box-sizing: border-box;
		padding: 0.5rem 0.625rem;
		border: 1px solid var(--border, #d4d4d8);
		border-radius: 0.375rem;
		background: var(--background, #fff);
		font-size: 0.875rem;
		text-align: left;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		cursor: pointer;
	}
	.cs-display:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.cs-label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.cs-clear {
		color: var(--muted-foreground, #71717a);
		font-size: 1rem;
		line-height: 1;
		cursor: pointer;
	}
	.cs-menu {
		position: absolute;
		z-index: 50;
		top: calc(100% + 4px);
		left: 0;
		right: 0;
		max-height: 16rem;
		overflow-y: auto;
		background: var(--background, #fff);
		border: 1px solid var(--border, #d4d4d8);
		border-radius: 0.375rem;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
		padding: 0.25rem;
	}
	.cs-item {
		display: block;
		width: 100%;
		text-align: left;
		padding: 0.5rem 0.625rem;
		border: none;
		background: none;
		border-radius: 0.25rem;
		font-size: 0.875rem;
		cursor: pointer;
	}
	.cs-item:hover {
		background: var(--accent, #f4f4f5);
	}
	.cs-create {
		color: var(--primary, #2563eb);
	}
	.cs-hint {
		color: var(--muted-foreground, #71717a);
		font-size: 0.75rem;
	}
	.cs-empty {
		padding: 0.5rem 0.625rem;
		font-size: 0.875rem;
		color: var(--muted-foreground, #71717a);
	}
</style>
