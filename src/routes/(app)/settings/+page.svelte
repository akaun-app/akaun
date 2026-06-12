<script lang="ts">
	import { enhance } from '$app/forms';
	import { Plus, X, Check } from '@lucide/svelte';
	import type { PageData, ActionData } from './$types.js';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	type Tab = 'general' | 'categories' | 'backup' | 'advanced';
	let activeTab = $state<Tab>('general');

	// Expense categories state
	let expCats = $state<string[]>([...data.expenseCategories]);
	let newExpCat = $state('');
	let expSaved = $state(false);

	// Income categories state
	let incCats = $state<string[]>([...data.incomeCategories]);
	let newIncCat = $state('');
	let incSaved = $state(false);

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

	$effect(() => {
		if (form?.success) {
			expSaved = true;
			incSaved = true;
			const t = setTimeout(() => { expSaved = false; incSaved = false; }, 2000);
			return () => clearTimeout(t);
		}
	});

	const TABS: { id: Tab; label: string }[] = [
		{ id: 'general', label: 'General' },
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
						<button type="submit" class="btn-primary" style="margin-top:16px;">
							{#if expSaved}
								<Check size={14} /> Saved
							{:else}
								Save expense categories
							{/if}
						</button>
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
						<button type="submit" class="btn-primary" style="margin-top:16px;">
							{#if incSaved}
								<Check size={14} /> Saved
							{:else}
								Save income categories
							{/if}
						</button>
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
