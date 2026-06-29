<script lang="ts">
	import { enhance } from '$app/forms';
	import { GripVertical, Plus, X, Lock, Pencil, Trash2, Zap } from '@lucide/svelte';
	import { Slider } from '$lib/components/ui/slider/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as Sheet from '$lib/components/ui/sheet/index.js';
	import { toast } from 'svelte-sonner';
	import { CURRENCIES } from '$lib/currency.js';
	import { useIsMobile } from '$lib/hooks/useIsMobile.svelte.js';
	import { flip } from 'svelte/animate';
	import { draggable, droppable } from '@thisux/sveltednd';
	import type { DragDropState } from '@thisux/sveltednd';
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
	import type { PageData, ActionData } from './$types.js';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	type Tab = 'general' | 'intelligence' | 'providers' | 'categories' | 'advanced';
	let activeTab = $state<Tab>('general');

	// Mobile detection for Sheet side
	const screenState = useIsMobile();
	const isMobile = $derived(screenState.current);
	const panelSide = $derived(isMobile ? 'bottom' : 'right');

	// Company settings state
	// svelte-ignore state_referenced_locally
	let companyName = $state(data.companyName);
	// svelte-ignore state_referenced_locally
	let companyAddress = $state(data.companyAddress);
	// svelte-ignore state_referenced_locally
	let companyRegistrationNo = $state(data.companyRegistrationNo);

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

	// Income categories state
	// svelte-ignore state_referenced_locally
	let incCats = $state<string[]>([...data.incomeCategories]);
	let newIncCat = $state('');

	// Global intelligence settings
	// svelte-ignore state_referenced_locally
	let aiParallelTasks = $state(data.autoImportParallelTasks);
	// svelte-ignore state_referenced_locally
	let aiCategoryHints = $state(data.autoImportCategoryHints);

	// Advanced state
	// svelte-ignore state_referenced_locally
	let godMode = $state(data.godModeEnabled);

	// Auto-save form refs (Intelligence + Advanced tabs)
	let intelligenceFormEl = $state<HTMLFormElement | null>(null);
	let advancedFormEl = $state<HTMLFormElement | null>(null);
	let sliderDebounceTimer: ReturnType<typeof setTimeout> | null = null;

	function handleSliderChange(v: number[]) {
		aiParallelTasks = v[0];
		if (sliderDebounceTimer) clearTimeout(sliderDebounceTimer);
		sliderDebounceTimer = setTimeout(() => intelligenceFormEl?.requestSubmit(), 400);
	}

	// --- Provider list state ---
	type ProviderRow = (typeof data.providers)[0];
	// svelte-ignore state_referenced_locally
	let providers = $state<ProviderRow[]>([...data.providers]);

	let reorderFormEl = $state<HTMLFormElement | null>(null);
	let reorderInputEl = $state<HTMLInputElement | null>(null);

	function reorderItems<T extends { id: string | number }>(
		arr: T[],
		draggedItem: T,
		targetElement: HTMLElement | null,
		dropPosition: 'before' | 'after' | null
	): T[] {
		if (!targetElement || !dropPosition) return arr;
		const targetId = targetElement.closest<HTMLElement>('[data-id]')?.dataset.id;
		if (!targetId || String(draggedItem.id) === targetId) return arr;
		const result = [...arr];
		const fromIndex = result.findIndex((i) => String(i.id) === String(draggedItem.id));
		if (fromIndex === -1) return arr;
		const [item] = result.splice(fromIndex, 1);
		const newTargetIdx = result.findIndex((i) => String(i.id) === targetId);
		if (newTargetIdx === -1) return arr;
		result.splice(dropPosition === 'after' ? newTargetIdx + 1 : newTargetIdx, 0, item);
		return result;
	}

	const reducedMotion =
		typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	const flipDurationMs = reducedMotion ? 0 : 200;

	function handleDrop(state: DragDropState<ProviderRow>) {
		if (!state.draggedItem) return;
		providers = reorderItems(providers, state.draggedItem, state.targetElement, state.dropPosition);
		if (reorderInputEl) reorderInputEl.value = JSON.stringify(providers.map((p) => p.id));
		reorderFormEl?.requestSubmit();
	}

	// --- Provider Sheet state ---
	let sheetOpen = $state(false);
	let editingProvider = $state<ProviderRow | null>(null);

	let sfType = $state('openrouter');
	let sfName = $state('');
	let sfApiKey = $state('');
	let sfModel = $state('');
	let sfShowFreeOnly = $state(false);

	type ModelInfo = { id: string; name: string; isFree: boolean };
	let sfModels = $state<ModelInfo[]>([]);
	let sfFetching = $state(false);
	let sfError = $state('');

	const sfFilteredModels = $derived(sfShowFreeOnly ? sfModels.filter((m) => m.isFree) : sfModels);

	$effect(() => {
		if (sfFilteredModels.length > 0 && !sfFilteredModels.find((m) => m.id === sfModel)) {
			sfModel = sfFilteredModels[0].id;
		}
	});

	$effect(() => {
		const key = sfApiKey;
		const type = sfType;
		if (!key) {
			// When editing, keep the server-fetched model list; only clear for add mode.
			if (!editingProvider) {
				sfModels = [];
				sfError = '';
			}
			return;
		}
		const t = setTimeout(() => fetchSheetModels(key, type), 600);
		return () => clearTimeout(t);
	});

	async function fetchSheetModels(key: string, type: string) {
		sfFetching = true;
		sfError = '';
		try {
			if (type === 'google_ai_studio') {
				const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
					headers: { 'x-goog-api-key': key }
				});
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				const json = await res.json();
				const raw: { name: string; displayName: string; supportedGenerationMethods: string[] }[] =
					json.models ?? [];
				sfModels = raw
					.filter((m) => m.supportedGenerationMethods.includes('generateContent'))
					.map((m) => ({
						id: m.name.replace('models/', ''),
						name: m.displayName,
						isFree: false
					}))
					.sort((a, b) => a.name.localeCompare(b.name));
			} else if (type === 'groq') {
				const res = await fetch('https://api.groq.com/openai/v1/models', {
					headers: { Authorization: `Bearer ${key}` }
				});
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				const json = await res.json();
				const raw: { id: string }[] = json.data ?? [];
				sfModels = raw
					.map((m) => ({ id: m.id, name: m.id, isFree: false }))
					.sort((a, b) => a.name.localeCompare(b.name));
			} else {
				const res = await fetch('https://openrouter.ai/api/v1/models', {
					headers: { Authorization: `Bearer ${key}` }
				});
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				const json = await res.json();
				const raw: { id: string; name: string; pricing?: { prompt?: string } }[] = json.data ?? [];
				sfModels = raw
					.map((m) => ({
						id: m.id,
						name: m.name,
						isFree: parseFloat(m.pricing?.prompt ?? '1') === 0
					}))
					.sort((a, b) => a.name.localeCompare(b.name));
			}
		} catch (err) {
			sfError = err instanceof Error ? err.message : 'Failed to fetch models';
		} finally {
			sfFetching = false;
		}
	}

	const PROVIDER_LABELS: Record<string, string> = {
		openrouter: 'OpenRouter',
		google_ai_studio: 'Google AI Studio',
		groq: 'Groq'
	};

	const PROVIDER_DEFAULT_NAMES: Record<string, string> = {
		openrouter: 'OpenRouter',
		google_ai_studio: 'Google AI Studio',
		groq: 'Groq'
	};

	function openAddSheet() {
		editingProvider = null;
		sfType = 'openrouter';
		sfName = PROVIDER_DEFAULT_NAMES['openrouter'];
		sfApiKey = '';
		sfModel = '';
		sfModels = [];
		sfError = '';
		sfShowFreeOnly = false;
		sheetOpen = true;
	}

	$effect(() => {
		if (!editingProvider) {
			sfName = PROVIDER_DEFAULT_NAMES[sfType] ?? sfType;
			sfModels = [];
		}
	});

	function openEditSheet(prov: ProviderRow) {
		editingProvider = prov;
		sfType = prov.type;
		sfName = prov.name;
		sfApiKey = '';
		sfModel = prov.model;
		sfModels = [];
		sfError = '';
		sfShowFreeOnly = false;
		sheetOpen = true;
		if (prov.hasApiKey) fetchServerModels(prov.id);
	}

	async function fetchServerModels(providerId: string) {
		sfFetching = true;
		sfError = '';
		try {
			const res = await fetch(`/api/providers/${providerId}/models`);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = await res.json();
			sfModels = data.models ?? [];
		} catch (err) {
			sfError = err instanceof Error ? err.message : 'Failed to fetch models';
		} finally {
			sfFetching = false;
		}
	}

	function closeSheet() {
		sheetOpen = false;
	}

	let deleteConfirmOpen = $state(false);
	let deleteTarget = $state<ProviderRow | null>(null);
	let deleteFormEl = $state<HTMLFormElement | null>(null);

	function requestDeleteProvider(prov: ProviderRow) {
		deleteTarget = prov;
		deleteConfirmOpen = true;
	}

	function confirmDeleteProvider() {
		deleteFormEl?.requestSubmit();
		deleteConfirmOpen = false;
	}

	function truncateModel(model: string, max = 32): string {
		if (model.length <= max) return model;
		return model.slice(0, max - 1) + '…';
	}

	$effect(() => {
		if (form?.success) {
			const action = (form as { action?: string }).action;
			if (action === 'addProvider' || action === 'updateProvider' || action === 'deleteProvider' || action === 'reorderProviders') {
				providers = [...data.providers];
				if (action !== 'reorderProviders') closeSheet();
			}
			if (action === 'saveIntelligenceGlobal') {
				aiParallelTasks = data.autoImportParallelTasks;
				aiCategoryHints = data.autoImportCategoryHints;
			}
			if (action === 'saveGeneral') {
				mainCur = data.currency;
			}
			toast.success('Settings saved');
		}
	});

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

	const TABS: { id: Tab; label: string }[] = [
		{ id: 'general', label: 'General' },
		{ id: 'intelligence', label: 'Intelligence' },
		{ id: 'providers', label: 'Providers' },
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
			{#each TABS as tab (tab.id)}
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
					<form method="POST" action="?/saveGeneral" use:enhance={() => ({ update }) => update({ reset: false })}>
						{#if !data.currencyLocked}
							<input type="hidden" name="currencyCode" value={mainCur} />
						{/if}
						<p class="set-subsection-label">Display</p>
						<div class="set-rows">
							<div class="set-row">
								<div>
									<div class="set-row-label">Currency</div>
									<div class="set-row-value" style="font-size:12px; margin-top:2px;">All amounts display in this currency; foreign records are converted to it</div>
								</div>
								{#if data.currencyLocked}
									<div class="set-input-right" style="display:flex; align-items:center; gap:6px; color:var(--muted-foreground);">
										{curLabel} <Lock size={12} />
									</div>
								{:else}
									<Select.Root type="single" name="mainCurrencyDisplay" bind:value={mainCur}>
										<Select.Trigger class="set-input-right set-input-wide">{curLabel}</Select.Trigger>
										<Select.Content>
											{#each CURRENCIES as c (c.code)}
												<Select.Item value={c.code} label={`${c.code} — ${c.name}`} />
											{/each}
										</Select.Content>
									</Select.Root>
								{/if}
							</div>
						</div>
						{#if data.currencyLocked}
							<p class="set-row-value" style="font-size:12px; display:flex; align-items:center; gap:4px; margin-top:6px; margin-bottom:0;">
								Currency is locked once transactions exist — changing it would silently corrupt historical amounts.
							</p>
						{/if}

						<p class="set-subsection-label">Company</p>
						<p class="set-row-value" style="font-size:12px; margin-top:0; margin-bottom:10px;">Shown on printed quotations and invoices</p>
						<div class="set-rows">
							<div class="set-row set-row-col">
								<div class="set-row-label">Company Name</div>
								<Input
									name="companyName"
									bind:value={companyName}
									placeholder="e.g. Acme Sdn Bhd"
									class="set-input-full"
								/>
							</div>
							<div class="set-row set-row-col">
								<div class="set-row-label">Address</div>
								<textarea
									name="companyAddress"
									bind:value={companyAddress}
									placeholder="Street, City, State, Postcode"
									rows="3"
									class="set-textarea"
								></textarea>
							</div>
							<div class="set-row set-row-col">
								<div class="set-row-label">Registration No.</div>
								<Input
									name="companyRegistrationNo"
									bind:value={companyRegistrationNo}
									placeholder="e.g. 202301012345"
									class="set-input-full"
								/>
							</div>
						</div>
						<Button type="submit" class="mt-4">Save</Button>
					</form>
				</div>

			{:else if activeTab === 'intelligence'}
				<div class="set-section">
					<div class="set-section-head">
						<h2 class="set-section-title">Intelligence</h2>
						<p class="set-section-sub">Global settings for auto-import processing.</p>
					</div>
					<form
						method="POST"
						action="?/saveIntelligenceGlobal"
						bind:this={intelligenceFormEl}
						use:enhance={() => ({ update }) => update({ reset: false })}
					>
						<input type="hidden" name="categoryHints" value={String(aiCategoryHints)} />
						<input type="hidden" name="parallelTasks" value={aiParallelTasks} />
						<div class="set-rows">
							<div class="set-row">
								<div>
									<div class="set-row-label">Parallel tasks</div>
									<div class="set-row-value" style="font-size:12px; margin-top:2px;">Process up to {aiParallelTasks} file{aiParallelTasks !== 1 ? 's' : ''} at once</div>
								</div>
								<div class="slider-row">
									<Slider
										type="multiple"
										min={1}
										max={10}
										step={1}
										value={[aiParallelTasks]}
										onValueChange={handleSliderChange}
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
									onclick={() => { aiCategoryHints = !aiCategoryHints; intelligenceFormEl?.requestSubmit(); }}
									aria-pressed={aiCategoryHints}
								>
									<span class="toggle-thumb"></span>
								</button>
							</div>
						</div>
					</form>
				</div>

			{:else if activeTab === 'providers'}
				<div class="set-section">
					<div class="set-section-head">
						<h2 class="set-section-title">LLM Providers</h2>
						<p class="set-section-sub">AI models used for receipt extraction. Providers are tried in priority order — drag to reorder.</p>
					</div>

					<div class="prov-header">
						<span class="set-row-label" style="margin:0;">Configured providers</span>
						<button type="button" class="sheet-btn sheet-btn-primary" style="padding:6px 12px; font-size:13px;" onclick={openAddSheet}>
							<Plus size={14} /> Add provider
						</button>
					</div>

					<!-- Hidden reorder form -->
					<form
						bind:this={reorderFormEl}
						method="POST"
						action="?/reorderProviders"
						use:enhance={() => ({ update }) => update({ reset: false })}
						style="display:none;"
					>
						<input bind:this={reorderInputEl} type="hidden" name="orderedIds" value={JSON.stringify(providers.map((p) => p.id))} />
					</form>

					{#if providers.length === 0}
						<div class="prov-empty">
							<Zap size={20} style="opacity:0.3;" />
							<span>No providers configured — add one to enable auto-import.</span>
						</div>
					{:else}
						<div class="prov-list">
							{#each providers as prov (prov.id)}
								<div
									class="prov-row"
									class:prov-row-disabled={!prov.enabled}
									data-id={String(prov.id)}
									animate:flip={{ duration: flipDurationMs }}
									use:draggable={{
										container: 'prov-list',
										dragData: prov,
										handle: '.prov-handle',
										disabled: providers.length <= 1
									}}
									use:droppable={{
										container: 'prov-list',
										callbacks: { onDrop: handleDrop },
										disabled: providers.length <= 1
									}}
								>
									<span class="prov-handle" aria-hidden="true" class:prov-handle-hidden={providers.length <= 1}><GripVertical size={15} /></span>
									<span class="prov-type-badge">{PROVIDER_LABELS[prov.type] ?? prov.type}</span>
									<div class="prov-info">
										<span class="prov-name">{prov.name}</span>
										<span class="prov-model">{truncateModel(prov.model)}</span>
									</div>
									<form
										method="POST"
										action="?/updateProvider"
										use:enhance={({ formData }) => {
											const newEnabled = formData.get('enabled') === 'true';
											providers = providers.map((p) =>
												p.id === prov.id ? { ...p, enabled: newEnabled } : p
											);
											return async ({ update }) => update({ reset: false });
										}}
										style="display:contents;"
									>
										<input type="hidden" name="id" value={prov.id} />
										<input type="hidden" name="enabled" value={String(!prov.enabled)} />
										<button
											type="submit"
											class="toggle-btn"
											class:on={prov.enabled}
											aria-pressed={prov.enabled}
											aria-label={prov.enabled ? 'Disable provider' : 'Enable provider'}
										>
											<span class="toggle-thumb"></span>
										</button>
									</form>
									<button type="button" class="prov-edit-btn" title="Edit provider" onclick={() => openEditSheet(prov)}>
										<Pencil size={13} />
									</button>
								</div>
							{/each}
						</div>
					{/if}
				</div>

			{:else if activeTab === 'categories'}
				<div class="set-section">
					<div class="set-section-head">
						<h2 class="set-section-title">Categories</h2>
						<p class="set-section-sub">Categories available when recording expenses and income</p>
					</div>
					<form method="POST" action="?/saveCategories" use:enhance>
						<input type="hidden" name="expenseCategories" value={JSON.stringify(expCats)} />
						<input type="hidden" name="incomeCategories" value={JSON.stringify(incCats)} />

						<p class="set-subsection-label">Expense</p>
						<div class="cat-chips">
							{#each expCats as cat (cat)}
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

						<p class="set-subsection-label" style="margin-top:24px;">Income</p>
						<div class="cat-chips">
							{#each incCats as cat (cat)}
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
					<form
						method="POST"
						action="?/saveAdvanced"
						bind:this={advancedFormEl}
						use:enhance={() => ({ update }) => update({ reset: false })}
					>
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
									onclick={() => { godMode = !godMode; advancedFormEl?.requestSubmit(); }}
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
					</form>
				</div>
			{/if}
		</div>
	</div>
</div>

<!-- Add / Edit Provider Sheet -->
<Sheet.Root
	open={sheetOpen}
	onOpenChange={(o) => { if (!o) closeSheet(); }}
>
	<Sheet.Portal>
		<Sheet.Overlay />
		<Sheet.Content
			side={panelSide}
			style={isMobile
				? 'height:100dvh; border-radius:0; border-top:none; display:flex; flex-direction:column; overflow:hidden; gap:0;'
				: 'width:500px; max-width:95vw; display:flex; flex-direction:column; overflow:hidden; gap:0;'}
		>
			<div style="display:flex; align-items:flex-start; justify-content:space-between; padding:22px 22px 16px; border-bottom:1px solid var(--border);">
				<div>
					<div class="sheet-eyebrow">LLM Provider</div>
					<div class="sheet-title-text">{editingProvider ? editingProvider.name : 'Add provider'}</div>
				</div>
				<Sheet.Close class="sheet-close"><X size={16} /></Sheet.Close>
			</div>

			<form
				method="POST"
				action={editingProvider ? '?/updateProvider' : '?/addProvider'}
				use:enhance={() => ({ update }) => update({ reset: false })}
				style="flex:1; display:flex; flex-direction:column; overflow:hidden;"
			>
				{#if editingProvider}
					<input type="hidden" name="id" value={editingProvider.id} />
				{/if}

				<div style="flex:1; overflow-y:auto; padding:20px 22px;">
					{#if form?.error}
						<div style="background:var(--red-soft); color:var(--red); border-radius:8px; padding:10px 14px; font-size:13px; margin-bottom:16px;">{form.error}</div>
					{/if}

					<div class="field">
						<label class="field-label" for="sf-type">Provider type</label>
						<Select.Root type="single" name="type" bind:value={sfType}>
							<Select.Trigger id="sf-type" class="w-full">
								{PROVIDER_LABELS[sfType] ?? sfType}
							</Select.Trigger>
							<Select.Content>
								<Select.Item value="openrouter" label="OpenRouter" />
								<Select.Item value="google_ai_studio" label="Google AI Studio" />
								<Select.Item value="groq" label="Groq" />
							</Select.Content>
						</Select.Root>
						<span style="font-size:11px; color:var(--muted-foreground); margin-top:4px; display:block;">
							{#if sfType === 'openrouter'}
								Unified API gateway — access hundreds of models with one key. <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer" style="color:var(--primary);">Get a key ↗</a>
							{:else if sfType === 'google_ai_studio'}
								Direct access to Gemini models. <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" style="color:var(--primary);">Get a key ↗</a>
							{:else if sfType === 'groq'}
								Fast open-source model inference (Llama, Mixtral and more). <a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer" style="color:var(--primary);">Get a key ↗</a>
							{/if}
						</span>
					</div>

					<div class="field">
						<label class="field-label" for="sf-name">Name</label>
						<Input
							id="sf-name"
							name="name"
							class="w-full"
							placeholder="e.g. OpenRouter"
							value={sfName}
							oninput={(e) => (sfName = (e.target as HTMLInputElement).value)}
							required
						/>
					</div>

					<div class="field">
						<label class="field-label" for="sf-apikey">API key</label>
						<Input
							id="sf-apikey"
							name="apiKey"
							type="password"
							class="w-full"
							placeholder={editingProvider?.hasApiKey
								? 'Leave blank to keep current key'
								: sfType === 'google_ai_studio' ? 'AQ…' : sfType === 'groq' ? 'gsk_…' : 'sk-or-v1-…'}
							value={sfApiKey}
							oninput={(e) => (sfApiKey = (e.target as HTMLInputElement).value)}
						/>
					</div>

					{#if sfType === 'openrouter'}
						<div class="field" style="flex-direction:row; align-items:center; justify-content:space-between; gap:12px;">
							<div>
								<span class="field-label" style="margin-bottom:0;">Free models only</span>
								<span style="font-size:11px; color:var(--muted-foreground); display:block;">Only show models with no usage cost</span>
							</div>
							<button
								type="button"
								class="toggle-btn"
								aria-label="Free models only"
								class:on={sfShowFreeOnly}
								onclick={() => { sfShowFreeOnly = !sfShowFreeOnly; }}
								aria-pressed={sfShowFreeOnly}
							>
								<span class="toggle-thumb"></span>
							</button>
						</div>
					{/if}

					<div class="field">
						<label class="field-label" for="sf-model">Model</label>
						{#if sfFetching}
							<div style="font-size:12px; color:var(--muted-foreground); display:flex; align-items:center; gap:6px; margin-bottom:6px;">
								<span class="spinner sm"></span> Fetching models…
							</div>
						{:else if sfError}
							<div style="font-size:12px; color:var(--red); margin-bottom:6px;">{sfError}</div>
						{/if}

						{#if sfFilteredModels.length > 0}
							<input type="hidden" name="model" value={sfModel} />
							<Select.Root type="single" bind:value={sfModel}>
								<Select.Trigger id="sf-model" class="w-full">
									{(sfFilteredModels.find((m) => m.id === sfModel)?.name ?? sfModel) || 'Select model'}
								</Select.Trigger>
								<Select.Content>
									{#each sfFilteredModels as m (m.id)}
										<Select.Item value={m.id} label={m.name} />
									{/each}
								</Select.Content>
							</Select.Root>
						{:else}
							{@const fallbackModel = editingProvider !== null ? (editingProvider?.model ?? '') : ''}
							<input type="hidden" name="model" value={sfModel || fallbackModel} />
							<div style="font-size:12px; color:var(--muted-foreground); padding:8px 12px; border:1px solid var(--border); border-radius:6px; background:var(--muted);">
								{fallbackModel || 'Enter API key to load available models'}
							</div>
						{/if}
					</div>
				</div>

				<div class="sheet-foot">
					<div class="sheet-foot-actions">
						{#if editingProvider}
							<button
								type="button"
								class="sheet-btn sheet-btn-delete"
								style="margin-right:auto;"
								onclick={() => editingProvider && requestDeleteProvider(editingProvider)}
							>
								<Trash2 size={14} /> Delete
							</button>
						{/if}
						<button type="button" class="sheet-btn" onclick={closeSheet}>Cancel</button>
						<button
							type="submit"
							class="sheet-btn sheet-btn-primary"
							disabled={!sfName || (!sfModel && !editingProvider)}
						>
							{editingProvider ? 'Save changes' : 'Add provider'}
						</button>
					</div>
				</div>
			</form>
		</Sheet.Content>
	</Sheet.Portal>
</Sheet.Root>

{#if deleteTarget}
	<ConfirmDialog
		bind:open={deleteConfirmOpen}
		title="Delete provider"
		description="Remove {deleteTarget.name}? This cannot be undone."
		confirmLabel="Delete"
		danger
		onConfirm={confirmDeleteProvider}
	/>
	<form
		bind:this={deleteFormEl}
		method="POST"
		action="?/deleteProvider"
		use:enhance={() => ({ update }) => update({ reset: false })}
		style="display:none;"
	>
		<input type="hidden" name="id" value={deleteTarget.id} />
	</form>
{/if}

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

	/* Provider list */
	.prov-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 12px;
	}

	.prov-empty {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 20px 16px;
		border: 1px dashed var(--border);
		border-radius: 10px;
		font-size: 13px;
		color: var(--muted-foreground);
		margin-bottom: 4px;
	}

	.prov-list {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.prov-row {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 12px;
		border: 1px solid var(--border);
		border-radius: 10px;
		background: var(--card);
		transition: border-color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s;
	}

	.prov-row:hover {
		border-color: var(--primary);
	}

	.prov-row:global(.dragging) {
		opacity: 0.55;
		box-shadow: 0 6px 20px rgba(0, 0, 0, 0.1);
		transform: scale(1.01);
	}

	.prov-row-disabled {
		opacity: 0.55;
	}

	.prov-handle {
		cursor: grab;
		color: var(--muted-foreground);
		flex-shrink: 0;
		display: flex;
		align-items: center;
	}

	.prov-handle:active {
		cursor: grabbing;
	}

	.prov-handle-hidden {
		visibility: hidden;
		cursor: default;
	}

	.prov-type-badge {
		flex-shrink: 0;
		font-size: 11px;
		font-weight: 600;
		padding: 2px 8px;
		border-radius: 20px;
		background: color-mix(in srgb, var(--primary) 12%, transparent);
		color: var(--primary);
		letter-spacing: 0.01em;
	}

	.prov-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.prov-name {
		font-size: 13px;
		font-weight: 500;
		color: var(--foreground);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.prov-model {
		font-size: 11px;
		color: var(--muted-foreground);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		font-family: var(--font-mono, monospace);
	}

	.prov-edit-btn {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border-radius: 6px;
		border: 1px solid var(--border);
		background: transparent;
		color: var(--muted-foreground);
		cursor: pointer;
		transition: background 0.12s, color 0.12s;
	}

	.prov-edit-btn:hover {
		background: var(--accent);
		color: var(--foreground);
	}

	/* Sheet field spacing */
	.field {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin-bottom: 16px;
	}
</style>
