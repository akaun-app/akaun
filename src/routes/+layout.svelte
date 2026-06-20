<script lang="ts">
	import './fonts.css';
	import './layout.css';
	import { Toaster } from '$lib/components/ui/sonner/index.js';
	import { ModeWatcher } from 'mode-watcher';
	import NavProgress from '$lib/components/ui/NavProgress.svelte';

	let { children } = $props();
</script>

<svelte:head>
	<title>Akaun</title>
</svelte:head>

<ModeWatcher defaultMode="system" />
<NavProgress />
{@render children()}
<Toaster richColors position="bottom-right" />
