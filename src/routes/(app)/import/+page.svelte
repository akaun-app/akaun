<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import {
		Upload,
		Clock,
		Receipt,
		Check,
		X,
		AlertTriangle,
		RotateCcw
	} from '@lucide/svelte';
	import DatePicker from '$lib/components/ui/date-picker/DatePicker.svelte';
	import ContactSelect from '$lib/components/ui/ContactSelect.svelte';
	import AmountInput from '$lib/components/ui/AmountInput.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Role, importStateEnum, documentTypeEnum, duplicateSignalEnum } from '$lib/enums.js';
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
		reference: string | null;
		category: string | null;
		remark: string | null;
		duplicateOf: number | null;
		duplicateSignal: string | null;
		error: string | null;
		// client-side tracking
		_edits?: Record<string, string | number>;
	};

	// Convert a raw DB queue row (INT enum codes) into a display Job (string labels).
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	function normalizeJob(j: any): Job {
		let candidates: Candidate[] = [];
		try {
			candidates = j.matchCandidates ? JSON.parse(j.matchCandidates) : [];
		} catch {
			candidates = [];
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
			reference: j.reference,
			category: j.category,
			remark: j.remark,
			duplicateOf: j.duplicateOf,
			duplicateSignal: duplicateSignalEnum.toLabel(j.duplicateSignal),
			error: j.error,
			_edits: {}
		};
	}

	// Initialize from SSR data, converting DB rows to typed Job objects
	// svelte-ignore state_referenced_locally
	let jobs = $state<Job[]>(data.jobs.map(normalizeJob));

	// Store original file references for retry
	const fileStore = new Map<string, File>();

	let drag = $state(false);
	let fileInput: HTMLInputElement | null = $state(null);

	const PIPE_STATES = ['queued', 'extracting', 'processing'];
	const PIPE_FILL: Record<string, number> = { queued: 10, extracting: 45, processing: 78 };

	const pipeline = $derived(jobs.filter((j) => PIPE_STATES.includes(j.state)));
	const failed = $derived(jobs.filter((j) => j.state === 'failed'));
	const review = $derived(jobs.filter((j) => j.state === 'pending_review'));
	const history = $derived(
		jobs.filter((j) => ['confirmed', 'imported', 'skipped'].includes(j.state))
	);
	const confirmable = $derived(review.filter((j) => !j.duplicateSignal).length);
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
			return { ...server, _edits: local._edits ?? {} };
		});

		// Prepend jobs added in another tab that we don't know about yet
		const brandNew = incoming.filter((j) => !existingIds.has(j.id));
		if (brandNew.length > 0) {
			jobs = [...brandNew, ...jobs];
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
					credentials: 'include'
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

		const overrides = job._edits && Object.keys(job._edits).length > 0 ? job._edits : undefined;
		const res = await fetch(`/api/import/${jobId}/confirm`, {
			method: 'POST',
			headers: overrides ? { 'Content-Type': 'application/json' } : {},
			body: overrides ? JSON.stringify(overrides) : undefined,
			credentials: 'include'
		});
		if (res.ok) {
			jobs = jobs.map((j) => (j.id === jobId ? { ...j, state: 'confirmed' as JobState } : j));
			// Transition to imported after a moment (the server does it async)
			setTimeout(() => {
				jobs = jobs.map((j) => (j.id === jobId ? { ...j, state: 'imported' as JobState } : j));
			}, 800);
		}
	}

	async function confirmAll() {
		const toConfirm = review.filter((j) => !j.duplicateSignal);
		await Promise.all(toConfirm.map((j) => confirmJob(j.id)));
	}

	async function skipJob(jobId: string) {
		const res = await fetch(`/api/import/${jobId}/skip`, {
			method: 'POST',
			credentials: 'include'
		});
		if (res.ok) {
			jobs = jobs.map((j) => (j.id === jobId ? { ...j, state: 'skipped' as JobState } : j));
		}
	}

	async function retryJob(jobId: string) {
		const file = fileStore.get(jobId);
		if (!file) return;

		// Delete the old job
		await fetch(`/api/import/${jobId}`, { method: 'DELETE', credentials: 'include' });
		jobs = jobs.filter((j) => j.id !== jobId);

		// Re-upload
		await uploadFiles([file]);
	}

	async function discardJob(jobId: string) {
		await fetch(`/api/import/${jobId}`, { method: 'DELETE', credentials: 'include' });
		jobs = jobs.filter((j) => j.id !== jobId);
	}

	function updateEdit(jobId: string, key: string, value: string | number) {
		jobs = jobs.map((j) => {
			if (j.id !== jobId) return j;
			return { ...j, _edits: { ...(j._edits ?? {}), [key]: value } };
		});
	}

	function setDocType(jobId: string, docType: string) {
		jobs = jobs.map((j) => {
			if (j.id !== jobId) return j;
			return { ...j, documentType: docType, _edits: { ...(j._edits ?? {}), document_type: docType } };
		});
	}

	function editedValue(job: Job, key: string): string | number {
		if (job._edits && key in job._edits) return job._edits[key];
		if (key === 'item_name') return job.itemName ?? '';
		if (key === 'supplier') return job.supplier ?? '';
		if (key === 'amount') return job.amount ?? 0;
		if (key === 'category') return job.category ?? '';
		if (key === 'date') return job.date ?? '';
		if (key === 'reference') return job.reference ?? '';
		if (key === 'remark') return job.remark ?? '';
		return '';
	}

	function isEdited(job: Job, key: string): boolean {
		return !!(job._edits && key in job._edits);
	}

	function editedCount(job: Job): number {
		return Object.keys(job._edits ?? {}).filter((k) => k !== 'document_type').length;
	}

	function dupSignalLabel(sig: string | null): string {
		if (sig === 'filename') return 'filename';
		if (sig === 'reference') return 'reference match';
		return 'supplier · amount · date';
	}

	function dupMessage(job: Job): string {
		if (job.duplicateSignal === 'filename')
			return `A file named "${job.originalFilename}" was already imported.`;
		if (job.duplicateSignal === 'reference')
			return `Reference ${job.reference} matches an existing record.`;
		return `Same supplier, amount & date as an existing record.`;
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
		return new Intl.NumberFormat('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
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
				Drop receipts &amp; invoices — text is extracted, then AI classifies each as income or expense and fills the fields
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
			ondragover={(e) => { e.preventDefault(); drag = true; }}
			ondragleave={() => (drag = false)}
			ondrop={handleDrop}
			onclick={() => fileInput?.click()}
			onkeydown={(e) => e.key === 'Enter' && fileInput?.click()}
		>
			<div class="dropzone-icon"><Upload size={26} /></div>
			<div class="dropzone-title">Drop files here, or <u>browse</u></div>
			<div class="dropzone-sub">PDF, JPG, PNG · scanned files run through OCR · income &amp; expenses detected automatically</div>
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
						{@const isIncome = job.documentType === 'income'}
						{@const dup = !!job.duplicateSignal}
						{@const numEdits = editedCount(job)}
						<div class="review-card" class:is-dup={dup}>
							<!-- Header -->
							<div class="review-head">
								<div class="review-file"><Receipt size={15} /> {job.originalFilename}</div>
								<div class="review-head-right">
									{#if dup}
										<span class="dup-badge">
											<AlertTriangle size={11} /> Duplicate · {dupSignalLabel(job.duplicateSignal)}
										</span>
									{/if}
									<div class="seg sm type-seg">
										<button
											class="seg-btn"
											class:active={!isIncome}
											onclick={() => setDocType(job.id, 'expense')}
										>Expense</button>
										<button
											class="seg-btn"
											class:active={isIncome}
											onclick={() => setDocType(job.id, 'income')}
										>Income</button>
									</div>
								</div>
							</div>

							<div class="review-detected">
								<Upload size={12} />
								AI classified this as {isIncome ? 'income' : 'an expense'} — switch the type or edit any field before importing
							</div>

							<!-- Fields grid -->
							<div class="review-grid">
								<!-- Item (expense) / Customer combobox (income) -->
								<div class="rfield">
									<span class="rfield-label">
										{isIncome ? 'Customer' : 'Item'}
										{#if !isIncome && isEdited(job, 'item_name')}<span class="edited-tag">edited</span>{/if}
										{#if isIncome && (isEdited(job, 'contactId') || isEdited(job, 'newContactName'))}<span class="edited-tag">edited</span>{/if}
									</span>
									{#if isIncome}
										<ContactSelect
											role={Role.Customer}
											initialLabel={job.itemName}
											suggestions={job.matchCandidates}
											onChange={(v) => setContact(job.id, v)}
										/>
									{:else}
										<input
											class="form-input rinput"
											value={editedValue(job, 'item_name')}
											oninput={(e) => updateEdit(job.id, 'item_name', (e.target as HTMLInputElement).value)}
										/>
									{/if}
								</div>

								<!-- Supplier combobox (expense) / Description (income) -->
								<div class="rfield">
									<span class="rfield-label">
										{isIncome ? 'Description' : 'Supplier'}
										{#if isIncome && isEdited(job, 'supplier')}<span class="edited-tag">edited</span>{/if}
										{#if !isIncome && (isEdited(job, 'contactId') || isEdited(job, 'newContactName'))}<span class="edited-tag">edited</span>{/if}
									</span>
									{#if isIncome}
										<input
											class="form-input rinput"
											value={editedValue(job, 'supplier')}
											oninput={(e) => updateEdit(job.id, 'supplier', (e.target as HTMLInputElement).value)}
										/>
									{:else}
										<ContactSelect
											role={Role.Supplier}
											initialLabel={job.supplier}
											suggestions={job.matchCandidates}
											onChange={(v) => setContact(job.id, v)}
										/>
									{/if}
								</div>

								<!-- Amount -->
								<div class="rfield">
									<span class="rfield-label">
										Amount
										{#if isEdited(job, 'amount')}<span class="edited-tag">edited</span>{/if}
									</span>
									<AmountInput
										wrapperClass="sm"
										value={formatMoney(editedValue(job, 'amount') as number)}
										oninput={(e) => {
											const v = parseFloat((e.target as HTMLInputElement).value.replace(/,/g, ''));
											if (!isNaN(v)) updateEdit(job.id, 'amount', v);
										}}
									/>
								</div>

								<!-- Category -->
								<div class="rfield">
									<span class="rfield-label">
										Category
										{#if isEdited(job, 'category')}<span class="edited-tag">edited</span>{/if}
									</span>
									<Select.Root
										type="single"
										value={String(editedValue(job, 'category'))}
										onValueChange={(v) => updateEdit(job.id, 'category', v)}
									>
										<Select.Trigger class="rinput w-full">
											{editedValue(job, 'category') || 'Select category'}
										</Select.Trigger>
										<Select.Content>
											{#each (isIncome ? data.incomeCategories : data.expenseCategories) as cat}
												<Select.Item value={cat} label={cat} />
											{/each}
										</Select.Content>
									</Select.Root>
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
								<div class="dup-note">{dupMessage(job)} Import only if this is a separate transaction.</div>
							{/if}

							<div class="review-actions">
								<span class="merge-note">
									{#if numEdits > 0}
										{numEdits} field{numEdits > 1 ? 's' : ''} edited — only these override the AI values
									{:else}
										Importing AI values as-is
									{/if}
								</span>
								<div class="review-actions-btns">
									<Button variant="ghost" size="sm" onclick={() => skipJob(job.id)}>Skip</Button>
									<Button size="sm" onclick={() => confirmJob(job.id)}>
										<Check size={15} /> {dup ? 'Import anyway' : 'Confirm & import'}
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
				<div class="import-section-head">
					This session <span class="hbadge">{history.length}</span>
				</div>
				<div class="proc-list">
					{#each history as job (job.id)}
						{#if job.state === 'skipped'}
							<div class="proc-row skip">
								<div class="proc-file">
									<span class="skip-check"><X size={11} /></span>
									<span>{displayTitle(job)}</span>
								</div>
								<span class="proc-type">Skipped{job.duplicateSignal ? ' · duplicate' : ''}</span>
								<span class="skip-amt">RM {formatMoney(job.amount)}</span>
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
									<span class="type-chip" class:income={job.documentType === 'income'} class:expense={job.documentType !== 'income'}>
										{job.documentType === 'income' ? 'Income' : 'Expense'}
									</span>
								</div>
								<span class="bucket-path">{importing ? 'Importing…' : '→ ' + bucketPath(job)}</span>
								<span class="imported-amt">RM {formatMoney(job.amount)}</span>
							</div>
						{/if}
					{/each}
				</div>
			</div>
		{/if}
	</div>
</div>
