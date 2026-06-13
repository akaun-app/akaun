<script lang="ts">
	import { page } from '$app/stores';
	import Sidebar from '$lib/components/ui/Sidebar.svelte';
	import type { LayoutData } from './$types.js';

	let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();
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
