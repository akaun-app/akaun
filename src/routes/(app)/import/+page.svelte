<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { resolve } from '$app/paths';
	import { Upload, Clock, Receipt, Check, X, AlertTriangle, RotateCcw, Camera, ExternalLink } from '@lucide/svelte';
	import DatePicker from '$lib/components/ui/date-picker/DatePicker.svelte';
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
	import ContactSelect from '$lib/components/ui/ContactSelect.svelte';
	import ImportSourceAccountSelect from '$lib/components/import/ImportSourceAccountSelect.svelte';
	import ImportCategoryAccountSelect from '$lib/components/import/ImportCategoryAccountSelect.svelte';
	import AmountInput from '$lib/components/ui/AmountInput.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { useIsMobile } from '$lib/hooks/useIsMobile.svelte.js';
	import ScannerOverlay from '$lib/components/scanner/ScannerOverlay.svelte';
	import { loadOpenCv } from '$lib/scanner/cv';
	import { AccountType, Role, importStateEnum, documentTypeEnum } from '$lib/enums.js';
	import {
		defaultTargetForImportSource,
		importSourceIsIncome,
		syncImportAccountSelection,
		targetAccountsForImportSource,
	} from '$lib/import-account-groups.js';
	import { mainCurrency } from '$lib/currency-state.svelte.js';
	import { CURRENCIES, currencySymbol } from '$lib/currency.js';
	import type { PageData } from './$types.js';

	let { data }: { data: PageData } = $props();

	type JobState =
		| 'queued'
		| 'extracting'
		| 'processing'
		| 'pending_review'
		| 'confirmed'
		| 'imported'
		| 'skipped'
		| 'failed';

	type Candidate = { id: number; legalName: string; score?: number };

	type Job = {
		id: string;
		state: JobState;
		originalFilename: string;
		documentType: string | null;
		itemName: string | null;
		supplier: string | null;
		matchedContactId: number | null;
		matchCandidates: Candidate[];
		date: string | null;
		amount: number | null;
		currency: string | null;
		exchangeRate: number | null;
		reference: string | null;
		category: string | null;
		categoryAccountId: number | null;
		remark: string | null;
		// Which account paid for this / received it, as the worker pre-filled it.
		accountId: number | null;
		duplicateOf: number | null;
		duplicateConfidence: number | null;
		duplicateReasons: string[];
		error: string | null;
		// client-side tracking
		_edits?: Record<string, string | number>;
		// Set from the confirm reply when no category could be read off the document.
		_uncategorised?: boolean;
	};

	// Convert a raw DB queue row (INT enum codes) into a display Job (string labels).
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	function normalizeJob(j: any): Job {
		let candidates: Candidate[];
		try {
			candidates = j.matchCandidates ? JSON.parse(j.matchCandidates) : [];
		} catch {
			candidates = [];
		}
		let reasons: string[];
		try {
			reasons = j.duplicateReasons ? JSON.parse(j.duplicateReasons) : [];
		} catch {
			reasons = [];
		}
		return {
			id: j.id,
			state: (importStateEnum.toLabel(j.state) ?? 'queued') as JobState,
			originalFilename: j.originalFilename,
			documentType: documentTypeEnum.toLabel(j.documentType),
			itemName: j.itemName,
			supplier: j.supplier,
			matchedContactId: j.matchedContactId ?? null,
			matchCandidates: candidates,
			date: j.date,
			amount: j.amount,
			currency: j.currency ?? null,
			exchangeRate: j.exchangeRate ?? null,
			reference: j.reference,
			category: j.category,
			categoryAccountId: j.categoryAccountId ?? null,
			remark: j.remark,
			accountId: j.accountId ?? null,
			duplicateOf: j.duplicateOf,
			duplicateConfidence: j.duplicateConfidence ?? null,
			duplicateReasons: reasons,
			error: j.error,
			_edits: {},
		};
	}

	// Initialize from SSR data, converting DB rows to typed Job objects
	// svelte-ignore state_referenced_locally
	let jobs = $state<Job[]>(data.jobs.map(normalizeJob));

	// Source determines direction. Target is always the narrowed other side.
	// svelte-ignore state_referenced_locally
	let sourceAccountByJob = $state<Record<string, number | null>>(
		Object.fromEntries(data.jobs.map((j) => [j.id, initialSourceAccountId(j)])),
	);
	// svelte-ignore state_referenced_locally
	let targetAccountByJob = $state<Record<string, number | null>>(
		Object.fromEntries(data.jobs.map((j) => [j.id, initialTargetAccountId(j)])),
	);
	let sourceAccountTouched = $state<Record<string, boolean>>({});
	let targetAccountTouched = $state<Record<string, boolean>>({});

	function initialCategoryAccountId(job: {
		category?: string | null;
		categoryAccountId?: number | null;
		documentType?: number | string | null;
	}): number | null {
		if (
			job.categoryAccountId != null &&
			data.categoryAccounts.some((account) => account.id === job.categoryAccountId)
		) {
			return job.categoryAccountId;
		}
		const wanted = (job.category ?? '').trim().toLowerCase();
		if (!wanted) return null;
		const documentLabel =
			typeof job.documentType === 'string' ? job.documentType : documentTypeEnum.toLabel(job.documentType);
		const candidates = data.categoryAccounts.filter(
			(account) =>
				account.name.trim().toLowerCase() === wanted &&
				(documentLabel === 'income' ? account.type === AccountType.Revenue : account.type !== AccountType.Revenue),
		);
		return candidates[0]?.id ?? null;
	}

	function initialSourceAccountId(job: {
		accountId?: number | null;
		category?: string | null;
		categoryAccountId?: number | null;
		documentType?: number | string | null;
	}): number | null {
		const documentLabel =
			typeof job.documentType === 'string' ? job.documentType : documentTypeEnum.toLabel(job.documentType);
		return documentLabel === 'income'
			? (initialCategoryAccountId(job) ?? data.uncategorisedIncomeAccountId)
			: (data.payableAccountId ?? job.accountId ?? null);
	}

	function initialTargetAccountId(job: {
		accountId?: number | null;
		category?: string | null;
		categoryAccountId?: number | null;
		documentType?: number | string | null;
	}): number | null {
		const documentLabel =
			typeof job.documentType === 'string' ? job.documentType : documentTypeEnum.toLabel(job.documentType);
		if (documentLabel === 'income') return data.receivableAccountId ?? job.accountId ?? null;
		return initialCategoryAccountId(job) ?? data.uncategorisedAccountId;
	}

	// Store original file references for retry
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- File objects must stay outside $state.
	const fileStore = new Map<string, File>();

	// Why a job's import was refused, keyed by job id. Cleared when it goes through.
	let confirmErrors = $state<Record<string, string>>({});

	// Raw in-progress text for an amount field being typed into, keyed by job id.
	// Formatting (2 decimals) is only applied on blur — see amountDisplay()/onAmountBlur()
	// below — so reformatting mid-keystroke doesn't fight the user's cursor/input.
	let amountDrafts = $state<Record<string, string>>({});

	let drag = $state(false);
	let fileInput: HTMLInputElement | null = $state(null);
	let clearHistoryDialogOpen = $state(false);

	const screen = useIsMobile();
	const isMobile = $derived(screen.current);
	let showScanner = $state(false);
	let scanInitialDataUrl = $state('');
	let scanInputEl: HTMLInputElement | null = $state(null);

	// Trigger the OS camera directly from the FAB's own tap — a hidden input's
	// .click() only reliably opens the picker when called synchronously inside
	// a real user gesture, so this can't wait on opencv.js loading first.
	// Kick that load off now instead; it runs in the background while the user
	// is in the camera app, ready by the time EditView needs it.
	function openScanCamera() {
		loadOpenCv();
		scanInputEl?.click();
	}

	function handleScanFileSelected(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		const reader = new FileReader();
		reader.onload = () => {
			scanInitialDataUrl = reader.result as string;
			showScanner = true;
		};
		reader.readAsDataURL(file);
	}

	function handleScanFinish(file: File) {
		showScanner = false;
		uploadFiles([file]);
	}

	const PIPE_STATES = ['queued', 'extracting', 'processing'];
	const PIPE_FILL: Record<string, number> = {
		queued: 10,
		extracting: 45,
		processing: 78,
	};

	const pipeline = $derived(jobs.filter((j) => PIPE_STATES.includes(j.state)));
	const failed = $derived(jobs.filter((j) => j.state === 'failed'));
	const review = $derived(jobs.filter((j) => j.state === 'pending_review'));
	const history = $derived(jobs.filter((j) => ['confirmed', 'imported', 'skipped'].includes(j.state)));
	const confirmable = $derived(review.filter((j) => !j.duplicateOf && !jobAccountMissing(j)).length);
	let _es: EventSource | null = null;

	// onMount/onDestroy guarantee exactly one connection per page visit — no reactive re-runs
	onMount(() => {
		_es = new EventSource('/api/import/stream');

		_es.onmessage = (e) => {
			const msg = JSON.parse(e.data);
			if (msg.type === 'snapshot') {
				mergeServerJobs(msg.jobs);
			} else if (msg.type === 'job-update') {
				mergeServerJobs([msg.job]);
			} else if (msg.type === 'job-deleted') {
				jobs = jobs.filter((j) => j.id !== msg.jobId);
			}
		};
	});

	onDestroy(() => {
		_es?.close();
	});

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	function mergeServerJobs(incomingRaw: any[]) {
		const incoming = incomingRaw.map(normalizeJob);
		const byId = new Map(incoming.map((j) => [j.id, j]));
		const existingIds = new Set(jobs.map((j) => j.id));

		// Update existing jobs, preserve client-side _edits
		jobs = jobs.map((local) => {
			const server = byId.get(local.id);
			if (!server) return local;
			return {
				...server,
				_edits: local._edits ?? {},
				_uncategorised: local._uncategorised,
			};
		});

		// Prepend jobs added in another tab that we don't know about yet
		const brandNew = incoming.filter((j) => !existingIds.has(j.id));
		if (brandNew.length > 0) {
			jobs = [...brandNew, ...jobs];
		}

		// Live extraction may replace an automatic fallback. Only an actual reviewer
		// choice is protected from subsequent server updates.
		for (const j of incoming) {
			sourceAccountByJob[j.id] = syncImportAccountSelection(
				sourceAccountByJob[j.id],
				initialSourceAccountId(j),
				sourceAccountTouched[j.id] === true,
			);
			targetAccountByJob[j.id] = syncImportAccountSelection(
				targetAccountByJob[j.id],
				initialTargetAccountId(j),
				targetAccountTouched[j.id] === true,
			);
		}
	}

	// Set the contact intent (existing id, typed new name, or cleared) for a review row.
	function setContact(jobId: string, v: { value: number | null; newName: string | null }) {
		jobs = jobs.map((j) => {
			if (j.id !== jobId) return j;
			const edits = { ...(j._edits ?? {}) };
			delete edits.contactId;
			delete edits.newContactName;
			if (v.value != null) edits.contactId = v.value;
			else if (v.newName) edits.newContactName = v.newName;
			return { ...j, _edits: edits };
		});
	}

	async function uploadFiles(files: FileList | File[]) {
		for (const file of Array.from(files)) {
			const form = new FormData();
			form.append('file', file);
			try {
				const res = await fetch('/api/import', {
					method: 'POST',
					body: form,
					credentials: 'include',
				});
				if (!res.ok) {
					const err = await res.json().catch(() => ({ error: 'Upload failed' }));
					console.error('Upload error:', err.error);
					continue;
				}
				const { jobId } = await res.json();
				fileStore.set(jobId, file); // kept for Retry button on failed jobs
			} catch (err) {
				console.error('Upload failed:', err);
			}
		}
	}

	function handleDrop(e: DragEvent) {
		e.preventDefault();
		drag = false;
		if (e.dataTransfer?.files) uploadFiles(e.dataTransfer.files);
	}

	function handleFileInput(e: Event) {
		const input = e.target as HTMLInputElement;
		if (input.files) uploadFiles(input.files);
		input.value = '';
	}

	async function confirmJob(jobId: string) {
		const job = jobs.find((j) => j.id === jobId);
		if (!job) return;
		// A foreign-currency job can't be imported without a rate to convert it.
		if (jobRateMissing(job)) return;
		// A record has to say which account paid for it or received it.
		if (jobAccountMissing(job)) return;

		const isIncome = jobIsIncome(job);
		const fromAccountId = sourceAccountByJob[jobId];
		const toAccountId = targetAccountByJob[jobId];
		if (fromAccountId == null || toAccountId == null) return;
		const body = {
			...(job._edits ?? {}),
			fromAccountId,
			toAccountId,
		};
		const res = await fetch(`/api/import/${jobId}/confirm`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
			credentials: 'include',
		});
		if (!res.ok) {
			// A rule refused it and nothing was written — say why, on the card.
			const err = await res.json().catch(() => ({}));
			confirmErrors[jobId] = err.error ?? "That couldn't be imported. Try again.";
			return;
		}
		delete confirmErrors[jobId];

		const result = await res.json().catch(() => ({ uncategorised: false }));
		jobs = jobs.map((j) =>
			j.id === jobId
				? {
						...j,
						state: 'confirmed' as JobState,
						documentType: isIncome ? 'income' : 'expense',
						_uncategorised: !!result.uncategorised,
					}
				: j,
		);
		// Transition to imported after a moment (the server does it async)
		setTimeout(() => {
			jobs = jobs.map((j) => (j.id === jobId ? { ...j, state: 'imported' as JobState } : j));
		}, 800);
	}

	async function confirmAll() {
		const toConfirm = review.filter((j) => !j.duplicateOf && !jobAccountMissing(j));
		await Promise.all(toConfirm.map((j) => confirmJob(j.id)));
	}

	async function skipJob(jobId: string) {
		const res = await fetch(`/api/import/${jobId}/skip`, {
			method: 'POST',
			credentials: 'include',
		});
		if (res.ok) {
			jobs = jobs.map((j) => (j.id === jobId ? { ...j, state: 'skipped' as JobState } : j));
		}
	}

	async function retryJob(jobId: string) {
		const file = fileStore.get(jobId);
		if (!file) return;

		// Delete the old job
		await fetch(`/api/import/${jobId}`, {
			method: 'DELETE',
			credentials: 'include',
		});
		jobs = jobs.filter((j) => j.id !== jobId);

		// Re-upload
		await uploadFiles([file]);
	}

	async function discardJob(jobId: string) {
		await fetch(`/api/import/${jobId}`, {
			method: 'DELETE',
			credentials: 'include',
		});
		jobs = jobs.filter((j) => j.id !== jobId);
	}

	async function clearHistory() {
		await fetch('/api/import/history', {
			method: 'DELETE',
			credentials: 'include',
		});
		jobs = jobs.filter((j) => !['confirmed', 'imported', 'skipped'].includes(j.state));
		clearHistoryDialogOpen = false;
	}

	function updateEdit(jobId: string, key: string, value: string | number) {
		jobs = jobs.map((j) => {
			if (j.id !== jobId) return j;
			return { ...j, _edits: { ...(j._edits ?? {}), [key]: value } };
		});
	}

	function jobIsIncome(job: Job): boolean {
		const source = sourceAccountByJob[job.id];
		return source == null ? job.documentType === 'income' : importSourceIsIncome(data.allAccounts, source);
	}

	function setSourceAccount(jobId: string, value: number): void {
		const job = jobs.find((candidate) => candidate.id === jobId);
		const wasIncome = job ? jobIsIncome(job) : false;
		sourceAccountByJob[jobId] = value;
		sourceAccountTouched[jobId] = true;
		targetAccountTouched[jobId] = true;
		const isIncome = importSourceIsIncome(data.allAccounts, value);
		const targets = targetAccountsForJob(jobId);
		if (!targets.some((account) => account.id === targetAccountByJob[jobId])) {
			const defaultTarget = defaultTargetForImportSource(
				data.allAccounts,
				value,
				data.receivableAccountId,
				data.uncategorisedAccountId,
			);
			targetAccountByJob[jobId] = targets.some((account) => account.id === defaultTarget) ? defaultTarget : null;
		}
		if (job && isIncome !== wasIncome) {
			// Matches and suggestions were resolved using the LLM's original role.
			// Do not silently carry one across an Expense/Income correction.
			jobs = jobs.map((candidate) =>
				candidate.id === jobId ? { ...candidate, matchedContactId: null, matchCandidates: [] } : candidate,
			);
		}
	}

	function setTargetAccount(jobId: string, raw: string): void {
		const value = Number(raw);
		targetAccountByJob[jobId] = Number.isInteger(value) && value > 0 ? value : null;
		targetAccountTouched[jobId] = true;
	}

	function targetAccountsForJob(jobId: string) {
		return targetAccountsForImportSource(
			data.allAccounts,
			sourceAccountByJob[jobId],
			data.payableAccountId,
			data.receivableAccountId,
		);
	}

	function editedValue(job: Job, key: string): string | number {
		if (job._edits && key in job._edits) return job._edits[key];
		if (key === 'item_name') return job.itemName ?? '';
		if (key === 'supplier') return job.supplier ?? '';
		if (key === 'amount') return job.amount ?? 0;
		if (key === 'currency') return (job.currency ?? mainCurrency()).toUpperCase();
		if (key === 'exchangeRate') return job.exchangeRate ?? '';
		if (key === 'category') return job.category ?? '';
		if (key === 'date') return job.date ?? '';
		if (key === 'reference') return job.reference ?? '';
		if (key === 'remark') return job.remark ?? '';
		return '';
	}

	// Effective currency / rate for a job (edit override → extracted value → default).
	function jobCurrency(job: Job): string {
		return String(editedValue(job, 'currency') || mainCurrency()).toUpperCase();
	}
	function jobIsForeign(job: Job): boolean {
		return jobCurrency(job) !== mainCurrency();
	}
	function jobRateStr(job: Job): string {
		const v = editedValue(job, 'exchangeRate');
		return v === '' || v == null ? '' : String(v);
	}
	function jobRateMissing(job: Job): boolean {
		return jobIsForeign(job) && !(parseFloat(jobRateStr(job)) > 0);
	}
	function jobAccountMissing(job: Job): boolean {
		return sourceAccountByJob[job.id] == null || targetAccountByJob[job.id] == null;
	}
	function jobConverted(job: Job): number | null {
		const a = parseFloat(String(editedValue(job, 'amount')));
		const r = parseFloat(jobRateStr(job));
		if (!jobIsForeign(job) || isNaN(a) || isNaN(r) || r <= 0) return null;
		return a * r;
	}

	// Fetch a rate for a job's foreign currency + date, storing it as an edit override.
	async function fetchJobRate(jobId: string) {
		const job = jobs.find((j) => j.id === jobId);
		if (!job) return;
		const cur = jobCurrency(job);
		const date = String(editedValue(job, 'date'));
		if (cur === mainCurrency() || !date) return;
		try {
			const res = await fetch(`/api/exchange-rate?from=${cur}&to=${mainCurrency()}&date=${date}`);
			const json = await res.json();
			if (json.rate != null) updateEdit(jobId, 'exchangeRate', String(json.rate));
		} catch {
			// leave blank for manual entry
		}
	}

	function setJobCurrency(jobId: string, code: string) {
		updateEdit(jobId, 'currency', code);
		if (code === mainCurrency()) updateEdit(jobId, 'exchangeRate', '1');
		else fetchJobRate(jobId);
	}

	function isEdited(job: Job, key: string): boolean {
		return !!(job._edits && key in job._edits);
	}

	function editedCount(job: Job): number {
		return Object.keys(job._edits ?? {}).filter((k) => k !== 'document_type').length;
	}

	const DUP_REASON_LABELS: Record<string, string> = {
		file_hash: 'identical file',
		reference: 'reference',
		amount: 'amount',
		date: 'date',
		supplier: 'supplier',
		filename: 'filename',
		content: 'content',
	};

	function dupReasonsLabel(job: Job): string {
		return job.duplicateReasons.map((r) => DUP_REASON_LABELS[r] ?? r).join(' · ');
	}

	function dupMessage(job: Job): string {
		if (job.duplicateReasons.includes('file_hash')) return `This exact file was already imported.`;
		return `${job.duplicateConfidence}% match on ${dupReasonsLabel(job)} against an existing record.`;
	}

	function bucketPath(job: Job): string {
		if (!job.date) return '—';
		const [y, m] = job.date.split('-');
		const base = job.documentType === 'income' ? 'income' : 'expenses';
		return `${base}/${y}/${m}`;
	}

	function displayTitle(job: Job): string {
		return job.itemName || job.originalFilename;
	}

	function formatMoney(n: number | null): string {
		if (n == null) return '—';
		return new Intl.NumberFormat('en-US', {
			minimumFractionDigits: 2,
			maximumFractionDigits: 2,
		}).format(n);
	}

	// While the user is typing, show their raw text instead of the reformatted amount —
	// otherwise every keystroke gets rounded to 2dp and stomps the cursor mid-edit.
	function amountDisplay(job: Job): string {
		return amountDrafts[job.id] ?? formatMoney(editedValue(job, 'amount') as number);
	}

	function onAmountInput(jobId: string, e: Event) {
		const raw = (e.target as HTMLInputElement).value;
		amountDrafts = { ...amountDrafts, [jobId]: raw };
		const v = parseFloat(raw.replace(/,/g, ''));
		if (!isNaN(v)) updateEdit(jobId, 'amount', v);
	}

	function onAmountBlur(jobId: string) {
		const rest = { ...amountDrafts };
		delete rest[jobId];
		amountDrafts = rest;
	}
