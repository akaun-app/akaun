<script lang="ts">
	import { onMount } from 'svelte';
	import { cn } from '$lib/utils.js';
	import XIcon from '@lucide/svelte/icons/x';

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

	const controlClass =
		'border-input focus-visible:border-ring focus-visible:ring-[var(--primary-soft)] h-9 w-full rounded-md border bg-card px-3 text-[13.5px] transition-[color,box-shadow] outline-none focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50 flex items-center';

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

<div class="relative w-full" bind:this={rootEl}>
	{#if selectedLabel && !open}
		<button
			type="button"
			class={cn(controlClass, 'justify-between gap-2 text-left cursor-pointer')}
			{disabled}
			onclick={() => (open = true)}
		>
			<span class="overflow-hidden text-ellipsis whitespace-nowrap">{selectedLabel}</span>
			{#if !disabled}
				<span
					role="button"
					tabindex="0"
					aria-label="Clear contact"
					class="text-muted-foreground flex shrink-0 items-center hover:text-foreground"
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
				><XIcon size={13} /></span>
			{/if}
		</button>
	{:else}
		<input
			class={cn(
				controlClass,
				'placeholder:text-muted-foreground',
				open && 'border-ring ring-3 ring-[var(--primary-soft)]'
			)}
			type="text"
			{placeholder}
			{disabled}
			bind:value={query}
			onfocus={() => (open = true)}
		/>
	{/if}

	{#if open && !disabled}
		<div
			class="bg-popover text-popover-foreground ring-foreground/10 absolute top-[calc(100%+4px)] left-0 right-0 z-50 max-h-64 overflow-y-auto rounded-lg p-1.5 shadow-md ring-1"
		>
			{#each shown as c (c.id)}
				<button
					type="button"
					class="hover:bg-accent hover:text-accent-foreground block w-full rounded-md px-2 py-1.5 text-left text-sm"
					onclick={() => pick(c)}
				>
					{c.legalName}
				</button>
			{:else}
				{#if !showCreate}
					<div class="text-muted-foreground px-2 py-1.5 text-sm">No matching contacts</div>
				{/if}
			{/each}
			{#if showCreate}
				<button
					type="button"
					class="hover:bg-accent text-primary block w-full rounded-md px-2 py-1.5 text-left text-sm"
					onclick={createNew}
				>
					Create "{typed}" <span class="text-muted-foreground">(Business, on confirm)</span>
				</button>
			{/if}
		</div>
	{/if}
</div>
