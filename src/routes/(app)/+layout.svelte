<script lang="ts">
	import { page } from '$app/stores';
	import Sidebar from '$lib/components/ui/Sidebar.svelte';
	import { appState } from '$lib/state/app.svelte.js';
	import type { LayoutData } from './$types.js';

	let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();

	// Apply theme to <html> element
	$effect(() => {
		const html = document.documentElement;
		if (appState.theme === 'dark') {
			html.classList.add('dark');
		} else if (appState.theme === 'light') {
			html.classList.remove('dark');
		} else {
			// auto: follow system
			const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
			if (prefersDark) {
				html.classList.add('dark');
			} else {
				html.classList.remove('dark');
			}
		}
	});

	// Initialize theme from localStorage if available
	$effect(() => {
		const saved = localStorage.getItem('akaun-theme') as 'auto' | 'light' | 'dark' | null;
		if (saved) appState.theme = saved;
	});

	// Persist theme changes
	$effect(() => {
		const t = appState.theme;
		localStorage.setItem('akaun-theme', t);
	});
</script>

<div class="app">
	<Sidebar
		user={data.user}
		activePage={$page.url.pathname}
		unpaidCount={data.unpaidCount}
	/>
	<main class="main">
		{@render children()}
	</main>
</div>
