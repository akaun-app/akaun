<script lang="ts">
	import type { ActionData } from './$types.js';

	let { form }: { form: ActionData } = $props();
</script>

<div class="login-root">
	<!-- Brand panel -->
	<div class="login-brand">
		<div class="brand-bg-glyph">A</div>
		<div class="brand-content">
			<div class="brand-logo">A</div>
			<div class="brand-name">Akaun</div>
			<div class="brand-tag">Your finances, simplified.</div>
		</div>
	</div>

	<!-- Form sheet -->
	<div class="login-sheet">
		<div class="sheet-inner">
			<h1 class="sheet-title">Sign in</h1>
			<p class="sheet-sub">Enter your credentials to continue.</p>

			{#if form?.error}
				<div class="error-banner">
					<svg
						width="15"
						height="15"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<path
							d="m10.29 3.86-8.18 14.14A2 2 0 0 0 3.84 21h16.32a2 2 0 0 0 1.73-3L13.71 3.86a2 2 0 0 0-3.42 0z"
						/>
						<line x1="12" x2="12" y1="9" y2="13" />
						<line x1="12" x2="12.01" y1="17" y2="17" />
					</svg>
					{form.error}
				</div>
			{/if}

			<form method="POST" class="login-form">
				<div class="field">
					<label for="username">Username</label>
					<input
						id="username"
						name="username"
						type="text"
						required
						autocomplete="username"
						placeholder="Enter username"
					/>
				</div>

				<div class="field">
					<label for="password">Password</label>
					<input
						id="password"
						name="password"
						type="password"
						required
						autocomplete="current-password"
						placeholder="Enter password"
					/>
				</div>

				<button type="submit" class="submit-btn">Sign in</button>
			</form>
		</div>
	</div>
</div>

<style>
	/* ── Root ─────────────────────────────────────────────── */
	.login-root {
		display: flex;
		flex-direction: column;
		min-height: 100vh;
		background: var(--background);
	}

	/* ── Brand panel ─────────────────────────────────────── */
	.login-brand {
		position: relative;
		background: var(--primary);
		padding: 52px 28px 64px;
		display: flex;
		align-items: flex-end;
		overflow: hidden;
		flex-shrink: 0;
	}

	.brand-bg-glyph {
		position: absolute;
		top: -30px;
		right: -16px;
		font-size: 200px;
		font-weight: 800;
		color: oklch(1 0 0 / 0.08);
		line-height: 1;
		user-select: none;
		letter-spacing: -0.05em;
		pointer-events: none;
	}

	.brand-content {
		position: relative;
		z-index: 1;
	}

	.brand-logo {
		width: 50px;
		height: 50px;
		border-radius: 15px;
		background: oklch(1 0 0 / 0.18);
		color: var(--primary-foreground);
		display: grid;
		place-items: center;
		font-size: 26px;
		font-weight: 800;
		margin-bottom: 18px;
		letter-spacing: -0.02em;
		backdrop-filter: blur(4px);
	}

	.brand-name {
		font-size: 30px;
		font-weight: 700;
		color: var(--primary-foreground);
		letter-spacing: -0.03em;
		line-height: 1;
	}

	.brand-tag {
		font-size: 14px;
		color: oklch(1 0 0 / 0.62);
		margin-top: 8px;
		font-weight: 400;
		letter-spacing: -0.01em;
	}

	/* ── Form sheet ──────────────────────────────────────── */
	.login-sheet {
		flex: 1;
		background: var(--background);
		border-radius: 24px 24px 0 0;
		margin-top: -24px;
		padding: 36px 28px 48px;
		position: relative;
		z-index: 2;
		animation: sheet-rise 0.5s cubic-bezier(0.16, 1, 0.3, 1) both;
	}

	@keyframes sheet-rise {
		from {
			transform: translateY(22px);
			opacity: 0;
		}
		to {
			transform: translateY(0);
			opacity: 1;
		}
	}

	.sheet-inner {
		width: 100%;
	}

	.sheet-title {
		font-size: 22px;
		font-weight: 600;
		letter-spacing: -0.025em;
		margin: 0 0 6px;
		color: var(--foreground);
	}

	.sheet-sub {
		font-size: 14px;
		color: var(--muted-foreground);
		margin: 0 0 28px;
	}

	/* ── Error banner ────────────────────────────────────── */
	.error-banner {
		background: var(--red-soft);
		color: var(--red);
		border-radius: 12px;
		padding: 12px 14px;
		font-size: 13.5px;
		margin-bottom: 22px;
		display: flex;
		align-items: center;
		gap: 9px;
		flex-shrink: 0;
	}

	/* ── Form ────────────────────────────────────────────── */
	.login-form {
		display: flex;
		flex-direction: column;
		gap: 18px;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.field label {
		font-size: 13px;
		font-weight: 500;
		color: var(--foreground);
		letter-spacing: -0.01em;
	}

	.field input {
		height: 48px;
		border: 1.5px solid var(--input);
		background: var(--card);
		color: var(--foreground);
		border-radius: 12px;
		padding: 0 16px;
		font-family: inherit;
		font-size: 15px;
		outline: none;
		transition: border-color 0.15s, box-shadow 0.15s;
		width: 100%;
		-webkit-appearance: none;
	}

	.field input::placeholder {
		color: var(--muted-foreground);
	}

	.field input:focus {
		border-color: var(--primary);
		box-shadow: 0 0 0 4px var(--primary-soft);
	}

	.submit-btn {
		width: 100%;
		height: 50px;
		background: var(--primary);
		color: var(--primary-foreground);
		border: none;
		border-radius: 14px;
		font-family: inherit;
		font-size: 15px;
		font-weight: 600;
		cursor: pointer;
		letter-spacing: -0.01em;
		margin-top: 6px;
		transition: filter 0.15s, transform 0.1s;
	}

	.submit-btn:hover {
		filter: brightness(1.07);
	}

	.submit-btn:active {
		transform: scale(0.98);
	}

	/* ── Desktop: two-column split (≥ 1200px) ────────────── */
	@media (min-width: 1200px) {
		.login-root {
			flex-direction: row;
		}

		.login-brand {
			width: 42%;
			min-height: 100vh;
			padding: 56px;
			align-items: center;
			flex-shrink: 0;
		}

		.brand-bg-glyph {
			font-size: 340px;
			top: auto;
			bottom: -70px;
			right: -40px;
		}

		.brand-name {
			font-size: 40px;
		}

		.brand-tag {
			font-size: 15px;
			margin-top: 10px;
		}

		.login-sheet {
			flex: 1;
			margin-top: 0;
			border-radius: 0;
			display: flex;
			align-items: center;
			justify-content: center;
			padding: 56px 48px;
			animation: none;
		}

		.sheet-inner {
			width: 100%;
			max-width: 400px;
		}

		.sheet-title {
			font-size: 24px;
		}
	}
</style>
