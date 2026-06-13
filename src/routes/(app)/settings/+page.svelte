<script lang="ts">
	import { enhance } from '$app/forms';
	import { Plus, X } from '@lucide/svelte';
	import { Slider } from '$lib/components/ui/slider/index.js';
	import { toast } from 'svelte-sonner';
	import type { PageData, ActionData } from './$types.js';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	type Tab = 'general' | 'intelligence' | 'categories' | 'backup' | 'advanced';
	let activeTab = $state<Tab>('general');

	// Expense categories state
	let expCats = $state<string[]>([...data.expenseCategories]);
	let newExpCat = $state('');

	// Intelligence settings state
	let aiApiKey = $state(data.autoImportApiKey);
	let aiModel = $state(data.autoImportModel);
	let aiParallelTasks = $state(data.autoImportParallelTasks);
	let aiCategoryHints = $state(data.autoImportCategoryHints);

	// OpenRouter model fetching
	type ORModel = { id: string; name: string; isFree: boolean };
	let orModels = $state<ORModel[]>([]);
	let orFetching = $state(false);
	let orError = $state('');
	let showFreeOnly = $state(false);

	const filteredModels = $derived(showFreeOnly ? orModels.filter((m) => m.isFree) : orModels);

	$effect(() => {
		if (filteredModels.length > 0 && !filteredModels.find((m) => m.id === aiModel)) {
			aiModel = filteredModels[0].id;
		}
	});

	// Income categories state
	let incCats = $state<string[]>([...data.incomeCategories]);
	let newIncCat = $state('');

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

	// Re-sync local AI state after successful save (data is updated by use:enhance's invalidateAll)
	$effect(() => {
		if (form?.success) {
			aiApiKey = data.autoImportApiKey;
			aiModel = data.autoImportModel;
			aiParallelTasks = data.autoImportParallelTasks;
			aiCategoryHints = data.autoImportCategoryHints;
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
			const raw: { id: string; name: string; pricing?: { prompt?: string }; canonical_slug?: string }[] =
				json.data ?? [];
			orModels = raw
				.map((m) => ({
					id: m.id,
					name: m.name,
					isFree: (parseFloat(m.pricing?.prompt ?? '1') === 0)
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
		{ id: 'backup', label: 'Backup' },
		{ id: 'advanced', label: 'Advanced' }
	];
</script>

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
					<div class="set-rows">
						<div class="set-row">
							<div class="set-row-label">Username</div>
							<div class="set-row-value">{data.username}</div>
						</div>
						<div class="set-row">
							<div class="set-row-label">Currency</div>
							<div class="set-row-value">
								<span class="cat-chip">{data.currency}</span>
							</div>
						</div>
					</div>
				</div>

			{:else if activeTab === 'intelligence'}
				<div class="set-section">
					<div class="set-section-head">
						<h2 class="set-section-title">Intelligence</h2>
						<p class="set-section-sub">Auto-import reads receipts with OCR and an LLM to fill fields.</p>
					</div>
					<form method="POST" action="?/saveIntelligence" use:enhance={() => ({ update }) => update({ reset: false })}>
						<input type="hidden" name="categoryHints" value={String(aiCategoryHints)} />
						<div class="set-rows">
							<div class="set-row">
								<div>
									<div class="set-row-label">API key</div>
									<div class="set-row-value" style="font-size:12px; margin-top:2px;">OpenRouter key used for document understanding</div>
								</div>
								<input
									class="form-input"
									type="password"
									name="apiKey"
									placeholder="sk-or-v1-…"
									value={aiApiKey}
									oninput={(e) => (aiApiKey = (e.target as HTMLInputElement).value)}
									style="width:220px; flex-shrink:0;"
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
									<select
										class="form-input"
										name="model"
										bind:value={aiModel}
										style="width:260px;"
										disabled={orModels.length === 0}
									>
										{#if orModels.length === 0}
											<option value="">Enter API key to load models</option>
										{/if}
										{#each filteredModels as m (m.id)}
											<option value={m.id}>{m.name}</option>
										{/each}
									</select>
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
										min={1}
										max={10}
										step={1}
										value={[aiParallelTasks]}
										onValueChange={(v) => (aiParallelTasks = v[0])}
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
									class:on={aiCategoryHints}
									onclick={() => { aiCategoryHints = !aiCategoryHints; }}
									aria-pressed={aiCategoryHints}
								>
									<span class="toggle-thumb"></span>
								</button>
							</div>
						</div>
						<button type="submit" class="btn-primary" style="margin-top:16px;">Save</button>
					</form>
				</div>

			{:else if activeTab === 'categories'}
				<div class="set-section">
					<div class="set-section-head">
						<h2 class="set-section-title">Expense Categories</h2>
						<p class="set-section-sub">Categories available when recording expenses</p>
					</div>
					<form
						method="POST"
						action="?/saveExpenseCategories"
						use:enhance
					>
						<input type="hidden" name="categories" value={JSON.stringify(expCats)} />
						<div class="cat-chips">
							{#each expCats as cat}
								<span class="cat-chip-removable">
									{cat}
									<button
										type="button"
										class="chip-remove"
										onclick={() => removeExpCat(cat)}
										aria-label="Remove {cat}"
									>
										<X size={11} />
									</button>
								</span>
							{/each}
						</div>
						<div class="cat-add-row">
							<input
								class="form-input cat-add-input"
								type="text"
								placeholder="New category name..."
								bind:value={newExpCat}
								onkeydown={handleExpKey}
							/>
							<button type="button" class="btn-ghost" onclick={addExpCat}>
								<Plus size={14} /> Add
							</button>
						</div>
						<button type="submit" class="btn-primary" style="margin-top:16px;">Save</button>
					</form>
				</div>

				<div class="set-section" style="margin-top:32px;">
					<div class="set-section-head">
						<h2 class="set-section-title">Income Categories</h2>
						<p class="set-section-sub">Categories available when recording income</p>
					</div>
					<form
						method="POST"
						action="?/saveIncomeCategories"
						use:enhance
					>
						<input type="hidden" name="categories" value={JSON.stringify(incCats)} />
						<div class="cat-chips">
							{#each incCats as cat}
								<span class="cat-chip-removable">
									{cat}
									<button
										type="button"
										class="chip-remove"
										onclick={() => removeIncCat(cat)}
										aria-label="Remove {cat}"
									>
										<X size={11} />
									</button>
								</span>
							{/each}
						</div>
						<div class="cat-add-row">
							<input
								class="form-input cat-add-input"
								type="text"
								placeholder="New category name..."
								bind:value={newIncCat}
								onkeydown={handleIncKey}
							/>
							<button type="button" class="btn-ghost" onclick={addIncCat}>
								<Plus size={14} /> Add
							</button>
						</div>
						<button type="submit" class="btn-primary" style="margin-top:16px;">Save</button>
					</form>
				</div>

			{:else if activeTab === 'backup'}
				<div class="set-section">
					<div class="set-section-head">
						<h2 class="set-section-title">Backup & Export</h2>
						<p class="set-section-sub">Data backup and export options</p>
					</div>
					<div class="stub-placeholder">
						<div class="stub-title">Coming in Phase 6</div>
						<div class="stub-sub">Backup and export features will be available in an upcoming update.</div>
					</div>
				</div>

			{:else if activeTab === 'advanced'}
				<div class="set-section">
					<div class="set-section-head">
						<h2 class="set-section-title">Advanced</h2>
						<p class="set-section-sub">Developer and advanced options</p>
					</div>
					<div class="stub-placeholder">
						<div class="stub-title">Coming in Phase 6</div>
						<div class="stub-sub">Advanced configuration options will be available in an upcoming update.</div>
					</div>
				</div>
			{/if}
		</div>
	</div>
</div>

<style>
	.stub-placeholder {
		padding: 40px 24px;
		background: var(--muted);
		border-radius: var(--radius);
		text-align: center;
		border: 1px dashed var(--border-strong);
	}

	.stub-title {
		font-size: 14px;
		font-weight: 500;
		color: var(--foreground);
		margin-bottom: 6px;
	}

	.stub-sub {
		font-size: 13px;
		color: var(--muted-foreground);
	}

	.cat-add-row {
		display: flex;
		gap: 8px;
		align-items: center;
		margin-top: 12px;
	}

	.cat-add-input {
		flex: 1;
		min-width: 0;
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
</style>
