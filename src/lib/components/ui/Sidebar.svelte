<script lang="ts">
	import {
		LayoutDashboard,
		Wallet,
		TrendingUp,
		FileText,
		Upload,
		Settings,
		Sun,
		Moon,
		LogOut,
		ChevronLeft,
		ChevronRight
	} from '@lucide/svelte';
	import { appState } from '$lib/state/app.svelte.js';

	let {
		user,
		activePage,
		unpaidCount = 0
	}: {
		user: { username: string } | null;
		activePage: string;
		unpaidCount?: number;
	} = $props();

	const collapsed = $derived(appState.sidebarCollapsed);

	const nav = [
		{ id: 'dashboard', label: 'Dashboard', href: '/dashboard', Icon: LayoutDashboard },
		{ id: 'expenses', label: 'Expenses', href: '/expenses', Icon: Wallet, badge: unpaidCount },
		{ id: 'income', label: 'Income', href: '/income', Icon: TrendingUp },
		{ id: 'claims', label: 'Claims', href: '/claims', Icon: FileText },
		{ id: 'import', label: 'Import', href: '/import', Icon: Upload }
	];

	function isActive(href: string) {
		return activePage === href || activePage.startsWith(href + '/');
	}

	function getInitials(username: string) {
		return username
			.split(/[\s._-]/)
			.map((p) => p[0])
			.join('')
			.toUpperCase()
			.slice(0, 2);
	}

	function toggleTheme() {
		const current = appState.theme;
		if (current === 'auto') {
			appState.theme = 'light';
		} else if (current === 'light') {
			appState.theme = 'dark';
		} else {
			appState.theme = 'auto';
		}
	}

	const themeLabel = $derived(
		appState.theme === 'dark' ? 'Dark' : appState.theme === 'light' ? 'Light' : 'Auto'
	);
	const isDark = $derived(appState.theme === 'dark');
</script>

<aside class="sidebar" class:collapsed>
	<div class="sb-brand">
		<div class="sb-logo">A</div>
		{#if !collapsed}
			<div>
				<div class="sb-brand-name">Akaun</div>
				<div class="sb-brand-sub">Bookkeeping</div>
			</div>
		{/if}
	</div>

	<div class="sb-section">
		{#if !collapsed}<div class="sb-section-label">Workspace</div>{/if}
		<nav class="sb-nav">
			{#each nav as item}
				<a
					href={item.href}
					class="sb-item"
					class:active={isActive(item.href)}
					title={collapsed ? item.label : undefined}
				>
					<item.Icon size={18} />
					{#if !collapsed}
						<span class="sb-item-label">{item.label}</span>
						{#if item.badge}
							<span class="sb-item-badge">{item.badge}</span>
						{/if}
					{/if}
				</a>
			{/each}
		</nav>
	</div>

	<div class="sb-spacer"></div>

	<div class="sb-section">
		<nav class="sb-nav">
			<a
				href="/settings"
				class="sb-item"
				class:active={isActive('/settings')}
				title={collapsed ? 'Settings' : undefined}
			>
				<Settings size={18} />
				{#if !collapsed}<span class="sb-item-label">Settings</span>{/if}
			</a>
			<button class="sb-item sb-theme" title="Toggle theme" onclick={toggleTheme}>
				{#if isDark}
					<Moon size={18} />
				{:else}
					<Sun size={18} />
				{/if}
				{#if !collapsed}<span class="sb-item-label">{themeLabel} · theme</span>{/if}
			</button>
			<button
				class="sb-item"
				title={collapsed ? 'Toggle sidebar' : undefined}
				onclick={() => (appState.sidebarCollapsed = !appState.sidebarCollapsed)}
			>
				{#if collapsed}
					<ChevronRight size={18} />
				{:else}
					<ChevronLeft size={18} />
					<span class="sb-item-label">Collapse</span>
				{/if}
			</button>
		</nav>
	</div>

	<div class="sb-user">
		<div class="sb-avatar">{user ? getInitials(user.username) : '?'}</div>
		{#if !collapsed}
			<div style="flex:1; min-width:0">
				<div class="sb-user-name">{user?.username ?? 'User'}</div>
			</div>
			<form method="POST" action="/logout" style="flex-shrink:0">
				<button
					type="submit"
					class="sb-item"
					style="padding:6px; width:auto; border-radius:6px;"
					title="Sign out"
				>
					<LogOut size={16} />
				</button>
			</form>
		{/if}
	</div>
</aside>