</script>

<svelte:head>
	<title>Auto Import - Akaun</title>
</svelte:head>

<div class="screen">
	<header class="topbar">
		<div class="topbar-left">
			<h1 class="page-title">Auto Import</h1>
			<p class="page-sub">
				Drop receipts &amp; invoices — text is extracted, then AI classifies each as income or expense and fills the
				fields
			</p>
		</div>
		<div class="topbar-right">
			{#if pipeline.length > 0}
				<span class="proc-pill">
					<span class="dot-pulse"></span>
					{pipeline.length} in pipeline · live
				</span>
			{/if}
		</div>
	</header>

	<div class="dash-scroll">
		<!-- Drop zone -->
		<div
			class="dropzone"
			class:drag
			role="button"
			tabindex="0"
			ondragover={(e) => {
				e.preventDefault();
				drag = true;
			}}
			ondragleave={() => (drag = false)}
			ondrop={handleDrop}
			onclick={() => fileInput?.click()}
			onkeydown={(e) => e.key === 'Enter' && fileInput?.click()}
		>
			<div class="dropzone-icon"><Upload size={26} /></div>
			<div class="dropzone-title">Drop files here, or <u>browse</u></div>
			<div class="dropzone-sub">
				PDF, JPG, PNG · scanned files run through OCR · income &amp; expenses detected automatically
			</div>
		</div>
		<input
			bind:this={fileInput}
			type="file"
			accept=".pdf,.jpg,.jpeg,.png"
			multiple
			style="display:none"
			onchange={handleFileInput}
		/>

		<!-- Pipeline -->
		{#if pipeline.length > 0}
			<div class="import-section">
				<div class="import-section-head between">
					<span class="ish-left">
						<span class="dot-pulse"></span>
						Processing queue
						<span class="hbadge">{pipeline.length}</span>
					</span>
					<span class="cap-note">{pipeline.filter((j) => j.state !== 'queued').length}/3 workers active</span>
				</div>
				<div class="pipe-list">
					{#each pipeline as job (job.id)}
						<div class="pipe-row" class:queued={job.state === 'queued'}>
							<div class="pipe-icon">
								{#if job.state === 'queued'}
									<Clock size={15} />
								{:else}
									<Receipt size={15} />
								{/if}
							</div>
							<div class="pipe-main">
								<div class="pipe-toprow">
									<span class="pipe-name">{job.originalFilename}</span>
									<span class="pipe-type">
										{job.originalFilename.toLowerCase().endsWith('.pdf') ? 'PDF' : 'Image · OCR'}
									</span>
								</div>
								<div class="pipe-track">
									<div class="pipe-fill" style="width:{PIPE_FILL[job.state] ?? 10}%"></div>
								</div>
							</div>
							<div class="pipe-state" class:is-queued={job.state === 'queued'}>
								{#if job.state === 'queued'}
									<Clock size={13} /> Queued
								{:else if job.state === 'extracting'}
									<span class="spinner sm"></span> Extracting text…
								{:else}
									<span class="spinner sm"></span> Reading with AI…
								{/if}
							</div>
						</div>
					{/each}
				</div>
			</div>
		{/if}

		<!-- Failed -->
		{#if failed.length > 0}
			<div class="import-section">
				<div class="import-section-head">
					Failed <span class="hbadge">{failed.length}</span>
				</div>
				<div class="pipe-list">
					{#each failed as job (job.id)}
						<div class="fail-card">
							<div class="fail-icon"><AlertTriangle size={16} /></div>
							<div class="fail-main">
								<div class="fail-name">{job.originalFilename}</div>
								<div class="fail-msg">{job.error ?? 'Unknown error'}</div>
							</div>
							<div class="fail-actions">
								{#if fileStore.has(job.id)}
									<Button variant="outline" size="sm" onclick={() => retryJob(job.id)}>
										<RotateCcw size={14} /> Retry
									</Button>
								{/if}
								<Button variant="ghost" size="sm" onclick={() => discardJob(job.id)}>Discard</Button>
							</div>
						</div>
					{/each}
				</div>
			</div>
		{/if}

		<!-- Review -->
		<div class="import-section">
			<div class="import-section-head between">
				<span>Ready to review <span class="hbadge">{review.length}</span></span>
				{#if confirmable > 0}
					<Button size="sm" onclick={confirmAll}>
						<Check size={15} /> Confirm all ({confirmable})
					</Button>
				{/if}
			</div>
			{#if review.length === 0}
				<div class="import-empty">No items awaiting review. Drop a file above to start.</div>
			{:else}
				<div class="review-list">
					{#each review as job (job.id)}
						{@const isIncome = jobIsIncome(job)}
						{@const dup = !!job.duplicateOf}
						{@const numEdits = editedCount(job)}
						<div class="review-card" class:is-dup={dup}>
							<!-- Header -->
							<div class="review-head">
								<a
									href={resolve('/api/import/[jobId]/file', { jobId: job.id })}
									target="_blank"
									rel="noopener"
									class="review-file"
									aria-label="Open {job.originalFilename}"
								>
									<Receipt size={15} />
									{job.originalFilename}
									<ExternalLink size={11} color="var(--muted-foreground)" />
								</a>
								<div class="review-head-right">
									{#if dup}
										<span class="dup-badge">
											<AlertTriangle size={11} /> Duplicate · {job.duplicateConfidence}% · {dupReasonsLabel(job)}
										</span>
									{/if}
								</div>
							</div>

							<div class="review-detected">
								<Upload size={12} />
								AI classified this as {isIncome ? 'income' : 'an expense'} — change the category or edit any field before
								importing
							</div>

							<!-- Fields grid -->
							<div class="review-grid">
								<!-- Description -->
								<div class="rfield">
									<span class="rfield-label">
										Description
										{#if isEdited(job, 'item_name')}<span class="edited-tag">edited</span>{/if}
									</span>
									<input
										class="form-input rinput"
										value={editedValue(job, 'item_name')}
										oninput={(e) => updateEdit(job.id, 'item_name', (e.target as HTMLInputElement).value)}
									/>
								</div>

								<!-- Contact (role follows the chosen category) -->
								<div class="rfield">
									<span class="rfield-label">
										Contact
										{#if isEdited(job, 'contactId') || isEdited(job, 'newContactName')}<span class="edited-tag"
												>edited</span
											>{/if}
									</span>
									<ContactSelect
										role={isIncome ? Role.Customer : Role.Supplier}
										initialLabel={job.supplier}
										suggestions={job.matchCandidates}
										onChange={(v) => setContact(job.id, v)}
									/>
								</div>

								<!-- Amount (main currency; read-only & converted when foreign) -->
								<div class="rfield">
									<span class="rfield-label">
										Amount{jobIsForeign(job) ? ` (${mainCurrency()})` : ''}
										{#if !jobIsForeign(job) && isEdited(job, 'amount')}<span class="edited-tag">edited</span>{/if}
									</span>
									{#if jobIsForeign(job)}
										<AmountInput
											wrapperClass="sm"
											readonly
											value={jobConverted(job) != null ? formatMoney(jobConverted(job)) : ''}
										/>
									{:else}
										<AmountInput
											wrapperClass="sm"
											value={amountDisplay(job)}
											oninput={(e) => onAmountInput(job.id, e)}
											onblur={() => onAmountBlur(job.id)}
										/>
									{/if}
								</div>

								<!-- Currency + exchange rate (auto-shown when a foreign currency is detected) -->
								<div class="rfield">
									<span class="rfield-label">Currency</span>
									<Select.Root type="single" value={jobCurrency(job)} onValueChange={(v) => setJobCurrency(job.id, v)}>
										<Select.Trigger class="rinput w-full">{jobCurrency(job)}</Select.Trigger>
										<Select.Content>
											{#each CURRENCIES as c (c.code)}
												<Select.Item value={c.code} label={`${c.code} — ${c.name}`} />
											{/each}
										</Select.Content>
									</Select.Root>
								</div>
								{#if jobIsForeign(job)}
									<div class="rfield">
										<span class="rfield-label">
											Amount ({jobCurrency(job)})
											{#if isEdited(job, 'amount')}<span class="edited-tag">edited</span>{/if}
										</span>
										<AmountInput
											wrapperClass="sm"
											prefix={currencySymbol(jobCurrency(job))}
											value={amountDisplay(job)}
											oninput={(e) => onAmountInput(job.id, e)}
											onblur={() => onAmountBlur(job.id)}
										/>
									</div>
									<div class="rfield">
										<span class="rfield-label">Rate (1 {jobCurrency(job)} = ? {mainCurrency()})</span>
										<input
											class="form-input rinput"
											inputmode="decimal"
											placeholder="0.0000"
											value={jobRateStr(job)}
											oninput={(e) => updateEdit(job.id, 'exchangeRate', (e.target as HTMLInputElement).value)}
										/>
										{#if jobConverted(job) == null}
											<span class="foreign-note">Enter the rate manually to convert to {mainCurrency()}.</span>
										{/if}
									</div>
								{/if}

								<!-- Source establishes direction; Target is then narrowed by policy. -->
								<div class="rfield">
									<span class="rfield-label">Source account</span>
									<ImportSourceAccountSelect
										accounts={data.allAccounts}
										payableAccountId={data.payableAccountId}
										value={sourceAccountByJob[job.id]}
										incomeFirst={isIncome}
										onChange={(value) => setSourceAccount(job.id, value)}
									/>
								</div>

								<div class="rfield">
									<span class="rfield-label">
										Target account
										{#if isEdited(job, 'category')}<span class="edited-tag">edited</span>{/if}
									</span>
									<ImportCategoryAccountSelect
										accounts={targetAccountsForJob(job.id)}
										value={targetAccountByJob[job.id]}
										onChange={(value) => setTargetAccount(job.id, value)}
									/>
								</div>

								<!-- Date -->
								<div class="rfield">
									<span class="rfield-label">
										Date
										{#if isEdited(job, 'date')}<span class="edited-tag">edited</span>{/if}
									</span>
									<DatePicker
										value={editedValue(job, 'date') as string}
										onchange={(v) => updateEdit(job.id, 'date', v)}
									/>
								</div>

								<!-- Reference -->
								<div class="rfield">
									<span class="rfield-label">
										Reference
										{#if isEdited(job, 'reference')}<span class="edited-tag">edited</span>{/if}
									</span>
									<input
										class="form-input rinput"
										placeholder="—"
										value={editedValue(job, 'reference')}
										oninput={(e) => updateEdit(job.id, 'reference', (e.target as HTMLInputElement).value)}
									/>
								</div>
							</div>

							{#if dup}
								<div class="dup-note">
									{dupMessage(job)} Import only if this is a separate transaction.
								</div>
							{/if}

							<div class="review-actions">
								<span class="merge-note">
									{#if confirmErrors[job.id]}
										{confirmErrors[job.id]}
									{:else if jobAccountMissing(job)}
										Choose both the source and target account before importing it.
									{:else if !isIncome && sourceAccountByJob[job.id] === data.payableAccountId}
										Marked as paid personally — owed to the contact above until reimbursed.
									{:else if numEdits > 0}
										{numEdits} field{numEdits > 1 ? 's' : ''} edited — only these override the AI values
									{:else}
										Importing AI values as-is
									{/if}
								</span>
								<div class="review-actions-btns">
									<Button variant="ghost" size="sm" onclick={() => skipJob(job.id)}>Skip</Button>
									<Button
										size="sm"
										disabled={jobRateMissing(job) || jobAccountMissing(job)}
										onclick={() => confirmJob(job.id)}
									>
										<Check size={15} />
										{dup ? 'Import anyway' : 'Confirm & import'}
									</Button>
								</div>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<!-- History (this session) -->
		{#if history.length > 0}
			<div class="import-section">
				<div class="import-section-head between">
					<span>This session <span class="hbadge">{history.length}</span></span>
					<Button variant="ghost" size="sm" onclick={() => (clearHistoryDialogOpen = true)}>Clear history</Button>
				</div>
				<div class="proc-list">
					{#each history as job (job.id)}
						{#if job.state === 'skipped'}
							<div class="proc-row skip">
								<div class="proc-file">
									<span class="skip-check"><X size={11} /></span>
									<span>{displayTitle(job)}</span>
								</div>
								<span class="proc-type">Skipped{job.duplicateOf ? ' · duplicate' : ''}</span>
								<span class="skip-amt"
									>{currencySymbol(job.currency)}
									{formatMoney(job.amount)}</span
								>
							</div>
						{:else}
							{@const importing = job.state === 'confirmed'}
							<div class="proc-row done" class:importing>
								<div class="proc-file">
									{#if importing}
										<span class="spinner sm"></span>
									{:else}
										<span class="ok-check"><Check size={11} strokeWidth={3} /></span>
									{/if}
									<span>{displayTitle(job)}</span>
									<span
										class="type-chip"
										class:income={job.documentType === 'income'}
										class:expense={job.documentType !== 'income'}
									>
										{job.documentType === 'income' ? 'Income' : 'Expense'}
									</span>
								</div>
								<span class="bucket-path"
									>{importing
										? 'Importing…'
										: job._uncategorised
											? `→ ${bucketPath(job)} · filed as Uncategorised`
											: '→ ' + bucketPath(job)}</span
								>
								<span class="imported-amt"
									>{currencySymbol(job.currency)}
									{formatMoney(job.amount)}</span
								>
							</div>
						{/if}
					{/each}
				</div>
			</div>
		{/if}
	</div>
</div>

<ConfirmDialog
	bind:open={clearHistoryDialogOpen}
	title="Clear import history?"
	description="Removes every skipped, confirmed and imported entry from this list. Records already brought into the ledger are not affected — this only clears the log."
	confirmLabel="Clear history"
	danger
	onConfirm={clearHistory}
/>

{#if isMobile}
	<button type="button" class="scan-fab" onclick={openScanCamera} aria-label="Scan a document">
		<Camera size={20} />
		<span>Scan</span>
	</button>
	<input
		bind:this={scanInputEl}
		type="file"
		accept="image/*"
		capture="environment"
		style="display:none"
		onchange={handleScanFileSelected}
	/>
{/if}

{#if showScanner}
	<ScannerOverlay
		initialDataUrl={scanInitialDataUrl}
		onclose={() => (showScanner = false)}
		onfinish={handleScanFinish}
	/>
{/if}

<style>
	/* AccountSelect brings its own .field markup — line it up with the review grid's
	   own fields so the account reads as one more field, not a transplant. */
	.review-grid :global(.field) {
		display: flex;
		flex-direction: column;
		gap: 5px;
		margin-bottom: 0;
	}
	.review-grid :global(.field-label) {
		font-size: 11.5px;
		color: var(--muted-foreground);
		font-weight: 500;
		margin-bottom: 0;
	}
	.review-grid :global(.account-select) {
		height: 34px;
	}

	.scan-fab {
		position: fixed;
		right: 16px;
		bottom: calc(56px + var(--safe-bottom) + 16px);
		z-index: 60;
		display: flex;
		height: 48px;
		gap: 8px;
		padding: 0 18px 0 16px;
		align-items: center;
		justify-content: center;
		border-radius: 999px;
		background: var(--primary);
		color: var(--primary-foreground);
		font-size: 14px;
		font-weight: 600;
		letter-spacing: -0.01em;
		box-shadow: var(--shadow-lg);
		transition:
			transform 0.15s,
			background-color 0.15s;
	}

	@media (hover: hover) {
		.scan-fab:hover {
			background: color-mix(in oklch, var(--primary) 94%, white);
		}
	}

	.scan-fab:active {
		transform: scale(0.96);
	}
</style>
