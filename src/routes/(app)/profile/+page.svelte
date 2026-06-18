<script lang="ts">
	import { enhance } from '$app/forms';
	import { Copy, Check, RefreshCw, Trash2, KeyRound } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { toast } from 'svelte-sonner';
	import type { PageData, ActionData } from './$types.js';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	type Tab = 'profile' | 'security' | 'token';
	let activeTab = $state<Tab>('profile');

	// Profile tab state — initialized empty, synced from data via $effect
	let profileName = $state('');
	let profileEmail = $state('');
	let profileUsername = $state('');

	// Keep form fields in sync with data (initial load + after successful saves)
	$effect(() => {
		profileName = data.name ?? '';
		profileEmail = data.email;
		profileUsername = data.username;
	});

	// Security tab state
	let currentPassword = $state('');
	let newPassword = $state('');
	let confirmPassword = $state('');
	let passwordMismatch = $derived(confirmPassword.length > 0 && newPassword !== confirmPassword);

	// Token tab state — derived from data; only revealedToken is local state
	const hasBearerToken = $derived(data.hasBearerToken);
	const maskedToken = $derived(data.maskedToken);
	let revealedToken = $state<string | null>(null);
	let copied = $state(false);

	$effect(() => {
		if (!form) return;
		if (form.action === 'profile' && form.success) {
			toast.success('Profile updated');
		} else if (form.action === 'security' && form.success) {
			toast.success('Password changed');
			currentPassword = '';
			newPassword = '';
			confirmPassword = '';
		} else if (form.action === 'token' && form.success) {
			if (form.newToken) {
				revealedToken = form.newToken;
				toast.success('New API token generated — copy it now');
			} else {
				revealedToken = null;
				toast.success('API token revoked');
			}
		}
	});

	async function copyToken() {
		if (!revealedToken) return;
		await navigator.clipboard.writeText(revealedToken);
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}

	const TABS: { id: Tab; label: string }[] = [
		{ id: 'profile', label: 'Profile' },
		{ id: 'security', label: 'Security' },
		{ id: 'token', label: 'API Token' }
	];
</script>

<svelte:head>
	<title>Profile - Akaun</title>
</svelte:head>

