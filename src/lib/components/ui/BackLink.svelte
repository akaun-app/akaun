<script lang="ts">
	import { afterNavigate, goto } from '$app/navigation';
	import { ChevronLeft } from '@lucide/svelte';

	/**
	 * "← Records" at the top of a detail page.
	 *
	 * Going back is not the same as going to the list. The list's filters live in
	 * the address bar and its scroll position lives in the history entry, so
	 * `history.back()` restores both and `goto(href)` restores neither. Browser
	 * history already knows the true previous page on every hop — including a
	 * hop from another record's relation card, or from an account's or a
	 * contact's page — so we trust it whenever there is a real entry underneath.
	 * `href`/`label` are only a last resort for when there isn't one: a pasted
	 * link, a fresh load, or a reload.
	 *
	 * `afterNavigate` is the only reliable signal for that in SvelteKit 2.
	 * `history.length` counts the whole tab session and is wrong after any
	 * in-app navigation.
	 */
	let { href, label }: { href: string; label: string } = $props();

	// Drives the actual navigation: any real previous in-app entry is trusted,
	// not just one that happens to match `href`.
	let hasPriorEntry = $state(false);
	// Narrower: true only when we actually know the previous page is `href`, so
	// the button can show its real name instead of a guess.
	let cameFromExactList = $state(false);

	afterNavigate((nav) => {
		// `enter` is a fresh load or a reload: `nav.from` is null and there is no
		// entry beneath this one.
		hasPriorEntry = nav.type !== 'enter' && nav.from != null;
		cameFromExactList = hasPriorEntry && nav.from?.url.pathname === href;
	});

	function back() {
		if (hasPriorEntry) history.back();
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- `href` is a prop the caller resolved; the rule cannot see across the boundary.
		else void goto(href);
	}
</script>

<button type="button" class="back-link" onclick={back}>
	<ChevronLeft size={13} />
	{cameFromExactList || !hasPriorEntry ? label : 'Back'}
</button>
