/**
 * Shared reactive viewport check.
 *
 * Replaces the per-page `matchMedia('(max-width: 767px)')` effect that was
 * duplicated across the expenses / income / claims / contacts / users-groups
 * pages. Construct during component init (top of <script>):
 *
 *   const screen = useIsMobile();
 *   const isMobile = $derived(screen.current);
 *   const panelSide = $derived(isMobile ? 'bottom' : 'right');
 */
export class IsMobile {
	#current = $state(false);

	constructor(query = '(max-width: 767px)') {
		$effect(() => {
			const mq = window.matchMedia(query);
			this.#current = mq.matches;
			const handler = (e: MediaQueryListEvent) => (this.#current = e.matches);
			mq.addEventListener('change', handler);
			return () => mq.removeEventListener('change', handler);
		});
	}

	get current(): boolean {
		return this.#current;
	}
}

export function useIsMobile(query?: string): IsMobile {
	return new IsMobile(query);
}
