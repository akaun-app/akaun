<script lang="ts">
	import { tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import { Plus, Trash2, X } from '@lucide/svelte';
	import DetailPage from '$lib/components/ui/DetailPage.svelte';
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
	import AuditTrail from '$lib/components/ui/AuditTrail.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import ProfileCategorySelect from './ProfileCategorySelect.svelte';
	import {
		PROFILE_FEE_TYPES_MAX,
		PROFILE_PHRASES_MAX,
		PROFILE_SECTIONS_MAX,
		checkProfile,
		type ProfileError,
		type ProfileSectionKind,
		type ProfileSectionMode
	} from '$lib/import-profile-schema.js';
	import { ImportMode } from '$lib/import-reading.js';
	import { IMPORT_PROFILE_STARTERS, starterDraft, type ImportProfileStarterId } from '$lib/import-profile-starters.js';
	import {
		blankForm,
		errorsAt,
		errorsUnder,
		formFingerprint,
		formFromDraft,
		newFeeType,
		newSection,
		payloadFromForm,
		sectionKeys,
		typingKey,
		type ProfileForm,
		type SectionForm
	} from '$lib/import-profile-form.js';
	import type { ImportProfileView } from '$lib/server/services/import-profiles.js';

	/**
	 * One import profile, on its own page: a new one (`profile` null) or a
	 * saved one (006 US6, FR-030, FR-031, FR-035).
	 *
	 * The whole profile is staged here and saved once, as on the Settings page:
	 * nothing reaches the server until Save, and the frame's guard stops a
	 * navigation that would drop the edits. The form writes the schema; the
	 * user never sees it. The one place raw JSON is typed is each section's
	 * "Advanced: extra fields", checked as it is typed by the same check the
	 * server runs (the sequence-template pattern), so the two never disagree.
	 *
	 * Each section says which import mode reads it, Summary or Every
	 * transaction (FR-031), and each mode has its own stated total, since a
	 * summary and a transaction table total different lines.
	 *
	 * Whether the profile is on or off is set from the list in Settings ›
	 * Intelligence, beside the AI providers, and not here.
	 */
	type Choice = { id: number; code: string; name: string };

	let {
		profile,
		starter,
		expenseCategories,
		incomeCategories,
		canChange
	}: {
		profile: ImportProfileView | null;
		starter: ImportProfileStarterId | null;
		expenseCategories: Choice[];
		incomeCategories: Choice[];
		canChange: boolean;
	} = $props();

	const HOME = '/settings?tab=intelligence';

	// ── The staged form ────────────────────────────────────────────────────────
	type Start = ImportProfileStarterId | 'blank';

	function startingForm(from: Start): ProfileForm {
		const draft = from === 'blank' ? null : starterDraft(from);
		return draft ? formFromDraft(draft) : blankForm();
	}

	// The saved profile this page last knew: what Discard goes back to. A new
	// profile has none.
	// svelte-ignore state_referenced_locally
	let saved = $state<ImportProfileView | null>(profile);
	// svelte-ignore state_referenced_locally
	let startedFrom = $state<Start>(starter ?? 'blank');
	// svelte-ignore state_referenced_locally
	let form = $state<ProfileForm>(profile ? formFromDraft(profile) : startingForm(starter ?? 'blank'));

	/**
	 * What "no unsaved changes" looks like. A saved profile: the form as saved.
	 * A new blank profile: the blank form, so an untouched page asks nothing on
	 * the way out. A new profile from a starter is unsaved from the start, so
	 * the save bar is there to save it as it is.
	 */
	function baselineFor(view: ImportProfileView | null, from: Start): string {
		if (view) return formFingerprint(formFromDraft(view));
		return from === 'blank' ? formFingerprint(blankForm()) : '';
	}
	// svelte-ignore state_referenced_locally
	let baseline = $state(baselineFor(profile, starter ?? 'blank'));

	// Another profile opened from here reuses this component: start again from
	// what the server sent for it.
	// svelte-ignore state_referenced_locally
	let seededFor = $state(profile?.id ?? null);
	$effect(() => {
		const id = profile?.id ?? null;
		if (id === seededFor) return;
		seededFor = id;
		saved = profile;
		form = profile ? formFromDraft(profile) : startingForm(starter ?? 'blank');
		baseline = baselineFor(profile, starter ?? 'blank');
		attempted = false;
		saveError = null;
		serverProblems = null;
	});

	const fingerprint = $derived(formFingerprint(form));
	const dirty = $derived(canChange && fingerprint !== baseline);
	let saving = $state(false);

	// ── Problems ───────────────────────────────────────────────────────────────
	// The shared check, run on every change. The server runs it again on save,
	// and adds what only it can see: a category archived since, or a name
	// another profile has. Those are kept for the form they were about.
	const checked = $derived(checkProfile(payloadFromForm(form)));
	const localProblems = $derived<ProfileError[]>(checked.ok ? [] : checked.errors);
	let serverProblems = $state<{ fingerprint: string; errors: ProfileError[] } | null>(null);
	const problems = $derived<ProfileError[]>([
		...localProblems,
		...(serverProblems && serverProblems.fingerprint === fingerprint ? serverProblems.errors : [])
	]);
	// A blank form is all problems; they are shown once Save is tried. The extra
	// fields are the exception: JSON is checked as it is typed.
	let attempted = $state(false);
	let saveError = $state<string | null>(null);

	function shown(path: string): string[] {
		return attempted ? errorsAt(problems, path) : [];
	}

	function extrasProblems(index: number): string[] {
		return errorsUnder(attempted ? problems : localProblems, `sections[${index}].extras`);
	}

	const keys = $derived(sectionKeys(form.sections));

	// ── Starting a new profile from a starter ─────────────────────────────────
	let replaceAsk = $state<Start | null>(null);
	let replaceOpen = $state(false);

	function chooseStart(from: Start) {
		if (from === startedFrom) return;
		// Something typed since the last start would be lost: ask first.
		if (fingerprint !== formFingerprint(startingForm(startedFrom))) {
			replaceAsk = from;
			replaceOpen = true;
			return;
		}
		applyStart(from);
	}

	function applyStart(from: Start) {
		startedFrom = from;
		form = startingForm(from);
		baseline = baselineFor(null, from);
		attempted = false;
		saveError = null;
		serverProblems = null;
	}

	// ── Editing ────────────────────────────────────────────────────────────────
	const MODES: { value: ProfileSectionMode; label: string }[] = [
		{ value: ImportMode.Summary, label: 'Summary' },
		{ value: ImportMode.EveryTransaction, label: 'Every transaction' }
	];

	// The Every transaction stated total is shown once a section is read in
	// that mode, or while it still holds a label, so nothing saved is hidden.
	const showEveryTransactionTotal = $derived(
		form.sections.some((section) => section.mode === ImportMode.EveryTransaction) ||
			form.statedTotals[ImportMode.EveryTransaction].trim() !== ''
	);

	const KINDS: { value: ProfileSectionKind; label: string }[] = [
		{ value: 'income', label: 'Income' },
		{ value: 'expense', label: 'Expense' },
		{ value: 'by_sign', label: 'By sign' }
	];

	/** The categories a section of this kind can name, as the server checks them. */
	function categoryGroups(kind: ProfileSectionKind) {
		const groups: { label: string; choices: Choice[] }[] = [];
		if (kind !== 'income') groups.push({ label: 'Expense', choices: expenseCategories });
		if (kind !== 'expense') groups.push({ label: 'Income', choices: incomeCategories });
		return groups;
	}

	/**
	 * Changes a section's kind. A category the new kind cannot take is cleared,
	 * rather than kept and refused on save: an income section cannot file a
	 * line under an expense category.
	 */
	function setKind(section: SectionForm, kind: ProfileSectionKind) {
		section.kind = kind;
		const allowed = new Set(categoryGroups(kind).flatMap((group) => group.choices.map((choice) => choice.id)));
		if (section.fixedCategoryAccountId != null && !allowed.has(section.fixedCategoryAccountId)) {
			section.fixedCategoryAccountId = null;
		}
		for (const fee of section.feeTypes) {
			if (fee.categoryAccountId != null && !allowed.has(fee.categoryAccountId)) fee.categoryAccountId = null;
		}
	}

	// Which sections show "Advanced: extra fields". Open to begin with when the
	// section has some; after that, as the user leaves it.
	let advancedOpen = $state<Record<string, boolean>>({});

	let phraseDraft = $state('');

	function addPhrase() {
		const phrase = phraseDraft.trim();
		if (!phrase) return;
		if (!form.phrases.some((existing) => existing.toLowerCase() === phrase.toLowerCase())) {
			form.phrases = [...form.phrases, phrase];
		}
		phraseDraft = '';
	}

	function removePhrase(index: number) {
		form.phrases = form.phrases.filter((_, at) => at !== index);
	}

	function addSection() {
		form.sections = [...form.sections, newSection()];
	}

	function removeSection(uid: string) {
		form.sections = form.sections.filter((section) => section.uid !== uid);
	}

	function moveSection(index: number, by: -1 | 1) {
		const next = form.sections.slice();
		const target = index + by;
		if (target < 0 || target >= next.length) return;
		[next[index], next[target]] = [next[target], next[index]];
		form.sections = next;
	}

	function addFeeType(section: SectionForm) {
		section.feeTypes = [...section.feeTypes, newFeeType()];
	}

	function removeFeeType(section: SectionForm, uid: string) {
		section.feeTypes = section.feeTypes.filter((fee) => fee.uid !== uid);
	}

	/**
	 * A fee type key as it is typed: "Commission fee" becomes
	 * "commission_fee". The input is set to the cleaned text too, so what is
	 * shown is always the key that will be saved.
	 */
	function typeKey(fee: { key: string }, input: HTMLInputElement) {
		const cleaned = typingKey(input.value);
		fee.key = cleaned;
		if (input.value !== cleaned) input.value = cleaned;
	}

	// ── Saving ─────────────────────────────────────────────────────────────────
	let auditRef = $state<{ refresh: () => Promise<void> } | null>(null);

	function profileHref(id: number) {
		return resolve('/(app)/settings/import-profiles/[id]', { id: String(id) });
	}

	async function save() {
		if (saving || !canChange) return;
		attempted = true;
		saveError = null;
		if (localProblems.length > 0) {
			saveError = `${localProblems.length} ${localProblems.length === 1 ? 'thing needs' : 'things need'} fixing before this can be saved. Each one is shown beside its field.`;
			return;
		}
		saving = true;
		const sentFingerprint = fingerprint;
		try {
			const res = await fetch(saved ? `/api/import/profiles/${saved.id}` : '/api/import/profiles', {
				method: saved ? 'PATCH' : 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payloadFromForm(form)),
				credentials: 'include'
			});
			const reply = await res.json().catch(() => ({}));
			if (!res.ok) {
				if (res.status === 403) saveError = 'You do not have permission to change import profiles.';
				else if (res.status === 404) saveError = 'This profile was deleted, so it cannot be saved. Go back to Settings to start a new one.';
				else {
					saveError = reply.error ?? 'The profile could not be saved. Try again.';
					if (Array.isArray(reply.errors)) serverProblems = { fingerprint: sentFingerprint, errors: reply.errors };
				}
				return;
			}
			const view = reply as ImportProfileView;
			if (!saved) {
				// Saved: nothing is unsaved any more, so the guard lets the page go
				// to the new profile's own address. It takes the place of the "new"
				// page in the history, so Back goes to where the user came from and
				// not to an empty form for another profile.
				baseline = fingerprint;
				await tick();
				void goto(profileHref(view.id), { replaceState: true });
				toast.success('Import profile added');
				return;
			}
			saved = view;
			form = formFromDraft(view);
			baseline = formFingerprint(form);
			attempted = false;
			serverProblems = null;
			void auditRef?.refresh();
			toast.success('Import profile saved');
		} catch {
			saveError = 'That did not reach the server. Check the connection and try again.';
		} finally {
			saving = false;
		}
	}

	function revert() {
		form = saved ? formFromDraft(saved) : startingForm(startedFrom);
		attempted = false;
		saveError = null;
		serverProblems = null;
	}

	// ── Deleting ───────────────────────────────────────────────────────────────
	let deleteOpen = $state(false);

	async function deleteProfile() {
		if (!saved) return;
		const res = await fetch(`/api/import/profiles/${saved.id}`, { method: 'DELETE', credentials: 'include' });
		if (!res.ok && res.status !== 404) {
			saveError =
				res.status === 403
					? 'You do not have permission to delete import profiles.'
					: 'The profile could not be deleted. Try again.';
			return;
		}
		// Gone: what was staged here has nowhere to be saved, so leave without
		// asking about it.
		baseline = fingerprint;
		await tick();
		toast.success('Import profile deleted');
		// Replace the deleted profile's entry, so Back does not land on an
		// address that now only redirects.
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- a fixed in-app path with the tab to open.
		void goto(HOME, { replaceState: true });
	}

	const title = $derived(saved ? saved.name : 'New import profile');
