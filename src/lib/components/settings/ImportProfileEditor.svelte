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
	import ProfileColumnSelect from './ProfileColumnSelect.svelte';
	import {
		PROFILE_FEE_TYPES_MAX,
		PROFILE_PHRASES_MAX,
		PROFILE_SAME_MONEY_MAX,
		PROFILE_SECTIONS_MAX,
		ROW_CONDITIONS_MAX,
		TABLE_DATE_FORMATS,
		checkProfile,
		type ProfileError,
		type ProfileSectionKind,
		type RowConditionOp
	} from '$lib/import-profile-schema.js';
	import { ImportMode, importModeLabel, type ImportModeValue } from '$lib/import-reading.js';
	import { IMPORT_PROFILE_STARTERS, starterDraft, type ImportProfileStarterId } from '$lib/import-profile-starters.js';
	import {
		blankForm,
		errorsAt,
		errorsUnder,
		formFingerprint,
		formFromDraft,
		layoutHeadings,
		newCondition,
		newFeeType,
		newLayout,
		newRows,
		newSection,
		payloadFromForm,
		sectionKeys,
		typingKey,
		type ConditionForm,
		type ProfileForm,
		type RowsForm,
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
	 * The profile says what it imports, once: Summary lines or Every
	 * transaction (FR-002, FR-032). Every section is read that way, and there
	 * is one stated total. To read one kind of document both ways, make two
	 * profiles. A profile saved when each section had its own mode, with
	 * sections in both, shows a problem on the sections in the other mode
	 * until they are moved or kept on purpose.
	 *
	 * A section can be a Transfer between the profile's account and another
	 * account that holds money (FR-058), and can name other profiles whose
	 * records describe the same money (FR-066). A profile can carry a table
	 * layout and each section row rules, for reading a spreadsheet from its
	 * columns with no AI (FR-053 to FR-055); Preview reads a sample with the
	 * profile as it is on the page, saved or not, and stores nothing.
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
		moneyAccounts,
		otherProfiles,
		canChange
	}: {
		profile: ImportProfileView | null;
		starter: ImportProfileStarterId | null;
		expenseCategories: Choice[];
		incomeCategories: Choice[];
		/** Accounts that hold money: the profile's account and each transfer's other one (FR-058). */
		moneyAccounts: Choice[];
		/** The other saved profiles, which a section can name as the same money (FR-066). */
		otherProfiles: { id: number; name: string }[];
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
	const MODES: { value: ImportModeValue; label: string; hint: string }[] = [
		{
			value: ImportMode.Summary,
			label: 'Summary lines',
			hint: 'One item for each line of the summary, such as total sales or each kind of fee.'
		},
		{
			value: ImportMode.EveryTransaction,
			label: 'Every transaction',
			hint: 'One item for each row of the transaction table.'
		}
	];

	const KINDS: { value: ProfileSectionKind; label: string }[] = [
		{ value: 'income', label: 'Income' },
		{ value: 'expense', label: 'Expense' },
		{ value: 'by_sign', label: 'By sign' },
		{ value: 'transfer', label: 'Transfer' }
	];

	/** The categories a section of this kind can name, as the server checks them. A transfer has none. */
	function categoryGroups(kind: ProfileSectionKind) {
		const groups: { label: string; choices: Choice[] }[] = [];
		if (kind === 'transfer') return groups;
		if (kind !== 'income') groups.push({ label: 'Expense', choices: expenseCategories });
		if (kind !== 'expense') groups.push({ label: 'Income', choices: incomeCategories });
		return groups;
	}

	const accountGroups = $derived([{ label: 'Accounts', choices: moneyAccounts }]);

	/** The money accounts a transfer's other side can be: any but the profile's own. */
	const counterGroups = $derived([
		{ label: 'Accounts', choices: moneyAccounts.filter((account) => account.id !== form.accountId) }
	]);

	const profileNames = $derived(new Map(otherProfiles.map((other) => [other.id, other.name])));

	function toggleSameMoney(section: SectionForm, id: number) {
		section.sameMoneyAs = section.sameMoneyAs.includes(id)
			? section.sameMoneyAs.filter((other) => other !== id)
			: [...section.sameMoneyAs, id];
	}

	// ── The table layout and row rules (FR-053, FR-054) ────────────────────────
	// The headings as typed, once each, are what every column choice offers.
	const headings = $derived([...new Set(layoutHeadings(form.layout))]);
	const headingOptions = $derived(headings.map((heading) => ({ value: heading, label: heading })));

	const DATE_FORMATS = TABLE_DATE_FORMATS.map((format) => ({ value: format, label: format }));
	const DECIMALS = [
		{ value: '.', label: 'Point (1,234.50)' },
		{ value: ',', label: 'Comma (1.234,50)' }
	];
	const CSV_SEPARATORS = [
		{ value: ',', label: 'Comma' },
		{ value: ';', label: 'Semicolon' },
		{ value: '\t', label: 'Tab' },
		{ value: '|', label: 'Vertical bar' }
	];
	const OPS: { value: RowConditionOp; label: string }[] = [
		{ value: 'is', label: 'is' },
		{ value: 'is_not', label: 'is not' },
		{ value: 'is_one_of', label: 'is one of' },
		{ value: 'contains', label: 'contains' },
		{ value: 'empty', label: 'is empty' },
		{ value: 'not_empty', label: 'is not empty' }
	];

	function addLayout() {
		form.layout = newLayout();
	}

	function removeLayout() {
		form.layout = null;
		for (const section of form.sections) section.rows = null;
	}

	function toggleRemark(heading: string) {
		if (!form.layout) return;
		const columns = form.layout.remarkColumns;
		form.layout.remarkColumns = columns.includes(heading)
			? columns.filter((column) => column !== heading)
			: [...columns, heading];
	}

	function addCondition(rows: RowsForm, which: 'where' | 'flagWhen') {
		rows[which] = [...rows[which], newCondition(headings[0] ?? '')];
	}

	function removeCondition(rows: RowsForm, which: 'where' | 'flagWhen', uid: string) {
		rows[which] = rows[which].filter((condition) => condition.uid !== uid);
	}

	/** Whether a condition compares with one value, a list, or nothing. */
	function opTakes(op: RowConditionOp): 'value' | 'values' | 'none' {
		if (op === 'is_one_of') return 'values';
		if (op === 'empty' || op === 'not_empty') return 'none';
		return 'value';
	}

	// ── Preview (FR-053 to FR-055) ─────────────────────────────────────────────
	// The sample is kept out of reactive state, as a File must be; only its
	// name is shown.
	let sampleFile: File | null = null;
	let sampleName = $state('');
	// The form as it was previewed, to say when the preview no longer shows it.
	let previewedFingerprint = $state('');
	let previewing = $state(false);
	let previewError = $state<{ message: string; errors: ProfileError[] } | null>(null);
	type PreviewItem = {
		row: number | null;
		section: string;
		kind: string;
		date: string;
		description: string;
		amountMinor: number;
		reference: string;
		feeType: string | null;
		note: string | null;
	};
	type Preview = {
		mode: ImportModeValue;
		sheet: string;
		headerRow: number;
		rows: number;
		sections: { key: string; name: string; kind: string; count: number }[];
		items: PreviewItem[];
		itemCount: number;
		ignoredCount: number;
		ignored: string[];
		statedTotalMinor: number | null;
		itemsTotalMinor: number;
		balance: { matches: boolean; message: string } | null;
	};
	let preview = $state<Preview | null>(null);

	function chooseSample(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		sampleFile = input.files?.[0] ?? null;
		sampleName = sampleFile?.name ?? '';
		preview = null;
		previewError = null;
	}

	async function runPreview() {
		if (!sampleFile || previewing) return;
		previewing = true;
		previewError = null;
		const body = new FormData();
		body.set('file', sampleFile);
		body.set('profile', JSON.stringify(payloadFromForm(form)));
		const sent = fingerprint;
		try {
			const res = await fetch('/api/import/profiles/preview', { method: 'POST', body, credentials: 'include' });
			const reply = await res.json().catch(() => ({}));
			if (!res.ok) {
				preview = null;
				previewError = {
					message:
						res.status === 403
							? 'You do not have permission to change import profiles.'
							: (reply.error ?? 'The sample could not be read. Try again.'),
					errors: Array.isArray(reply.errors) ? reply.errors : []
				};
				return;
			}
			preview = reply as Preview;
			previewedFingerprint = sent;
		} catch {
			previewError = { message: 'That did not reach the server. Check the connection and try again.', errors: [] };
		} finally {
			previewing = false;
		}
	}

	/** Whole cents as a figure with its sign. */
	function money(minor: number): string {
		const abs = Math.abs(minor);
		return `${minor < 0 ? '-' : ''}${Math.floor(abs / 100).toLocaleString('en-US')}.${String(abs % 100).padStart(2, '0')}`;
	}

	const KIND_LABELS: Record<string, string> = {
		income: 'Income',
		expense: 'Expense',
		transfer_out: 'Transfer out',
		transfer_in: 'Transfer in',
		by_sign: 'By sign',
		transfer: 'Transfer'
	};

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
				<span class="field-label">What this profile imports *</span>
				<div class="pf-modes" role="radiogroup" aria-label="What this profile imports">
					{#each MODES as mode (mode.value)}
						<label class="pf-mode" class:on={form.mode === mode.value}>
							<input
								type="radio"
								name="pf-mode"
								value={mode.value}
								checked={form.mode === mode.value}
								disabled={!canChange}
								onchange={() => (form.mode = mode.value)}
							/>
							<span class="pf-mode-main">
								<span class="pf-mode-label">{mode.label}</span>
								<span class="pf-mode-hint">{mode.hint}</span>
							</span>
						</label>
					{/each}
				</div>
				<p class="field-hint">
					Every document read with this profile is read this way. To read one kind of document both ways, make two profiles.
				</p>
				{@render problemList(shown('mode'))}
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

			<div class="field" style="margin-bottom:0;">
				<label class="field-label" for="pf-stated-total">Stated total</label>
				<Input
					id="pf-stated-total"
					bind:value={form.statedTotal}
					disabled={!canChange}
					class="w-full"
					placeholder={form.mode === ImportMode.EveryTransaction ? 'e.g. Total money in' : 'e.g. Total payout released'}
				/>
				<p class="field-hint">
					The printed total the items should add up to. The group shows whether they match. Leave empty if the document
					prints none.
				</p>
				{@render problemList(attempted ? errorsUnder(problems, 'statedTotalLabels') : [])}
			</div>

			<div class="field" style="margin:14px 0 0;">
				<span class="field-label">Account</span>
				<ProfileCategorySelect
					groups={accountGroups}
					value={form.accountId}
					noneLabel="None"
					ariaLabel="The account this document lists"
					missingLabel="Account no longer available"
					disabled={!canChange}
					onchange={(value) => (form.accountId = value)}
				/>
				<p class="field-hint">
					Optional. The account this document lists, such as a marketplace wallet. Its income and expense items start on it
					instead of Accounts receivable or Accounts payable, and every transfer moves money out of it or into it. A
					Transfer section needs one.
				</p>
				{@render problemList(shown('accountId'))}
			</div>
		</section>

		{@render layoutCard()}

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

				{#if section.legacyMode && section.legacyMode !== form.mode}
					<!-- Saved when each section had its own mode (FR-032): shown at once, not only after Save. -->
					<div class="pf-legacy-mode" role="alert">
						{@render problemList(errorsAt(problems, `${at}.mode`))}
						{#if canChange}
							<button type="button" class="sheet-btn" onclick={() => (section.legacyMode = null)}>
								Keep it and read it as {importModeLabel(form.mode)}
							</button>
						{/if}
					</div>
				{/if}

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
					{:else if section.kind === 'transfer'}
						<p class="field-hint">
							Money moved between two of your own accounts, such as a withdrawal from a wallet to the bank. A negative amount
							leaves the profile's account for the other account; a positive one comes back. Saved without the sign, with no
							category and no contact.
						</p>
					{:else}
						<p class="field-hint">
							A line of the other sign is left out and listed with the ignored lines, never turned into a {section.kind}.
						</p>
					{/if}
					{@render problemList(shown(`${at}.kind`))}
				</div>

				{#if section.kind === 'transfer'}
					<div class="field">
						<span class="field-label">Other account *</span>
						<ProfileCategorySelect
							groups={counterGroups}
							value={section.counterAccountId}
							noneLabel="Select account"
							ariaLabel="Other account of {section.name || `section ${index + 1}`}"
							missingLabel="Account no longer available"
							disabled={!canChange}
							onchange={(value) => (section.counterAccountId = value)}
						/>
						<p class="field-hint">Where the money goes to, or comes from, such as the bank account a withdrawal is paid into.</p>
						{@render problemList(shown(`${at}.counterAccountId`))}
					</div>
				{:else}
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
				{/if}

				{#if section.kind !== 'transfer' || section.feeTypes.length > 0}
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
									{#if section.rows?.feeTypeColumn}
										<div class="pf-fee-values">
											<Textarea
												bind:value={fee.valuesText}
												rows={2}
												disabled={!canChange}
												aria-label="Values of {section.rows.feeTypeColumn} that mean {fee.key || 'this fee type'}"
												placeholder="Values of “{section.rows.feeTypeColumn}”, one per line"
												class="leading-relaxed"
											/>
										</div>
									{/if}
									{@render problemList([
										...shown(feeAt),
										...shown(`${feeAt}.key`),
										...shown(`${feeAt}.description`),
										...shown(`${feeAt}.categoryAccountId`),
										...(attempted ? errorsUnder(problems, `${feeAt}.values`) : [])
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
				{/if}

				{#if section.kind !== 'transfer' && (otherProfiles.length > 0 || section.sameMoneyAs.length > 0)}
					<div class="field">
						<span class="field-label">Same money as</span>
						<div class="chip-row" role="group" aria-label="Same money as">
							{#each otherProfiles as other (other.id)}
								<label class="chip" class:on={section.sameMoneyAs.includes(other.id)}>
									<input
										type="checkbox"
										checked={section.sameMoneyAs.includes(other.id)}
										disabled={!canChange ||
											(!section.sameMoneyAs.includes(other.id) && section.sameMoneyAs.length >= PROFILE_SAME_MONEY_MAX)}
										onchange={() => toggleSameMoney(section, other.id)}
									/>
									{other.name}
								</label>
							{/each}
							{#each section.sameMoneyAs.filter((id) => !profileNames.has(id)) as gone (gone)}
								<label class="chip on">
									<input type="checkbox" checked disabled={!canChange} onchange={() => toggleSameMoney(section, gone)} />
									Deleted profile
								</label>
							{/each}
						</div>
						<p class="field-hint">
							Optional. Profiles whose records already hold this money, such as the income statement whose summary has the
							same sales. When records made with one of them cover an item's month, the item is marked to check, so the money
							is not counted twice.
						</p>
						{@render problemList(attempted ? errorsUnder(problems, `${at}.sameMoneyAs`) : [])}
					</div>
				{/if}

				{#if form.layout}
					{@render rowRules(section, at)}
				{/if}

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
				<li>
					A profile imports one thing: Summary lines, one item per summary line, or Every transaction, one item per row of
					the transaction table. To read one kind of document both ways, make two profiles and choose the one you want.
				</li>
				<li>
					Auto-detect cannot tell two profiles made for the same document apart. Turn one off, give each its own recognition
					phrases, or choose one under “Read as”.
				</li>
				<li>
					With a table layout, and row rules on every section, a spreadsheet is read from its columns with no AI. Try it on a
					sample under Preview before saving.
				</li>
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

{#snippet columnField(label: string, path: string, value: string, set: (value: string) => void, noneLabel: string | null, hint: string)}
	<div class="field">
		<span class="field-label">{label}</span>
		<ProfileColumnSelect
			options={headingOptions}
			{value}
			{noneLabel}
			placeholder={headings.length ? 'Choose a heading' : 'List the headings first'}
			ariaLabel={label}
			disabled={!canChange}
			onchange={set}
		/>
		{#if hint}<p class="field-hint">{hint}</p>{/if}
		{@render problemList(shown(path))}
	</div>
{/snippet}

{#snippet layoutCard()}
	<section class="detail-card">
		<div class="detail-card-head">
			<span class="detail-card-title">Table layout</span>
			{#if canChange && form.layout}
				<button type="button" class="detail-card-action" onclick={removeLayout}>Remove</button>
			{/if}
		</div>
		{#if !form.layout}
			<p class="field-hint" style="margin-top:0;">
				For a spreadsheet (.xlsx or .csv) with one row per transaction under a row of headings. Describe its columns once,
				give each section row rules, and the app reads every row from its cells, with no AI and no AI provider needed.
			</p>
			{#if canChange}
				<button type="button" class="sheet-btn" onclick={addLayout}><Plus size={14} /> Add a table layout</button>
			{/if}
			{@render problemList(attempted ? errorsUnder(problems, 'layout') : [])}
		{:else}
			{@const layout = form.layout}
			<div class="field">
				<label class="field-label" for="pf-headers">Headings *</label>
				<Textarea
					id="pf-headers"
					rows={4}
					bind:value={layout.headersText}
					disabled={!canChange}
					class="leading-relaxed"
					placeholder="One per line, e.g. Date"
				/>
				<p class="field-hint">
					One per line, as the spreadsheet prints them. The table is found by the first row that has all of them, wherever
					it is on the sheet. The columns below are chosen from these.
				</p>
				{@render problemList(attempted ? errorsUnder(problems, 'layout.headers') : [])}
			</div>

			<div class="pf-grid">
				{@render columnField('Date column *', 'layout.columns.date', layout.date, (v) => (layout.date = v), null, '')}
				{@render columnField('Description column *', 'layout.columns.description', layout.description, (v) => (layout.description = v), null, '')}
				{@render columnField('Amount column *', 'layout.columns.amount', layout.amount, (v) => (layout.amount = v), null, '')}
				{@render columnField('Reference column', 'layout.columns.reference', layout.reference, (v) => (layout.reference = v), 'None', '')}
			</div>

			<div class="pf-grid">
				<div class="field">
					<span class="field-label">Date format</span>
					<ProfileColumnSelect
						options={DATE_FORMATS}
						value={layout.dateFormat}
						ariaLabel="Date format"
						disabled={!canChange}
						onchange={(value) => (layout.dateFormat = value as typeof layout.dateFormat)}
					/>
					<p class="field-hint">For dates written as text. A real date cell needs none.</p>
					{@render problemList(shown('layout.dateFormat'))}
				</div>
				<div class="field">
					<span class="field-label">Decimal separator</span>
					<ProfileColumnSelect
						options={DECIMALS}
						value={layout.decimalSeparator}
						ariaLabel="Decimal separator"
						disabled={!canChange}
						onchange={(value) => (layout.decimalSeparator = value === ',' ? ',' : '.')}
					/>
					{@render problemList(shown('layout.decimalSeparator'))}
				</div>
				<div class="field">
					<span class="field-label">CSV separator</span>
					<ProfileColumnSelect
						options={CSV_SEPARATORS}
						value={layout.csvDelimiter}
						noneLabel="Work it out from the file"
						ariaLabel="CSV separator"
						disabled={!canChange}
						onchange={(value) => (layout.csvDelimiter = value as typeof layout.csvDelimiter)}
					/>
					{@render problemList(shown('layout.csvDelimiter'))}
				</div>
				<div class="field">
					<label class="field-label" for="pf-sheet">Sheet</label>
					<Input id="pf-sheet" bind:value={layout.sheet} disabled={!canChange} class="w-full" placeholder="Any sheet" />
					{@render problemList(shown('layout.sheet'))}
				</div>
			</div>

			{@render columnField(
				'Direction column',
				'layout.direction.column',
				layout.directionColumn,
				(v) => (layout.directionColumn = v),
				'None',
				'Optional. A column that says which way the money went. When set, it gives each amount its sign, even one printed without a sign.'
			)}
			{#if layout.directionColumn || layout.directionInText.trim() || layout.directionOutText.trim()}
				<div class="pf-grid">
					<div class="field">
						<label class="field-label" for="pf-dir-in">Inflow values *</label>
						<Textarea id="pf-dir-in" rows={2} bind:value={layout.directionInText} disabled={!canChange} placeholder="One per line" />
						{@render problemList(attempted ? errorsUnder(problems, 'layout.direction.in') : [])}
					</div>
					<div class="field">
						<label class="field-label" for="pf-dir-out">Outflow values *</label>
						<Textarea id="pf-dir-out" rows={2} bind:value={layout.directionOutText} disabled={!canChange} placeholder="One per line" />
						{@render problemList(attempted ? errorsUnder(problems, 'layout.direction.out') : [])}
					</div>
				</div>
				{@render problemList(shown('layout.direction'))}
			{/if}

			{@render columnField(
				'Running balance column',
				'layout.balanceColumn',
				layout.balanceColumn,
				(v) => (layout.balanceColumn = v),
				'None',
				'Optional. The balance after each row. The reading checks that it follows from row to row and says so in a note; a row missing from the export breaks it.'
			)}

			<div class="field">
				<span class="field-label">Add to the remark</span>
				{#if headings.length}
					<div class="chip-row" role="group" aria-label="Columns added to the remark">
						{#each headings as heading (heading)}
							<label class="chip" class:on={layout.remarkColumns.includes(heading)}>
								<input
									type="checkbox"
									checked={layout.remarkColumns.includes(heading)}
									disabled={!canChange}
									onchange={() => toggleRemark(heading)}
								/>
								{heading}
							</label>
						{/each}
					</div>
				{/if}
				<p class="field-hint">Optional. Each chosen column's value is added to the item's remark as "heading: value".</p>
				{@render problemList(attempted ? errorsUnder(problems, 'layout.remarkColumns') : [])}
			</div>

			<div class="pf-grid">
				<div class="field">
					<label class="field-label" for="pf-counterparty">Other party</label>
					<Input id="pf-counterparty" bind:value={layout.counterparty} disabled={!canChange} class="w-full" placeholder="None" />
					<p class="field-hint">The supplier or customer every income and expense item shares. Never a transfer.</p>
					{@render problemList(shown('layout.counterparty'))}
				</div>
				<div class="field">
					<label class="field-label" for="pf-currency">Currency</label>
					<Input id="pf-currency" bind:value={layout.currency} disabled={!canChange} class="w-full" placeholder="Main currency" />
					<p class="field-hint">A three-letter code, such as MYR. Empty: the main currency.</p>
					{@render problemList(shown('layout.currency'))}
				</div>
				<div class="field">
					<label class="field-label" for="pf-doc-date">Document date label</label>
					<Input id="pf-doc-date" bind:value={layout.documentDateLabel} disabled={!canChange} class="w-full" placeholder="None" />
					<p class="field-hint">The label the document's date is printed beside, such as "To".</p>
					{@render problemList(shown('layout.documentDateLabel'))}
				</div>
			</div>

			<div class="field" style="margin-bottom:0;">
				<label class="field-label" for="pf-totals">Stated total labels</label>
				<Textarea
					id="pf-totals"
					rows={2}
					bind:value={layout.totalsText}
					disabled={!canChange}
					placeholder="One per line, e.g. Total Money In"
				/>
				<p class="field-hint">
					The labels the totals are printed beside, outside the table. The figures beside them are added up and compared with
					the items. Empty: no control total.
				</p>
				{@render problemList(attempted ? errorsUnder(problems, 'layout.statedTotalLabels') : [])}
			</div>
			{@render problemList(shown('layout.columns'))}
		{/if}
	</section>

	{#if form.layout && canChange}
		{@render previewCard()}
	{/if}
{/snippet}

{#snippet previewCard()}
	<section class="detail-card">
		<div class="detail-card-head"><span class="detail-card-title">Preview</span></div>
		<p class="field-hint" style="margin-top:0;">
			Read a sample spreadsheet with this profile as it is now, saved or not. Nothing is stored and no records are made.
		</p>
		<div class="pf-inline pf-preview-pick">
			<input type="file" accept=".xlsx,.csv" aria-label="Sample spreadsheet" onchange={chooseSample} />
			<button type="button" class="sheet-btn" disabled={!sampleName || previewing} onclick={runPreview}>
				{previewing ? 'Reading…' : 'Preview'}
			</button>
		</div>

		{#if previewError}
			<div class="pf-preview-error" role="alert">
				<p>{previewError.message}</p>
				{#if previewError.errors.length}
					<ul>
						{#each previewError.errors as problem, problemIndex (problemIndex)}
							<li>{problem.path ? `${problem.path}: ` : ''}{problem.message}</li>
						{/each}
					</ul>
				{/if}
			</div>
		{:else if preview}
			<div class="pf-preview">
				{#if previewedFingerprint !== fingerprint}
					<p class="field-hint" style="margin:0;">The profile has changed since this preview. Preview again to see the change.</p>
				{/if}
				<p class="pf-preview-line">
					{importModeLabel(preview.mode)} · headings found on “{preview.sheet}”, row {preview.headerRow} ·
					{preview.rows.toLocaleString('en-US')} row{preview.rows === 1 ? '' : 's'} in the table
				</p>
				<ul class="pf-preview-counts">
					{#each preview.sections as counted (counted.key)}
						<li>{counted.name} ({KIND_LABELS[counted.kind] ?? counted.kind}): {counted.count.toLocaleString('en-US')}</li>
					{/each}
					<li>Left out: {preview.ignoredCount.toLocaleString('en-US')}</li>
				</ul>
				{#if preview.statedTotalMinor !== null}
					<p class="pf-preview-line" class:pf-ok={preview.statedTotalMinor === preview.itemsTotalMinor} class:pf-problem={preview.statedTotalMinor !== preview.itemsTotalMinor}>
						Items {money(preview.itemsTotalMinor)} against the stated total {money(preview.statedTotalMinor)}:
						{preview.statedTotalMinor === preview.itemsTotalMinor ? 'they match' : `a difference of ${money(preview.itemsTotalMinor - preview.statedTotalMinor)}`}.
					</p>
				{/if}
				{#if preview.balance}
					<p class="pf-preview-line" class:pf-ok={preview.balance.matches} class:pf-problem={!preview.balance.matches}>
						{preview.balance.message}
					</p>
				{/if}
				{#if preview.items.length}
					<div class="pf-preview-table">
						<table>
							<thead>
								<tr><th>Row</th><th>Section</th><th>Kind</th><th>Date</th><th>Description</th><th class="num">Amount</th><th>Reference</th></tr>
							</thead>
							<tbody>
								{#each preview.items as item, itemIndex (itemIndex)}
									<tr>
										<td>{item.row ?? '—'}</td>
										<td>{item.section}{item.feeType ? ` · ${item.feeType}` : ''}</td>
										<td>{KIND_LABELS[item.kind] ?? item.kind}</td>
										<td>{item.date}</td>
										<td>
											{item.description}
											{#if item.note}<span class="pf-preview-note">{item.note}</span>{/if}
										</td>
										<td class="num">{money(item.amountMinor)}</td>
										<td>{item.reference || '—'}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
					{#if preview.itemCount > preview.items.length}
						<p class="field-hint">The first {preview.items.length} of {preview.itemCount.toLocaleString('en-US')} items.</p>
					{/if}
				{:else}
					<p class="pf-problem">No row fits a section, so nothing would be imported.</p>
				{/if}
				{#if preview.ignored.length}
					<details class="pf-advanced">
						<summary>Some rows left out</summary>
						<ul class="pf-notes" style="margin-top:6px;">
							{#each preview.ignored as line, lineIndex (lineIndex)}<li>{line}</li>{/each}
						</ul>
					</details>
				{/if}
			</div>
		{/if}
	</section>
{/snippet}

{#snippet conditionList(rows: RowsForm, which: 'where' | 'flagWhen', path: string, label: string)}
	{#each rows[which] as condition, conditionIndex (condition.uid)}
		{@const conditionAt = `${path}.${which}[${conditionIndex}]`}
		{@render conditionRow(rows, which, condition, conditionAt)}
	{/each}
	{#if canChange && rows[which].length < ROW_CONDITIONS_MAX}
		<button type="button" class="detail-card-action pf-add-fee" onclick={() => addCondition(rows, which)}>
			<Plus size={13} /> {label}
		</button>
	{/if}
	{@render problemList(shown(`${path}.${which}`))}
{/snippet}

{#snippet conditionRow(rows: RowsForm, which: 'where' | 'flagWhen', condition: ConditionForm, conditionAt: string)}
	<div class="pf-condition">
		<ProfileColumnSelect
			options={headingOptions}
			value={condition.column}
			placeholder="Column"
			ariaLabel="Column"
			disabled={!canChange}
			onchange={(value) => (condition.column = value)}
		/>
		<ProfileColumnSelect
			options={OPS}
			value={condition.op}
			ariaLabel="How the cell is compared"
			disabled={!canChange}
			onchange={(value) => (condition.op = value as RowConditionOp)}
		/>
		{#if opTakes(condition.op) === 'value'}
			<Input bind:value={condition.value} aria-label="Value" placeholder="Value" disabled={!canChange} class="w-full" />
		{:else if opTakes(condition.op) === 'values'}
			<Textarea bind:value={condition.valuesText} rows={2} aria-label="Values" placeholder="One per line" disabled={!canChange} />
		{:else}
			<span></span>
		{/if}
		{#if canChange}
			<button type="button" class="pf-icon-btn pf-icon-danger" aria-label="Remove condition" onclick={() => removeCondition(rows, which, condition.uid)}>
				<Trash2 size={13} />
			</button>
		{:else}
			<span></span>
		{/if}
	</div>
	{@render problemList(attempted ? errorsUnder(problems, conditionAt) : [])}
{/snippet}

{#snippet rowRules(section: SectionForm, at: string)}
	<div class="field">
		<span class="field-label">Row rules</span>
		{#if !section.rows}
			<p class="field-hint" style="margin-top:0;">
				None: the AI reads this section. Add row rules to read its rows from the table's columns instead.
			</p>
			{#if canChange}
				<button type="button" class="detail-card-action pf-add-fee" onclick={() => (section.rows = newRows())}>
					<Plus size={13} /> Add row rules
				</button>
			{/if}
			{@render problemList(shown(`${at}.rows`))}
		{:else}
			{@const rows = section.rows}
			<div class="pf-rules">
				<p class="pf-rules-head">Take a row when every condition holds</p>
				{#if rows.where.length === 0}<p class="field-hint" style="margin-top:0;">No condition: every row of the table.</p>{/if}
				{@render conditionList(rows, 'where', `${at}.rows`, 'Add condition')}

				<p class="pf-rules-head">Mark a row to check when every condition holds</p>
				{@render conditionList(rows, 'flagWhen', `${at}.rows`, 'Add check condition')}
				{#if rows.flagWhen.length > 0 || rows.flagNote}
					<Input
						bind:value={rows.flagNote}
						aria-label="Note for a marked row"
						placeholder="What to check, e.g. Check that this withdrawal completed."
						disabled={!canChange}
						class="w-full"
					/>
					{@render problemList(shown(`${at}.rows.flagNote`))}
				{/if}

				{#if section.kind !== 'transfer'}
					<p class="pf-rules-head">Fee type column</p>
					<ProfileColumnSelect
						options={headingOptions}
						value={rows.feeTypeColumn}
						noneLabel="None"
						ariaLabel="Fee type column"
						disabled={!canChange}
						onchange={(value) => (rows.feeTypeColumn = value)}
					/>
					<p class="field-hint">
						Optional. With a column named, each fee type lists the values of it that mean that type, and a row of no listed type
						is left out.
					</p>
					{@render problemList(shown(`${at}.rows.feeTypeColumn`))}
				{/if}

				{#if canChange}
					<button type="button" class="detail-card-action pf-add-fee" onclick={() => (section.rows = null)}>Remove row rules</button>
				{/if}
			</div>
		{/if}
	</div>
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

	/* What the profile imports: two choices, each with a one-line hint. */
	.pf-modes {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: 8px;
	}
	.pf-mode {
		display: flex;
		align-items: flex-start;
		gap: 9px;
		padding: 8px 10px;
		border: 1px solid var(--border);
		border-radius: 8px;
		cursor: pointer;
		background: var(--card);
	}
	.pf-mode.on {
		border-color: var(--primary);
		background: var(--primary-soft);
	}
	.pf-mode input {
		margin-top: 3px;
		accent-color: var(--primary);
		flex-shrink: 0;
	}
	.pf-mode:has(input:disabled) {
		cursor: not-allowed;
		opacity: 0.7;
	}
	.pf-mode-main {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.pf-mode-label {
		font-size: 13px;
		font-weight: 500;
	}
	.pf-mode-hint {
		font-size: 11.5px;
		color: var(--muted-foreground);
	}
	.pf-legacy-mode {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 8px;
		margin-bottom: 14px;
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

	/* Table layout, row rules and preview */
	.pf-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: 0 12px;
	}
	.pf-fee-values {
		margin: -2px 0 2px;
	}
	.pf-rules {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 10px 12px;
		border: 1px dashed var(--border);
		border-radius: 8px;
	}
	.pf-rules-head {
		margin: 4px 0 0;
		font-size: 12px;
		font-weight: 500;
		color: var(--muted-foreground);
	}
	.pf-condition {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 0.8fr) minmax(0, 1.2fr) 28px;
		gap: 8px;
		align-items: start;
	}
	@media (max-width: 720px) {
		.pf-condition {
			grid-template-columns: minmax(0, 1fr);
			padding-bottom: 8px;
			border-bottom: 1px dashed var(--border);
		}
		.pf-condition > :last-child {
			justify-self: end;
		}
	}
	.pf-preview-pick {
		flex-wrap: wrap;
	}
	.pf-preview-pick input[type='file'] {
		font-size: 13px;
		max-width: 100%;
	}
	.pf-preview {
		margin-top: 12px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.pf-preview-line {
		margin: 0;
		font-size: 12.5px;
		overflow-wrap: anywhere;
	}
	.pf-preview-counts {
		margin: 0;
		padding-left: 18px;
		font-size: 12.5px;
	}
	.pf-preview-table {
		overflow-x: auto;
		border: 1px solid var(--border);
		border-radius: 8px;
	}
	.pf-preview-table table {
		width: 100%;
		border-collapse: collapse;
		font-size: 12px;
	}
	.pf-preview-table th,
	.pf-preview-table td {
		padding: 6px 8px;
		text-align: left;
		border-bottom: 1px solid var(--border);
		vertical-align: top;
		white-space: nowrap;
	}
	.pf-preview-table td:nth-child(5) {
		white-space: normal;
		min-width: 160px;
	}
	.pf-preview-table .num {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.pf-preview-note {
		display: block;
		color: var(--amber, var(--muted-foreground));
		font-size: 11.5px;
	}
	.pf-preview-error {
		background: var(--red-soft);
		color: var(--red);
		border-radius: 8px;
		padding: 8px 12px;
		margin-top: 10px;
		font-size: 12.5px;
	}
	.pf-preview-error p {
		margin: 0;
	}
	.pf-preview-error ul {
		margin: 6px 0 0;
		padding-left: 18px;
	}
</style>
