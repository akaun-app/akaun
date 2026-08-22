<script lang="ts">
	import { afterNavigate, goto } from '$app/navigation';
	import { ChevronLeft } from '@lucide/svelte';

	/**
	 * "← Records" at the top of a detail page.
	 *
	 * Going back is not the same as going to the list. The list's filters live in
	 * the address bar and its scroll position lives in the history entry, so
	 * `history.back()` restores both and `goto(href)` restores neither. But there
	 * is only an entry to go back to when the user actually came from the list —
	 * a pasted link, a reload, or a hop from another record's relation card all
	 * leave nothing useful underneath.
	 *
	 * `afterNavigate` is the only reliable signal for that in SvelteKit 2.
	 * `history.length` counts the whole tab session and is wrong after any
	 * in-app navigation.
	 */
	let { href, label }: { href: string; label: string } = $props();

	let cameFromList = $state(false);

	afterNavigate((nav) => {
		// `enter` is a fresh load or a reload: `nav.from` is null and there is no
		// entry beneath this one.
		cameFromList = nav.type !== 'enter' && nav.from?.url.pathname === href;
	});

	function back() {
		if (cameFromList) history.back();
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- `href` is a prop the caller resolved; the rule cannot see across the boundary.
		else void goto(href);
	}
</script>

<button type="button" class="back-link" onclick={back}>
	<ChevronLeft size={13} />
	{label}
</button>
