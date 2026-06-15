<script lang="ts">
	import './layout.css';
	import { Toaster } from '$lib/components/ui/sonner/index.js';
	import { ModeWatcher } from 'mode-watcher';

	let { children } = $props();
</script>

<svelte:head>
	<title>Akaun</title>
</svelte:head>

<ModeWatcher defaultMode="system" />
{@render children()}
<Toaster richColors position="bottom-right" />
