<script lang="ts">
	// Thin top progress bar shown during client-side navigation. Gives an
	// instant, native-feeling response to taps even while the SSR load for the
	// next page is still in flight. Driven solely by the `navigating` store —
	// no timers — so it appears on navigation start and is removed on completion.
	import { navigating } from '$app/stores';
</script>

{#if $navigating}
	<div class="nav-progress" aria-hidden="true"></div>
{/if}

<style>
	.nav-progress {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		height: 2.5px;
		z-index: 100;
		background: var(--primary);
		box-shadow: 0 0 8px var(--primary);
		transform-origin: 0 50%;
		animation: nav-progress-grow 2.2s cubic-bezier(0.1, 0.7, 0.2, 1) forwards;
		/* Compositor-only animation (transform), so it stays smooth on mobile. */
		will-change: transform;
	}

	@keyframes nav-progress-grow {
		0% {
			transform: scaleX(0);
		}
		35% {
			transform: scaleX(0.5);
		}
		75% {
			transform: scaleX(0.82);
		}
		100% {
			transform: scaleX(0.94);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.nav-progress {
			animation: nav-progress-grow 0.01s forwards;
		}
	}
</style>
