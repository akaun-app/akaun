<script lang="ts">
	import { page } from '$app/stores';
	import { onNavigate } from '$app/navigation';
	import { Menu } from '@lucide/svelte';
	import Sidebar from '$lib/components/ui/Sidebar.svelte';
	import BottomNav from '$lib/components/ui/BottomNav.svelte';
	import MobileDrawer from '$lib/components/ui/MobileDrawer.svelte';
	import type { LayoutData } from './$types.js';

	let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();
	let drawerOpen = $state(false);

	onNavigate((navigation) => {
		if (!document.startViewTransition) return;
		return new Promise((resolve) => {
			document.startViewTransition(async () => {
				resolve();
				await navigation.complete;
			});
		});
	});
</script>

<div class="app">
	<Sidebar
		user={data.user}
		activePage={$page.url.pathname}
		unpaidCount={data.unpaidCount}
		isSuperuser={data.isSuperuser}
		navItems={data.navItems}
	/>
	<main class="main">
		<div class="mobile-menu-anchor">
			<button class="mobile-menu-btn" onclick={() => (drawerOpen = true)} aria-label="Open navigation">
				<Menu size={20} />
			</button>
		</div>
		{@render children()}
	</main>
</div>

<BottomNav
	activePage={$page.url.pathname}
	unpaidCount={data.unpaidCount}
	navItems={data.navItems}
/>

<MobileDrawer
	bind:open={drawerOpen}
	user={data.user}
	isSuperuser={data.isSuperuser}
	navItems={data.navItems}
/>

<style>
	.mobile-menu-anchor {
		display: none;
	}

	.mobile-menu-btn {
		display: none;
	}

	@media (max-width: 767px) {
		.mobile-menu-anchor {
			display: block;
			position: sticky;
			top: 0;
			height: 0;
			overflow: visible;
			z-index: 35;
		}

		.mobile-menu-btn {
			display: flex;
			position: absolute;
			top: 11px;
			left: calc(12px + env(safe-area-inset-left));
			width: 32px;
			height: 32px;
			align-items: center;
			justify-content: center;
			background: none;
			border: none;
			color: var(--foreground);
			cursor: pointer;
			-webkit-tap-highlight-color: transparent;
		}
	}

	@media (max-width: 767px) and (display-mode: standalone) {
		.mobile-menu-anchor {
			padding-top: env(safe-area-inset-top);
		}
	}
</style>
