<script lang="ts">
	import { MAX_MOBILE_NAV_ITEMS, NAV_ICONS_BY_ID, type SerializableNavItem } from '$lib/nav-config.js';

	let {
		activePage,
		unpaidCount = 0,
		navItems = []
	}: {
		activePage: string;
		unpaidCount?: number;
		navItems?: (SerializableNavItem & { showOnMobile: boolean })[];
	} = $props();

	const nav = $derived(
		navItems.filter((item) => item.showOnMobile).slice(0, MAX_MOBILE_NAV_ITEMS)
	);

	function badgeFor(item: SerializableNavItem): number | undefined {
		return item.id === 'expenses' ? unpaidCount : undefined;
	}

	function isActive(href: string) {
		return activePage === href || activePage.startsWith(href + '/');
	}
</script>

<nav class="bottom-nav" aria-label="Main navigation">
	{#each nav as tab}
		{@const Icon = NAV_ICONS_BY_ID[tab.id]}
		<a
			href={tab.href}
			class="bottom-nav-tab"
			class:active={isActive(tab.href)}
			aria-label={tab.label}
			aria-current={isActive(tab.href) ? 'page' : undefined}
		>
			<span class="bottom-nav-icon">
				<Icon size={22} />
				{#if badgeFor(tab) && badgeFor(tab)! > 0}
					<span class="bottom-nav-badge">{badgeFor(tab)}</span>
				{/if}
			</span>
			<span class="bottom-nav-label">{tab.label}</span>
		</a>
	{/each}
</nav>

<style>
	.bottom-nav {
		display: none;
	}

	@media (max-width: 767px) {
		.bottom-nav {
			display: flex;
			position: fixed;
			bottom: 0;
			left: 0;
			right: 0;
			height: 56px;
			padding-left: env(safe-area-inset-left);
			padding-right: env(safe-area-inset-right);
			background: var(--sidebar);
			border-top: 1px solid var(--sidebar-border);
			z-index: 50;
			align-items: stretch;
		}

		.bottom-nav-tab {
			flex: 1;
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			gap: 3px;
			text-decoration: none;
			color: var(--muted-foreground);
			font-size: 10px;
			font-weight: 500;
			padding: 6px 4px 4px;
			transition: color 0.12s;
			-webkit-tap-highlight-color: transparent;
			position: relative;
			font-family: 'Geist', system-ui, sans-serif;
		}

		.bottom-nav-tab.active {
			color: var(--primary);
		}

		.bottom-nav-tab.active::before {
			content: '';
			position: absolute;
			top: 0;
			left: 50%;
			transform: translateX(-50%);
			width: 32px;
			height: 2px;
			border-radius: 0 0 2px 2px;
			background: var(--primary);
		}

		.bottom-nav-icon {
			position: relative;
			display: flex;
			align-items: center;
			justify-content: center;
			transition: transform 0.1s ease;
		}

		.bottom-nav-tab:active .bottom-nav-icon {
			transform: scale(0.86);
		}

		.bottom-nav-badge {
			position: absolute;
			top: -5px;
			right: -8px;
			min-width: 16px;
			height: 16px;
			background: var(--primary);
			color: var(--primary-foreground);
			font-size: 9px;
			font-weight: 700;
			border-radius: 999px;
			display: grid;
			place-items: center;
			padding: 0 3px;
			font-variant-numeric: tabular-nums;
		}

		.bottom-nav-label {
			line-height: 1;
		}
	}
</style>
