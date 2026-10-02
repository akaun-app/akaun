<script lang="ts">
	import { untrack } from 'svelte';
	import { Dialog } from 'bits-ui';
	import { RotateCcw } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import {
		ImportMode,
		ImportReadAs,
		PROFILE_READ_AS_PREFIX,
		importModeLabel,
		isImportMode,
		type ImportModeValue
	} from '$lib/import-reading.js';
	import { hasProfileChoice } from './review-card.js';

	/**
	 * "Read again" (006 FR-023, US9 AS6): reads a document once more from the
	 * file already uploaded, the way the user now chooses, without uploading it
	 * again. What the last reading proposed is thrown away and replaced.
	 *
	 * The dialog only asks and sends. The server decides whether the document
	 * may be read again and says why not; the job then goes back into the
	 * queue, and every open screen follows it through the live updates, so
	 * nothing here changes the list itself.
	 *
	 * For a reading that can use a profile (a profile, or Auto-detect while a
	 * profile is on) the dialog also asks which part of a statement to import,
	 * Summary or Every transaction (FR-002, FR-023), starting from the mode the
	 * document had, so a statement read as its summary can be read again as
	 * every transaction.
	 */
	let {
		open = $bindable(false),
		jobId,
		filename,
		choices,
		current,
		currentMode = null,
		replaces,
		ondone
	}: {
		open?: boolean;
		jobId: string;
		filename: string;
		/** The "Read as" choices an upload offers, in its words (FR-001). */
		choices: { value: string; label: string }[];
		/** How the document was asked to be read last time, as a "Read as" value. */
		current: string;
		/** The import mode it was asked for last time, if it had one. */
		currentMode?: string | null;
		/** What reading it again throws away, in a sentence. */
		replaces: string;
		/** Called once the server has queued the new reading. */
		ondone?: () => void;
	} = $props();

	let choice = $state<string>(ImportReadAs.Auto);
	let mode = $state<ImportModeValue>(ImportMode.Summary);
	const MODES: ImportModeValue[] = [ImportMode.Summary, ImportMode.EveryTransaction];
	let sending = $state(false);
	let error = $state<string | null>(null);

	// Each time it opens, it starts from the reading the document had, so the
	// user sees what was used. A profile turned off since is not offered, and
	// Auto-detect stands in for it.
	$effect(() => {
		if (!open) return;
		untrack(() => {
			choice = choices.some((c) => c.value === current) ? current : ImportReadAs.Auto;
			mode = isImportMode(currentMode) ? currentMode : ImportMode.Summary;
			error = null;
		});
	});

	const profilesEnabled = $derived(hasProfileChoice(choices));
	// A receipt or several items has no import mode, so it is asked only for a
	// reading that can use a profile.
	const modeShown = $derived(
		profilesEnabled && (choice === ImportReadAs.Auto || choice.startsWith(PROFILE_READ_AS_PREFIX))
	);

	async function readAgain() {
		if (sending) return;
		sending = true;
		error = null;
		try {
			const res = await fetch(`/api/import/${jobId}/reread`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(modeShown ? { readAs: choice, importMode: mode } : { readAs: choice }),
				credentials: 'include'
			});
			if (!res.ok) {
				// A rule refused it and nothing changed: say why, here.
				if (res.status === 403) {
					error = 'You do not have permission to read documents again.';
				} else {
					const body = await res.json().catch(() => ({}));
					error = body.error ?? 'It could not be read again. Try again.';
				}
				return;
			}
			open = false;
			ondone?.();
		} catch {
			error = 'That did not reach the server. Check the connection and try again.';
		} finally {
			sending = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Portal>
		<Dialog.Overlay class="fixed inset-0 z-[60] bg-black/35" />
		<Dialog.Content
			class="bg-popover text-popover-foreground fixed top-1/2 left-1/2 z-[60] flex max-h-[90dvh] w-[min(90vw,440px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg p-5 shadow-lg [border:1px_solid_var(--border)]"
		>
			<Dialog.Title class="text-[15px] font-semibold">Read again</Dialog.Title>
			<Dialog.Description class="text-muted-foreground mt-2 text-[13px] leading-relaxed">
				Reads <b class="ra-file">{filename}</b> again from the file already uploaded. {replaces}
			</Dialog.Description>

			<div class="ra-choices" role="radiogroup" aria-label="Read as">
				{#each choices as option (option.value)}
					<label class="ra-choice" class:on={choice === option.value}>
						<input
							type="radio"
							name="read-again-{jobId}"
							value={option.value}
							checked={choice === option.value}
							onchange={() => (choice = option.value)}
						/>
						<span class="ra-choice-main">
							<span class="ra-choice-label">{option.label}</span>
							{#if option.value === ImportReadAs.Auto && profilesEnabled}
								<span class="ra-choice-hint">Uses a saved profile that fits, or else the standard reading.</span>
							{/if}
						</span>
					</label>
				{/each}
			</div>

			{#if modeShown}
				<div class="ra-mode" role="radiogroup" aria-label="Import">
					<span class="ra-mode-label">Import</span>
					{#each MODES as option (option)}
						<label class="ra-mode-choice" class:on={mode === option}>
							<input
								type="radio"
								name="read-again-mode-{jobId}"
								value={option}
								checked={mode === option}
								onchange={() => (mode = option)}
							/>
							{importModeLabel(option)}
						</label>
					{/each}
				</div>
			{/if}

			{#if error}
				<p class="ra-error" role="alert">{error}</p>
			{/if}

			<div class="mt-5 flex justify-end gap-2">
				<Dialog.Close>
					{#snippet child({ props })}
						<Button {...props} variant="outline" size="sm">Cancel</Button>
					{/snippet}
				</Dialog.Close>
				<Button size="sm" disabled={sending} onclick={readAgain}>
					<RotateCcw size={14} />
					{sending ? 'Sending…' : 'Read again'}
				</Button>
			</div>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>

<style>
	.ra-file {
		font-weight: 500;
		color: var(--foreground);
		overflow-wrap: anywhere;
	}
	/* The choices scroll on their own when there are many profiles, so the
	   buttons stay in view. */
	.ra-choices {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin-top: 14px;
		overflow-y: auto;
		min-height: 0;
	}
	.ra-choice {
		display: flex;
		align-items: flex-start;
		gap: 9px;
		padding: 8px 10px;
		border: 1px solid var(--border);
		border-radius: 8px;
		cursor: pointer;
		font-size: 13px;
	}
	.ra-choice.on {
		border-color: var(--primary);
		background: var(--accent);
	}
	.ra-choice input {
		margin-top: 3px;
		accent-color: var(--primary);
		flex-shrink: 0;
	}
	.ra-choice-main {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.ra-choice-label {
		overflow-wrap: anywhere;
	}
	.ra-choice-hint {
		font-size: 11.5px;
		color: var(--muted-foreground);
	}
	.ra-mode {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: 12px;
		font-size: 13px;
	}
	.ra-mode-label {
		font-size: 12.5px;
		font-weight: 500;
		color: var(--muted-foreground);
		margin-right: 4px;
	}
	.ra-mode-choice {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 5px 10px;
		border: 1px solid var(--border);
		border-radius: 8px;
		cursor: pointer;
	}
	.ra-mode-choice.on {
		border-color: var(--primary);
		background: var(--accent);
	}
	.ra-mode-choice input {
		accent-color: var(--primary);
	}
	.ra-error {
		margin: 12px 0 0;
		font-size: 12.5px;
		color: var(--red);
	}
</style>
