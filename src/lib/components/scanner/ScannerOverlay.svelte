<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { X } from '@lucide/svelte';
	import EditView from './EditView.svelte';
	import { loadOpenCv } from '$lib/scanner/cv';
	import type { Phase } from '$lib/scanner/types';
	import type { FinishedPage } from './page-types';

	interface Props {
		initialDataUrl: string;
		onclose: () => void;
		onfinish: (file: File) => void;
	}

	const { initialDataUrl, onclose, onfinish }: Props = $props();

	let phase = $state<Phase | 'error'>('loading');
	let statusText = $state('Loading scanner...');
	let errorText = $state('');
	// svelte-ignore state_referenced_locally
	let capturedDataUrl = $state<string | null>(initialDataUrl);
	let assembling = $state(false);
	let cameraInputEl = $state<HTMLInputElement>();
	// True while EditView is in its adjust sub-view, which has its own
	// Cancel/Reset/Apply bar — hide the overlay's top bar to avoid a redundant Cancel.
	let adjusting = $state(false);

	const phaseTitle = $derived(
		assembling
			? 'Preparing'
			: phase === 'scanned'
				? 'Review scan'
				: phase === 'error'
					? 'Scanner'
					: 'Scanning'
	);

	// The first photo already came from the FAB's own camera trigger (see
	// import/+page.svelte) by the time this mounts — opencv.js was kicked off
	// then too, so this is usually an instant resolve, not a second wait/tap.
	// loadOpenCv() caches a single load across every open/close of this
	// overlay, since the script's readiness can only be detected once.
	onMount(() => loadScripts());

	async function loadScripts() {
		try {
			await loadOpenCv();
			phase = 'scanned';
		} catch {
			phase = 'error';
			errorText = 'Could not load the scanner. Check your connection and try again.';
		}
	}

	// Re-opens the OS camera straight from the Retake tap. The file input's
	// `.click()` only opens the picker when called synchronously inside a user
	// gesture, so this must stay a direct, await-free call from the handler.
	function retake() {
		cameraInputEl?.click();
	}

	function handleFileSelected(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		input.value = ''; // allow retaking and picking the same file again
		if (!file) return;
		const reader = new FileReader();
		reader.onload = () => {
			capturedDataUrl = reader.result as string;
			phase = 'scanned';
		};
		reader.readAsDataURL(file);
	}

	async function handleDone(page: FinishedPage) {
		assembling = true;
		try {
			const { assemblePdf } = await import('./pdf-assembly');
			const file = await assemblePdf(page);
			onfinish(file);
		} finally {
			assembling = false;
		}
	}
</script>

<div class="scanner-overlay">
	{#if !adjusting}
		<div class="scanner-topbar">
			<button type="button" class="scanner-cancel" onclick={onclose} aria-label="Cancel scanning">
				<X size={18} />
				<span>Cancel</span>
			</button>
			<p class="scanner-title">{phaseTitle}</p>
			<div aria-hidden="true"></div>
		</div>
	{/if}

	{#if phase === 'loading' || assembling}
		<div class="scanner-status">
			<div class="scanner-spinner"></div>
			<p class="scanner-status-text">
				{assembling ? 'Preparing document...' : statusText}
			</p>
		</div>
	{:else if phase === 'error'}
		<div class="scanner-status">
			<p class="scanner-error-text">{errorText}</p>
			<Button onclick={onclose}>Close</Button>
		</div>
	{:else if phase === 'scanned' && capturedDataUrl}
		{#key capturedDataUrl}
			<EditView
				dataUrl={capturedDataUrl}
				onretake={retake}
				ondone={handleDone}
				onadjustchange={(v) => (adjusting = v)}
			/>
		{/key}
	{/if}

	<!-- Always mounted so Retake can trigger it synchronously from a user gesture. -->
	<input
		bind:this={cameraInputEl}
		type="file"
		accept="image/*"
		capture="environment"
		class="hidden"
		onchange={handleFileSelected}
	/>
</div>

<style>
	.scanner-overlay {
		position: fixed;
		inset: 0;
		z-index: 100;
		display: flex;
		flex-direction: column;
		/* Follows the app's light/dark theme via mode-watcher's .dark on <html>. */
		background: var(--background);
		color: var(--foreground);
		padding-top: var(--safe-top);
	}

	.scanner-topbar {
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: center;
		flex-shrink: 0;
		height: 52px;
		padding: 0 8px;
	}

	.scanner-cancel {
		justify-self: start;
		display: inline-flex;
		align-items: center;
		gap: 5px;
		height: 36px;
		padding: 0 12px 0 8px;
		border-radius: 999px;
		font-size: 14px;
		font-weight: 500;
		color: var(--foreground);
		transition:
			background-color 0.15s,
			transform 0.15s;
	}

	@media (hover: hover) {
		.scanner-cancel:hover {
			background: var(--accent);
		}
	}

	.scanner-cancel:active {
		transform: scale(0.96);
	}

	.scanner-title {
		font-size: 14px;
		font-weight: 600;
		letter-spacing: -0.01em;
		color: var(--foreground);
	}

	.scanner-status {
		display: flex;
		flex: 1;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 16px;
		padding: 0 24px;
		text-align: center;
	}

	.scanner-spinner {
		width: 32px;
		height: 32px;
		border-radius: 999px;
		border: 3px solid color-mix(in oklch, var(--foreground) 18%, transparent);
		border-top-color: var(--primary);
		animation: scanner-spin 0.8s linear infinite;
	}

	@keyframes scanner-spin {
		to {
			transform: rotate(360deg);
		}
	}

	.scanner-status-text,
	.scanner-error-text {
		font-size: 13.5px;
		color: var(--muted-foreground);
	}
</style>