<div class="screen">
	<header class="topbar">
		<div class="topbar-left">
			<h1 class="page-title">My Profile</h1>
			<p class="page-sub">Manage your account details and access</p>
		</div>
	</header>

	<div class="set-layout">
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

		<div class="set-content">
			{#if activeTab === 'profile'}
				<div class="set-section">
					<div class="set-section-head">
						<h2 class="set-section-title">Profile</h2>
						<p class="set-section-sub">Update your display name, email, and username</p>
					</div>
					<form
						method="POST"
						action="?/updateProfile"
						use:enhance
					>
						<div class="set-rows">
							<div class="set-row">
								<div class="set-row-label">Display name</div>
								<Input
									class="set-input-right"
									type="text"
									name="name"
									placeholder="Your full name"
									bind:value={profileName}
								/>
							</div>
							<div class="set-row">
								<div class="set-row-label">Email</div>
								<Input
									class="set-input-right"
									type="email"
									name="email"
									required
									bind:value={profileEmail}
								/>
							</div>
							<div class="set-row">
								<div class="set-row-label">Username</div>
								<Input
									class="set-input-right"
									type="text"
									name="username"
									required
									bind:value={profileUsername}
								/>
							</div>
						</div>
						{#if form?.action === 'profile' && form?.error}
							<p class="form-error">{form.error}</p>
						{/if}
						<Button type="submit" class="mt-4">Save changes</Button>
					</form>
				</div>

			{:else if activeTab === 'security'}
				<div class="set-section">
					<div class="set-section-head">
						<h2 class="set-section-title">Change Password</h2>
						<p class="set-section-sub">Choose a strong password of at least 8 characters</p>
					</div>
					<form
						method="POST"
						action="?/changePassword"
						use:enhance
					>
						<div class="set-rows">
							<div class="set-row">
								<div class="set-row-label">Current password</div>
								<Input
									class="set-input-right"
									type="password"
									name="currentPassword"
									required
									bind:value={currentPassword}
									autocomplete="current-password"
								/>
							</div>
							<div class="set-row">
								<div class="set-row-label">New password</div>
								<Input
									class="set-input-right"
									type="password"
									name="newPassword"
									required
									minlength={8}
									bind:value={newPassword}
									autocomplete="new-password"
								/>
							</div>
							<div class="set-row">
								<div class="set-row-label">Confirm new password</div>
								<Input
									class="set-input-right"
									type="password"
									name="confirmPassword"
									required
									bind:value={confirmPassword}
									autocomplete="new-password"
									aria-invalid={passwordMismatch}
								/>
							</div>
							{#if passwordMismatch}
								<p class="form-error" style="margin:0 16px;">Passwords do not match.</p>
							{/if}
						</div>
						{#if form?.action === 'security' && form?.error}
							<p class="form-error">{form.error}</p>
						{/if}
						<Button type="submit" class="mt-4" disabled={passwordMismatch}>
							Change password
						</Button>
					</form>
				</div>

			{:else if activeTab === 'token'}
				<div class="set-section">
					<div class="set-section-head">
						<h2 class="set-section-title">API Token</h2>
						<p class="set-section-sub">Use this token to authenticate API requests with a Bearer header</p>
					</div>

					{#if revealedToken}
						<div class="token-reveal">
							<div class="token-warn">
								<KeyRound size={13} />
								Copy this token now — it will not be shown again.
							</div>
							<div class="token-box">
								<code class="token-value">{revealedToken}</code>
								<Button variant="ghost" size="sm" onclick={copyToken}>
									{#if copied}
										<Check size={14} /> Copied
									{:else}
										<Copy size={14} /> Copy
									{/if}
								</Button>
							</div>
						</div>
					{:else if hasBearerToken}
						<div class="set-rows">
							<div class="set-row">
								<div class="set-row-label">Active token</div>
								<code class="token-masked">{maskedToken}</code>
							</div>
						</div>
					{:else}
						<div class="set-rows">
							<div class="set-row">
								<div class="set-row-label">Token</div>
								<div class="set-row-value" style="color:var(--muted-foreground); font-size:13px;">No token issued</div>
							</div>
						</div>
					{/if}

					<div class="token-actions">
						<form method="POST" action="?/regenerateToken" use:enhance>
							<Button type="submit" variant="outline" size="sm">
								<RefreshCw size={13} />
								{hasBearerToken ? 'Regenerate token' : 'Generate token'}
							</Button>
						</form>
						{#if hasBearerToken}
							<form method="POST" action="?/revokeToken" use:enhance>
								<Button type="submit" variant="ghost" size="sm" class="text-destructive">
									<Trash2 size={13} />
									Revoke token
								</Button>
							</form>
						{/if}
					</div>
				</div>
			{/if}
		</div>
	</div>
</div>

<style>
	.form-error {
		margin: 10px 16px 0;
		font-size: 12px;
		color: var(--red);
	}

	.token-reveal {
		margin: 0 16px 16px;
	}

	.token-warn {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 8px 12px;
		background: var(--amber-soft);
		border: 1px solid var(--amber);
		border-radius: var(--radius);
		font-size: 12px;
		color: var(--amber);
		margin-bottom: 8px;
	}

	.token-box {
		display: flex;
		align-items: center;
		gap: 8px;
		background: var(--muted);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 10px 12px;
	}

	.token-value {
		flex: 1;
		min-width: 0;
		font-family: "Geist Mono", ui-monospace, monospace;
		font-size: 12px;
		word-break: break-all;
		color: var(--foreground);
	}

	.token-masked {
		font-family: "Geist Mono", ui-monospace, monospace;
		font-size: 13px;
		color: var(--muted-foreground);
		letter-spacing: 0.02em;
	}

	.token-actions {
		display: flex;
		gap: 8px;
		margin: 16px 16px 0;
	}
</style>