</script>

<svelte:head><title>{title} - Akaun</title></svelte:head>

<DetailPage
	backHref={HOME}
	backLabel="Settings"
	{dirty}
	{saving}
	saveLabel={saved ? 'Save profile' : 'Add profile'}
	dirtyNote={saved ? 'Unsaved changes' : 'Not saved yet'}
	onsave={save}
	onrevert={revert}
>
	{#snippet actions()}
		{#if saved && canChange}
			<button type="button" class="sheet-btn sheet-btn-delete" onclick={() => (deleteOpen = true)}>
				<Trash2 size={14} /> Delete
			</button>
		{/if}
	{/snippet}

	{#snippet hero()}
		<div class="detail-hero-eyebrow">
			<span>Import profile</span>
			{#if saved}
				<span>·</span>
				<span>{saved.sections.length} section{saved.sections.length === 1 ? '' : 's'}</span>
			{/if}
		</div>
		<h1 class="detail-hero-title pf-title">{title}</h1>
		{#if saved}
			<div class="pf-hero-status">
				<StatusBadge status={saved.enabled ? 'profile-enabled' : 'profile-disabled'} />
				<span class="detail-hero-note">
					{saved.enabled ? 'Offered under “Read as” when uploading.' : 'Not offered under “Read as”.'} Turn it on or off in Settings › Intelligence.
				</span>
			</div>
		{/if}
		{#if !canChange}
			<p class="detail-hero-note">You can read this profile. Changing it needs permission to change imports.</p>
		{/if}
		{#if saveError}<p class="hero-error" role="alert">{saveError}</p>{/if}
	{/snippet}

	{#snippet main()}
		{#if !saved && canChange}
			<section class="detail-card">
				<div class="detail-card-head"><span class="detail-card-title">Start from</span></div>
				<div class="pf-starts">
					<button type="button" class="pf-start" class:on={startedFrom === 'blank'} aria-pressed={startedFrom === 'blank'} onclick={() => chooseStart('blank')}>
						<span class="pf-start-name">Blank</span>
						<span class="pf-start-hint">One empty section to fill in.</span>
					</button>
					{#each IMPORT_PROFILE_STARTERS as option (option.id)}
						<button type="button" class="pf-start" class:on={startedFrom === option.id} aria-pressed={startedFrom === option.id} onclick={() => chooseStart(option.id)}>
							<span class="pf-start-name">{option.label}</span>
							<span class="pf-start-hint">{option.hint}</span>
						</button>
					{/each}
				</div>
				<p class="field-hint">A starter fills in sections and instructions for you to change. It pins no categories: choose your own below.</p>
			</section>
		{/if}

		<section class="detail-card">
			<div class="detail-card-head"><span class="detail-card-title">The profile</span></div>

			<div class="field">
				<label class="field-label" for="pf-name">Name *</label>
				<Input id="pf-name" bind:value={form.name} disabled={!canChange} class="w-full" placeholder="e.g. Marketplace monthly statement" />
				{@render problemList(shown('name'))}
			</div>

			<div class="field">
				<label class="field-label" for="pf-description">How to recognise it *</label>
				<Textarea id="pf-description" rows={3} bind:value={form.description} disabled={!canChange} class="leading-relaxed" />
				<p class="field-hint">What this kind of document is, in plain words: who sends it and what it shows.</p>
				{@render problemList(shown('description'))}
			</div>

			<div class="field" style="margin-bottom:0;">
				<label class="field-label" for="pf-phrase">Recognition phrases</label>
				{#if form.phrases.length > 0}
					<div class="pf-phrases">
						{#each form.phrases as phrase, index (phrase)}
							<span class="pf-phrase">
								<span class="pf-phrase-text">{phrase}</span>
								{#if canChange}
									<button type="button" class="pf-phrase-remove" aria-label="Remove {phrase}" onclick={() => removePhrase(index)}>
										<X size={12} />
									</button>
								{/if}
							</span>
						{/each}
					</div>
				{/if}
				{#if canChange && form.phrases.length < PROFILE_PHRASES_MAX}
					<div class="pf-inline">
						<Input
							id="pf-phrase"
							bind:value={phraseDraft}
							class="w-full"
							placeholder="Text the document always prints"
							onkeydown={(event: KeyboardEvent) => {
								if (event.key === 'Enter') {
									event.preventDefault();
									addPhrase();
								}
							}}
						/>
						<button type="button" class="sheet-btn" disabled={!phraseDraft.trim()} onclick={addPhrase}>Add</button>
					</div>
				{/if}
				<p class="field-hint">Optional. Exact text this kind of document always prints, such as its title.</p>
				{@render problemList(attempted ? errorsUnder(problems, 'phrases') : [])}
			</div>
		</section>

		<section class="detail-card">
			<div class="detail-card-head"><span class="detail-card-title">How to read it</span></div>

			<div class="field">
				<label class="field-label" for="pf-instructions">Instructions</label>
				<Textarea id="pf-instructions" rows={6} bind:value={form.instructions} disabled={!canChange} class="leading-relaxed" />
				<p class="field-hint">
					Used in place of the custom instructions in Settings › Intelligence, for documents read with this profile only. The
					built-in rules and your category list are always sent as well.
				</p>
				{@render problemList(shown('instructions'))}
			</div>

			<div class="field" style={showEveryTransactionTotal ? '' : 'margin-bottom:0;'}>
				<label class="field-label" for="pf-stated-total">Stated total{showEveryTransactionTotal ? ' · Summary' : ''}</label>
				<Input
					id="pf-stated-total"
					bind:value={form.statedTotals[ImportMode.Summary]}
					disabled={!canChange}
					class="w-full"
					placeholder="e.g. Total payout released"
				/>
				<p class="field-hint">
					The printed total the items should add up to. The group shows whether they match. Leave empty if the document
					prints none.
				</p>
				{@render problemList(shown('statedTotalLabels'))}
				{@render problemList(shown('statedTotalLabels.summary'))}
			</div>

			{#if showEveryTransactionTotal}
				<div class="field" style="margin-bottom:0;">
					<label class="field-label" for="pf-stated-total-every">Stated total · Every transaction</label>
					<Input
						id="pf-stated-total-every"
						bind:value={form.statedTotals[ImportMode.EveryTransaction]}
						disabled={!canChange}
						class="w-full"
						placeholder="e.g. Total money in"
					/>
					<p class="field-hint">
						The printed total the transaction rows should add up to, for a document imported as Every transaction.
						Leave empty if the document prints none.
					</p>
					{@render problemList(shown('statedTotalLabels.every_transaction'))}
				</div>
			{/if}
		</section>

		<div class="pf-sections-head">
			<span class="detail-card-title">Sections</span>
			{#if canChange && form.sections.length < PROFILE_SECTIONS_MAX}
				<button type="button" class="sheet-btn" onclick={addSection}><Plus size={14} /> Add section</button>
			{/if}
		</div>
		{@render problemList(shown('sections'))}

		{#each form.sections as section, index (section.uid)}
			{@const at = `sections[${index}]`}
			<section class="detail-card pf-section">
				<div class="detail-card-head">
					<span class="detail-card-title">Section {index + 1}{section.name.trim() ? ` · ${section.name.trim()}` : ''}</span>
					{#if canChange}
						<span class="pf-section-tools">
							<button type="button" class="pf-icon-btn" aria-label="Move section up" disabled={index === 0} onclick={() => moveSection(index, -1)}>↑</button>
							<button
								type="button"
								class="pf-icon-btn"
								aria-label="Move section down"
								disabled={index === form.sections.length - 1}
								onclick={() => moveSection(index, 1)}>↓</button
							>
							<button
								type="button"
								class="pf-icon-btn pf-icon-danger"
								aria-label="Remove section"
								title={form.sections.length === 1 ? 'A profile needs at least one section.' : 'Remove section'}
								disabled={form.sections.length === 1}
								onclick={() => removeSection(section.uid)}
							>
								<Trash2 size={13} />
							</button>
						</span>
					{/if}
				</div>
				{@render problemList(shown(at))}

				<div class="field">
					<label class="field-label" for="pf-s-name-{section.uid}">Name *</label>
					<Input id="pf-s-name-{section.uid}" bind:value={section.name} disabled={!canChange} class="w-full" placeholder="e.g. Fees" />
					{#if keys[index]}<p class="field-hint">Saved as <code>{keys[index]}</code>.</p>{/if}
					{@render problemList(shown(`${at}.name`))}
					{@render problemList(shown(`${at}.key`))}
				</div>

				<div class="field">
					<label class="field-label" for="pf-s-desc-{section.uid}">What it is and where to find it *</label>
					<Textarea id="pf-s-desc-{section.uid}" rows={2} bind:value={section.description} disabled={!canChange} class="leading-relaxed" />
					{@render problemList(shown(`${at}.description`))}
				</div>

				<div class="field">
					<span class="field-label">Import *</span>
					<div class="chip-row" role="radiogroup" aria-label="Import">
						{#each MODES as mode (mode.value)}
							<label class="chip" class:on={section.mode === mode.value}>
								<input
									type="radio"
									name="pf-mode-{section.uid}"
									value={mode.value}
									checked={section.mode === mode.value}
									disabled={!canChange}
									onchange={() => (section.mode = mode.value)}
								/>
								{mode.label}
							</label>
						{/each}
					</div>
					<p class="field-hint">
						{section.mode === ImportMode.EveryTransaction
							? 'Read only when a document is uploaded with Import: Every transaction. One item per row of the transaction table.'
							: 'Read only when a document is uploaded with Import: Summary, the default.'}
					</p>
					{@render problemList(shown(`${at}.mode`))}
				</div>

				<div class="field">
					<span class="field-label">Kind *</span>
					<div class="chip-row" role="radiogroup" aria-label="Kind">
						{#each KINDS as kind (kind.value)}
							<label class="chip" class:on={section.kind === kind.value}>
								<input
									type="radio"
									name="pf-kind-{section.uid}"
									value={kind.value}
									checked={section.kind === kind.value}
									disabled={!canChange}
									onchange={() => setKind(section, kind.value)}
								/>
								{kind.label}
							</label>
						{/each}
					</div>
					{#if section.kind === 'by_sign'}
						<p class="field-hint">A positive amount becomes income and a negative one an expense. Both are saved without the sign.</p>
					{:else}
						<p class="field-hint">
							A line of the other sign is left out and listed with the ignored lines, never turned into a {section.kind}.
						</p>
					{/if}
					{@render problemList(shown(`${at}.kind`))}
				</div>

				<div class="field">
					<span class="field-label">Fixed category</span>
					<ProfileCategorySelect
						groups={categoryGroups(section.kind)}
						value={section.fixedCategoryAccountId}
						noneLabel="None"
						ariaLabel="Fixed category for {section.name || `section ${index + 1}`}"
						disabled={!canChange}
						onchange={(value) => (section.fixedCategoryAccountId = value)}
					/>
					<p class="field-hint">
						Used only when the section lists no fee types. With fee types, each line takes its fee type's category;
						an Auto fee type takes the category the reader suggests.
					</p>
					{@render problemList(shown(`${at}.fixedCategoryAccountId`))}
				</div>

				<div class="field">
					<span class="field-label">Fee types</span>
					{#if section.feeTypes.length > 0}
						<div class="pf-fees">
							<div class="pf-fee pf-fee-head" aria-hidden="true">
								<span>Fee type</span><span>Which lines are this type</span><span>Category</span><span></span>
							</div>
							{#each section.feeTypes as fee, feeIndex (fee.uid)}
								{@const feeAt = `${at}.feeTypes[${feeIndex}]`}
								<div class="pf-fee">
									<div>
										<Input
											value={fee.key}
											aria-label="Fee type key"
											placeholder="commission_fee"
											disabled={!canChange}
											class="w-full pf-mono"
											oninput={(event: Event) => typeKey(fee, event.currentTarget as HTMLInputElement)}
										/>
									</div>
									<div>
										<Input
											bind:value={fee.description}
											aria-label="Which lines are this type"
											placeholder="e.g. Commission charged on sales"
											disabled={!canChange}
											class="w-full"
										/>
									</div>
									<div>
										<ProfileCategorySelect
											groups={categoryGroups(section.kind)}
											value={fee.categoryAccountId}
											noneLabel="Auto"
											ariaLabel="Category for {fee.key || 'this fee type'}"
											disabled={!canChange}
											onchange={(value) => (fee.categoryAccountId = value)}
										/>
									</div>
									<div class="pf-fee-remove">
										{#if canChange}
											<button type="button" class="pf-icon-btn pf-icon-danger" aria-label="Remove fee type" onclick={() => removeFeeType(section, fee.uid)}>
												<Trash2 size={13} />
											</button>
										{/if}
									</div>
								</div>
								{@render problemList([
									...shown(feeAt),
									...shown(`${feeAt}.key`),
									...shown(`${feeAt}.description`),
									...shown(`${feeAt}.categoryAccountId`)
								])}
							{/each}
						</div>
					{/if}
					{#if canChange && section.feeTypes.length < PROFILE_FEE_TYPES_MAX}
						<button type="button" class="detail-card-action pf-add-fee" onclick={() => addFeeType(section)}>
							<Plus size={13} /> Add fee type
						</button>
					{/if}
					<p class="field-hint">
						With fee types listed, only lines of a listed type are read; any other line is left out and listed as ignored. Each
						item's remark names its type. "Auto" takes the AI's suggested category, or Uncategorised. With none listed, every
						line the description fits is read.
					</p>
					{#if section.kind === 'by_sign' && section.feeTypes.length > 0}
						<p class="field-hint">
							By sign: an income category applies only to lines printed positive, and an expense category only to lines
							printed negative. A line of the other sign keeps the AI's suggestion or Uncategorised, and is marked to check.
						</p>
					{/if}
					{@render problemList(shown(`${at}.feeTypes`))}
				</div>

				<details
					class="pf-advanced"
					bind:open={
						() => advancedOpen[section.uid] ?? section.extrasText.trim() !== '',
						(value) => (advancedOpen[section.uid] = value)
					}
				>
					<summary>Advanced: extra fields</summary>
					<div class="field" style="margin:10px 0 0;">
						<Textarea
							bind:value={section.extrasText}
							rows={6}
							disabled={!canChange}
							spellcheck={false}
							aria-label="Extra fields for {section.name || `section ${index + 1}`}, as JSON Schema"
							class="pf-mono leading-relaxed"
							placeholder={'{\n  "type": "object",\n  "properties": {\n    "order_no": { "type": ["string", "null"], "description": "The order number" }\n  }\n}'}
						/>
						<p class="field-hint">
							Plain values to read from each line, such as an order number, written as a JSON Schema object. Each field may
							use only <code>type</code> (string, number, integer or boolean, or one of them with "null"),
							<code>description</code> and <code>enum</code> (text only). Values are added to the item's remark
							as "name: value".
						</p>
						{#each extrasProblems(index) as message, messageIndex (messageIndex)}
							<p class="pf-problem">{message}</p>
						{/each}
						{#if section.extrasText.trim() && extrasProblems(index).length === 0}
							<p class="pf-ok">These extra fields can be saved.</p>
						{/if}
					</div>
				</details>
			</section>
		{/each}

		{#if attempted && problems.length > 0}
			<section class="detail-card pf-summary" role="alert">
				<div class="detail-card-head"><span class="detail-card-title">To fix before saving</span></div>
				<ul>
					{#each problems as problem, problemIndex (problemIndex)}
						<li>{problem.path ? `${problem.path}: ` : ''}{problem.message}</li>
					{/each}
				</ul>
			</section>
		{/if}
	{/snippet}

	{#snippet rail()}
		<section class="detail-card">
			<div class="detail-card-head"><span class="detail-card-title">How a profile is used</span></div>
			<ul class="pf-notes">
				<li>Choose it under “Read as” when uploading. Only the sections here are read; nothing else on the document becomes a record.</li>
				<li>Each section is read as a summary: one item per line it lists.</li>
				<li>The AI copies what is printed. Totals and signs are worked out by the app, to the cent.</li>
				<li>Editing, turning off or deleting a profile never changes documents already read with it.</li>
			</ul>
		</section>
		{#if saved}
			<section class="detail-card">
				<div class="detail-card-head"><span class="detail-card-title">History</span></div>
				<AuditTrail bind:this={auditRef} recordType="import_profile" recordId={saved.id} />
			</section>
		{/if}
	{/snippet}
</DetailPage>

{#snippet problemList(messages: string[])}
	{#each messages as message, messageIndex (messageIndex)}
		<p class="pf-problem">{message}</p>
	{/each}
{/snippet}

<ConfirmDialog
	bind:open={deleteOpen}
	title="Delete this import profile?"
	description={`“${saved?.name ?? ''}” will no longer be offered under “Read as”. Documents already read with it keep what they were read as: nothing in their groups changes, and records made from them stay as they are.`}
	confirmLabel="Delete"
	danger
	onConfirm={deleteProfile}
/>

<ConfirmDialog
	bind:open={replaceOpen}
	title="Start again from this?"
	description="What you have filled in on this page will be replaced."
	confirmLabel="Replace"
	danger
	onConfirm={() => {
		if (replaceAsk) applyStart(replaceAsk);
		replaceAsk = null;
	}}
/>

<style>
	.pf-title {
		overflow-wrap: anywhere;
	}
	.pf-hero-status {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}
	.hero-error {
		background: var(--red-soft);
		color: var(--red);
		border-radius: 8px;
		padding: 8px 12px;
		font-size: 13px;
		margin: 8px 0 0;
	}
	.pf-problem {
		font-size: 12px;
		color: var(--red);
		margin: 5px 0 0;
		overflow-wrap: anywhere;
	}
	.pf-ok {
		font-size: 12px;
		color: var(--green);
		margin: 5px 0 0;
	}
	code {
		font-family: 'Geist Mono', monospace;
		font-size: 11.5px;
	}
	:global(.pf-mono) {
		font-family: 'Geist Mono', monospace;
		font-size: 12.5px;
	}

	/* Starters */
	.pf-starts {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: 8px;
	}
	.pf-start {
		display: flex;
		flex-direction: column;
		gap: 3px;
		padding: 10px 12px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--card);
		font-family: inherit;
		text-align: left;
		cursor: pointer;
		color: var(--foreground);
	}
	.pf-start:hover {
		border-color: var(--primary);
	}
	.pf-start.on {
		border-color: var(--primary);
		background: var(--primary-soft);
	}
	.pf-start-name {
		font-size: 13px;
		font-weight: 500;
	}
	.pf-start-hint {
		font-size: 12px;
		color: var(--muted-foreground);
	}

	/* Phrases */
	.pf-phrases {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-bottom: 8px;
	}
	.pf-phrase {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		max-width: 100%;
		padding: 3px 6px 3px 10px;
		border: 1px solid var(--border);
		border-radius: 999px;
		background: var(--accent);
		font-size: 12.5px;
	}
	.pf-phrase-text {
		overflow-wrap: anywhere;
	}
	.pf-phrase-remove {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		border: none;
		border-radius: 999px;
		background: none;
		color: var(--muted-foreground);
		cursor: pointer;
	}
	.pf-phrase-remove:hover {
		color: var(--foreground);
		background: var(--card);
	}
	.pf-inline {
		display: flex;
		gap: 8px;
		align-items: center;
	}

	/* Sections */
	.pf-sections-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-top: 4px;
	}
	.pf-section-tools {
		display: inline-flex;
		gap: 4px;
	}
	.pf-icon-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		flex-shrink: 0;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--card);
		color: var(--muted-foreground);
		font-family: inherit;
		font-size: 13px;
		cursor: pointer;
	}
	.pf-icon-btn:hover:not(:disabled) {
		color: var(--foreground);
		background: var(--accent);
	}
	.pf-icon-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.pf-icon-danger:hover:not(:disabled) {
		color: var(--red);
		border-color: var(--red);
		background: var(--red-soft);
	}

	.chip-row {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 6px 12px;
		font-size: 13px;
		cursor: pointer;
		background: var(--card);
	}
	.chip.on {
		border-color: var(--primary);
		background: var(--primary-soft);
	}
	.chip input {
		display: none;
	}
	.chip:has(input:disabled) {
		cursor: not-allowed;
		opacity: 0.7;
	}

	/* Fee types: four columns on a wide screen, stacked on a phone. */
	.pf-fees {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin-bottom: 8px;
	}
	.pf-fee {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr) minmax(0, 1fr) 28px;
		gap: 8px;
		align-items: center;
	}
	.pf-fee-head {
		font-size: 11.5px;
		color: var(--muted-foreground);
	}
	.pf-add-fee {
		margin-bottom: 2px;
	}
	@media (max-width: 720px) {
		.pf-fee {
			grid-template-columns: minmax(0, 1fr);
			padding-bottom: 8px;
			border-bottom: 1px dashed var(--border);
		}
		.pf-fee-remove {
			justify-self: end;
		}
		.pf-fee-head {
			display: none;
		}
	}

	.pf-advanced summary {
		cursor: pointer;
		font-size: 12.5px;
		font-weight: 500;
	}

	.pf-summary ul,
	.pf-notes {
		margin: 0;
		padding-left: 18px;
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 12.5px;
	}
	.pf-summary li {
		color: var(--red);
		overflow-wrap: anywhere;
	}
	.pf-notes {
		color: var(--muted-foreground);
	}
</style>
