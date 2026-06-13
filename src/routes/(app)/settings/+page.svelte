<script lang="ts">
	import { enhance } from '$app/forms';
	import { Plus, X, Lock, RefreshCw, Copy, Check } from '@lucide/svelte';
	import { Slider } from '$lib/components/ui/slider/index.js';
	import { toast } from 'svelte-sonner';
	import type { PageData, ActionData } from './$types.js';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	type Tab = 'general' | 'intelligence' | 'categories' | 'advanced';
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

	// Advanced state
	let godMode = $state(data.godModeEnabled);
	let currentBearer = $state(data.apiBearer);
	let bearerCopied = $state(false);
	let bearerRevealed = $state(false);

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
			if ('newToken' in (form ?? {})) {
				currentBearer = (form as { newToken: string }).newToken;
				bearerRevealed = true;
				toast.success('Bearer token regenerated — copy it now');
			} else {
				toast.success('Settings saved');
			}
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

	async function copyBearer() {
		await navigator.clipboard.writeText(currentBearer);
		bearerCopied = true;
		setTimeout(() => (bearerCopied = false), 2000);
	}

	function maskedBearer(): string {
		return '••••••••••••••••••••••••';
	}

	const TABS: { id: Tab; label: string }[] = [
		{ id: 'general', label: 'General' },
		{ id: 'intelligence', label: 'Intelligence' },
		{ id: 'categories', label: 'Categories' },
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
							<input class="form-input cat-add-input" type="text" placeholder="New category name..." bind:value={newExpCat} onkeydown={handleExpKey} />
							<button type="button" class="btn-ghost" onclick={addExpCat}><Plus size={14} /> Add</button>
						</div>
						<button type="submit" class="btn-primary" style="margin-top:16px;">Save</button>
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
							<input class="form-input cat-add-input" type="text" placeholder="New category name..." bind:value={newIncCat} onkeydown={handleIncKey} />
							<button type="button" class="btn-ghost" onclick={addIncCat}><Plus size={14} /> Add</button>
						</div>
						<button type="submit" class="btn-primary" style="margin-top:16px;">Save</button>
					</form>
				</div>

			{:else if activeTab === 'advanced'}
				<div class="set-section">
					<div class="set-section-head">
						<h2 class="set-section-title">Advanced</h2>
						<p class="set-section-sub">Power-user controls. Use with care.</p>
					</div>

					<!-- API bearer token — standalone, no Save involved -->
					<div class="set-sub-head">
						<h3 class="set-sub-title">API bearer token</h3>
						<p class="set-section-sub">Used to authenticate requests from external clients via the <code style="font-size:11px;">Authorization: Bearer</code> header.</p>
					</div>
					<div class="bearer-row">
						<code class="bearer-value">{bearerRevealed ? currentBearer : maskedBearer()}</code>
						<button
							type="button"
							class="icon-btn"
							onclick={() => (bearerRevealed = !bearerRevealed)}
							title={bearerRevealed ? 'Hide token' : 'Reveal token'}
						>
							{#if bearerRevealed}
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
							{:else}
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
							{/if}
						</button>
						<button
							type="button"
							class="icon-btn"
							onclick={copyBearer}
							title="Copy token"
						>
							{#if bearerCopied}
								<Check size={14} />
							{:else}
								<Copy size={14} />
							{/if}
						</button>
						<form method="POST" action="?/regenerateBearer" use:enhance={() => ({ update }) => update({ reset: false })} style="display:contents;">
							<button type="submit" class="btn-ghost-sm" title="Generate a new token — existing clients will need to update their token">
								<RefreshCw size={13} /> Regenerate
							</button>
						</form>
					</div>

					<!-- God Mode — form with Save -->
					<div class="set-sub-head" style="margin-top:28px;">
						<h3 class="set-sub-title">God Mode</h3>
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
						<button type="submit" class="btn-primary" style="margin-top:16px;">Save</button>
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

	/* Advanced sub-sections */
	.set-sub-head {
		margin-bottom: 10px;
	}

	.set-sub-title {
		font-size: 13px;
		font-weight: 600;
		color: var(--foreground);
		margin: 0 0 2px;
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

	/* Bearer token */
	.bearer-row {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-top: 10px;
		flex-wrap: wrap;
	}

	.bearer-value {
		font-family: var(--font-mono, monospace);
		font-size: 12px;
		background: var(--muted);
		border: 1px solid var(--border);
		border-radius: 4px;
		padding: 5px 10px;
		color: var(--foreground);
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 400px;
	}

	.icon-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		background: none;
		border: 1px solid var(--border);
		border-radius: 4px;
		cursor: pointer;
		color: var(--muted-foreground);
		flex-shrink: 0;
	}

	.icon-btn:hover {
		background: var(--muted);
		color: var(--foreground);
	}

	.btn-ghost-sm {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 5px 10px;
		font-size: 12px;
		background: none;
		border: 1px solid var(--border);
		border-radius: 4px;
		cursor: pointer;
		color: var(--muted-foreground);
		white-space: nowrap;
	}

	.btn-ghost-sm:hover {
		background: var(--muted);
		color: var(--foreground);
	}


</style>
