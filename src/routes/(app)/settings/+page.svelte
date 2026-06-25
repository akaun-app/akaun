<script lang="ts">
	import { enhance } from '$app/forms';
	import { Plus, X, Lock } from '@lucide/svelte';
	import { Slider } from '$lib/components/ui/slider/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { toast } from 'svelte-sonner';
	import { CURRENCIES } from '$lib/currency.js';
	import type { PageData, ActionData } from './$types.js';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	type Tab = 'general' | 'intelligence' | 'categories' | 'advanced';
	let activeTab = $state<Tab>('general');

	// Currency settings state
	// svelte-ignore state_referenced_locally
	let mainCur = $state(data.currency);

	const curLabel = $derived(
		(() => {
			const c = CURRENCIES.find((x) => x.code === mainCur);
			return c ? `${c.code} — ${c.name}` : mainCur;
		})()
	);

	// Expense categories state
	// svelte-ignore state_referenced_locally
	let expCats = $state<string[]>([...data.expenseCategories]);
	let newExpCat = $state('');

	// Intelligence settings state
	// svelte-ignore state_referenced_locally
	let aiApiKey = $state(data.autoImportApiKey);
	// svelte-ignore state_referenced_locally
	let aiModel = $state(data.autoImportModel);
	// svelte-ignore state_referenced_locally
	let aiParallelTasks = $state(data.autoImportParallelTasks);
	// svelte-ignore state_referenced_locally
	let aiCategoryHints = $state(data.autoImportCategoryHints);

	// OpenRouter model fetching
	type ORModel = { id: string; name: string; isFree: boolean };
	let orModels = $state<ORModel[]>([]);
	let orFetching = $state(false);
	let orError = $state('');
	// svelte-ignore state_referenced_locally
	let showFreeOnly = $state(data.autoImportFreeModelsOnly);

	const filteredModels = $derived(showFreeOnly ? orModels.filter((m) => m.isFree) : orModels);

	$effect(() => {
		if (filteredModels.length > 0 && !filteredModels.find((m) => m.id === aiModel)) {
			aiModel = filteredModels[0].id;
		}
	});

	// Income categories state
	// svelte-ignore state_referenced_locally
	let incCats = $state<string[]>([...data.incomeCategories]);
	let newIncCat = $state('');

	// Advanced state
	// svelte-ignore state_referenced_locally
	let godMode = $state(data.godModeEnabled);

	function addExpCat() {
		const v = newExpCat.trim();
		if (v && !expCats.includes(v)) {
			expCats = [...expCats, v];
			newExpCat = '';
		}
	}

	function removeExpCat(cat: string) {
		expCats = expCats.filter((c) => c !== cat);
	}

	function addIncCat() {
		const v = newIncCat.trim();
		if (v && !incCats.includes(v)) {
			incCats = [...incCats, v];
			newIncCat = '';
		}
	}

	function removeIncCat(cat: string) {
		incCats = incCats.filter((c) => c !== cat);
	}

	function handleExpKey(e: KeyboardEvent) {
		if (e.key === 'Enter') { e.preventDefault(); addExpCat(); }
	}

	function handleIncKey(e: KeyboardEvent) {
		if (e.key === 'Enter') { e.preventDefault(); addIncCat(); }
	}

	// Re-sync local AI state after successful save
	$effect(() => {
		if (form?.success) {
			aiApiKey = data.autoImportApiKey;
			aiModel = data.autoImportModel;
			aiParallelTasks = data.autoImportParallelTasks;
			aiCategoryHints = data.autoImportCategoryHints;
			showFreeOnly = data.autoImportFreeModelsOnly;
			mainCur = data.currency;
			toast.success('Settings saved');
		}
	});

	// Fetch OpenRouter models when API key changes (debounced)
	$effect(() => {
		const key = aiApiKey;
		if (!key) { orModels = []; orError = ''; return; }
		const t = setTimeout(() => fetchModels(key), 600);
		return () => clearTimeout(t);
	});

	async function fetchModels(key: string) {
		orFetching = true;
		orError = '';
		try {
			const res = await fetch('https://openrouter.ai/api/v1/models', {
				headers: { Authorization: `Bearer ${key}` }
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const json = await res.json();
			const raw: { id: string; name: string; pricing?: { prompt?: string } }[] = json.data ?? [];
			orModels = raw
				.map((m) => ({
					id: m.id,
					name: m.name,
					isFree: parseFloat(m.pricing?.prompt ?? '1') === 0
				}))
				.sort((a, b) => a.name.localeCompare(b.name));
			if (!orModels.find((m) => m.id === aiModel)) {
				aiModel = orModels[0]?.id ?? aiModel;
			}
		} catch (err) {
			orError = err instanceof Error ? err.message : 'Failed to fetch models';
		} finally {
			orFetching = false;
		}
	}

	const TABS: { id: Tab; label: string }[] = [
		{ id: 'general', label: 'General' },
		{ id: 'intelligence', label: 'Intelligence' },
		{ id: 'categories', label: 'Categories' },
		{ id: 'advanced', label: 'Advanced' }
	];
</script>

<svelte:head>
	<title>Settings - Akaun</title>
</svelte:head>

<div class="screen">
	<header class="topbar">
		<div class="topbar-left">
			<h1 class="page-title">Settings</h1>
			<p class="page-sub">Configure your workspace</p>
		</div>
	</header>

	<div class="set-layout">
		<!-- Left nav -->
		<nav class="set-nav">
			{#each TABS as tab}
				<button
					class="set-nav-item"
					class:active={activeTab === tab.id}
					onclick={() => (activeTab = tab.id)}
				>
					{tab.label}
				</button>
			{/each}
		</nav>

		<!-- Content -->
		<div class="set-content">
			{#if activeTab === 'general'}
				<div class="set-section">
					<div class="set-section-head">
						<h2 class="set-section-title">General</h2>
						<p class="set-section-sub">Account and display settings</p>
					</div>
					<form method="POST" action="?/saveCurrency" use:enhance={() => ({ update }) => update({ reset: false })}>
						<input type="hidden" name="currencyCode" value={mainCur} />
						<div class="set-rows">
							<div class="set-row">
								<div>
									<div class="set-row-label">Currency</div>
									<div class="set-row-value" style="font-size:12px; margin-top:2px;">All amounts display in this currency; foreign records are converted to it</div>
								</div>
								<Select.Root type="single" name="mainCurrencyDisplay" bind:value={mainCur}>
									<Select.Trigger class="set-input-right set-input-wide">{curLabel}</Select.Trigger>
									<Select.Content>
										{#each CURRENCIES as c (c.code)}
											<Select.Item value={c.code} label={`${c.code} — ${c.name}`} />
										{/each}
									</Select.Content>
								</Select.Root>
							</div>
						</div>
						<Button type="submit" class="mt-4">Save</Button>
					</form>
				</div>

			{:else if activeTab === 'intelligence'}
				<div class="set-section">
					<div class="set-section-head">
						<h2 class="set-section-title">Intelligence</h2>
						<p class="set-section-sub">Auto-import reads receipts with OCR and an LLM to fill fields.</p>
					</div>
					<form method="POST" action="?/saveIntelligence" use:enhance={() => ({ update }) => update({ reset: false })}>
						<input type="hidden" name="categoryHints" value={String(aiCategoryHints)} />
					<input type="hidden" name="freeModelsOnly" value={String(showFreeOnly)} />
						<div class="set-rows">
							<div class="set-row">
								<div>
									<div class="set-row-label">API key</div>
									<div class="set-row-value" style="font-size:12px; margin-top:2px;">OpenRouter key used for document understanding</div>
								</div>
								<Input
									class="set-input-right shrink-0"
									type="password"
									name="apiKey"
									placeholder="sk-or-v1-…"
									value={aiApiKey}
									oninput={(e) => (aiApiKey = (e.target as HTMLInputElement).value)}
								/>
							</div>
							<div class="set-row">
								<div>
									<div class="set-row-label">Model</div>
									{#if orFetching}
										<div class="set-row-value" style="font-size:12px; margin-top:2px; display:flex; align-items:center; gap:6px;">
											<span class="spinner sm"></span> Fetching models…
										</div>
									{:else if orError}
										<div class="set-row-value" style="font-size:12px; margin-top:2px; color:var(--red);">{orError}</div>
									{:else if aiApiKey && orModels.length === 0}
										<div class="set-row-value" style="font-size:12px; margin-top:2px;">Enter API key to load models</div>
									{/if}
								</div>
								<div style="display:flex; align-items:center; gap:8px; flex-shrink:0;">
									<Select.Root type="single" name="model" bind:value={aiModel} disabled={orModels.length === 0}>
										<Select.Trigger class="set-input-right set-input-wide">
											{orModels.length === 0
												? 'Enter API key to load models'
												: filteredModels.find((m) => m.id === aiModel)?.name ?? 'Select model'}
										</Select.Trigger>
										<Select.Content>
											{#each filteredModels as m (m.id)}
												<Select.Item value={m.id} label={m.name} />
											{/each}
										</Select.Content>
									</Select.Root>
								</div>
							</div>
							<div class="set-row">
								<div>
									<div class="set-row-label">Free models only</div>
									<div class="set-row-value" style="font-size:12px; margin-top:2px;">Only show models with no usage cost</div>
								</div>
								<button
									type="button"
									class="toggle-btn"
									aria-label="Free models only"
									class:on={showFreeOnly}
									onclick={() => { showFreeOnly = !showFreeOnly; }}
									aria-pressed={showFreeOnly}
								>
									<span class="toggle-thumb"></span>
								</button>
							</div>
							<div class="set-row">
								<div>
									<div class="set-row-label">Parallel tasks</div>
									<div class="set-row-value" style="font-size:12px; margin-top:2px;">Process up to {aiParallelTasks} file{aiParallelTasks !== 1 ? 's' : ''} at once</div>
								</div>
								<div class="slider-row">
									<input type="hidden" name="parallelTasks" value={aiParallelTasks} />
									<Slider
										type="multiple"
										min={1}
										max={10}
										step={1}
										value={[aiParallelTasks]}
										onValueChange={(v: number[]) => (aiParallelTasks = v[0])}
										style="width:140px;"
									/>
									<span class="slider-val num">{aiParallelTasks}</span>
								</div>
							</div>
							<div class="set-row">
								<div>
									<div class="set-row-label">Category hints</div>
									<div class="set-row-value" style="font-size:12px; margin-top:2px;">Learn from your last 100 categorised items</div>
								</div>
								<button
									type="button"
									class="toggle-btn"
									aria-label="Category hints"
									class:on={aiCategoryHints}
									onclick={() => { aiCategoryHints = !aiCategoryHints; }}
									aria-pressed={aiCategoryHints}
								>
									<span class="toggle-thumb"></span>
								</button>
							</div>
						</div>
						<Button type="submit" class="mt-4">Save</Button>
					</form>
				</div>

			{:else if activeTab === 'categories'}
				<div class="set-section">
					<div class="set-section-head">
						<h2 class="set-section-title">Expense Categories</h2>
						<p class="set-section-sub">Categories available when recording expenses</p>
					</div>
					<form method="POST" action="?/saveExpenseCategories" use:enhance>
						<input type="hidden" name="categories" value={JSON.stringify(expCats)} />
						<div class="cat-chips">
							{#each expCats as cat}
								<span class="cat-chip-removable">
									{cat}
									<button type="button" class="chip-remove" onclick={() => removeExpCat(cat)} aria-label="Remove {cat}">
										<X size={11} />
									</button>
								</span>
							{/each}
						</div>
						<div class="cat-add-row">
							<Input class="flex-1 min-w-0" type="text" placeholder="New category name..." bind:value={newExpCat} onkeydown={handleExpKey} />
							<Button type="button" variant="ghost" onclick={addExpCat}><Plus size={14} /> Add</Button>
						</div>
						<Button type="submit" class="mt-4">Save</Button>
					</form>
				</div>

				<div class="set-section" style="margin-top:32px;">
					<div class="set-section-head">
						<h2 class="set-section-title">Income Categories</h2>
						<p class="set-section-sub">Categories available when recording income</p>
					</div>
					<form method="POST" action="?/saveIncomeCategories" use:enhance>
						<input type="hidden" name="categories" value={JSON.stringify(incCats)} />
						<div class="cat-chips">
							{#each incCats as cat}
								<span class="cat-chip-removable">
									{cat}
									<button type="button" class="chip-remove" onclick={() => removeIncCat(cat)} aria-label="Remove {cat}">
										<X size={11} />
									</button>
								</span>
							{/each}
						</div>
						<div class="cat-add-row">
							<Input class="flex-1 min-w-0" type="text" placeholder="New category name..." bind:value={newIncCat} onkeydown={handleIncKey} />
							<Button type="button" variant="ghost" onclick={addIncCat}><Plus size={14} /> Add</Button>
						</div>
						<Button type="submit" class="mt-4">Save</Button>
					</form>
				</div>

			{:else if activeTab === 'advanced'}
				<div class="set-section">
					<div class="set-section-head">
						<h2 class="set-section-title">Advanced</h2>
						<p class="set-section-sub">Power-user controls. Use with care.</p>
					</div>
					<form method="POST" action="?/saveAdvanced" use:enhance={() => ({ update }) => update({ reset: false })}>
						<input type="hidden" name="godMode" value={String(godMode)} />
						<div class="set-rows">
							<div class="set-row">
								<div>
									<div class="set-row-label">God Mode</div>
									<div class="set-row-value" style="font-size:12px; margin-top:2px;">Allow editing descriptive fields on claimed expenses. Amounts stay locked.</div>
								</div>
								<button
									type="button"
									class="toggle-btn"
									aria-label="God Mode"
									class:on={godMode}
									onclick={() => { godMode = !godMode; }}
									aria-pressed={godMode}
								>
									<span class="toggle-thumb"></span>
								</button>
							</div>
							{#if godMode}
								<div class="warn-banner">
									<Lock size={13} /> God Mode is on — descriptive fields are editable on locked records.
								</div>
							{/if}
						</div>
						<Button type="submit" class="mt-4">Save</Button>
					</form>
				</div>
			{/if}
		</div>
	</div>
</div>

<style>
	.cat-add-row {
		display: flex;
		gap: 8px;
		align-items: center;
		margin-top: 12px;
	}

	.chip-remove {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: none;
		border: none;
		padding: 1px;
		cursor: pointer;
		color: inherit;
		opacity: 0.6;
		border-radius: 2px;
	}

	.chip-remove:hover {
		opacity: 1;
		background: oklch(0 0 0 / 0.1);
	}

	.warn-banner {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 8px 12px;
		background: oklch(0.97 0.04 85 / 0.6);
		border: 1px solid oklch(0.85 0.1 85);
		border-radius: var(--radius);
		font-size: 12px;
		color: oklch(0.45 0.15 70);
		margin: 0 16px;
	}

	:global(.dark) .warn-banner {
		background: oklch(0.25 0.05 85 / 0.4);
		border-color: oklch(0.4 0.1 85);
		color: oklch(0.75 0.1 85);
	}


</style>
