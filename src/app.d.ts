import type { EffectivePermissions } from '$lib/server/permissions.js';

declare global {
	namespace App {
		interface Locals {
			user: { id: number; email: string; username: string; name: string | null; role: string } | null;
			permissions: EffectivePermissions | null;
			isSuperuser: boolean;
		}
		// `PageState.viaPush` was here. Detail views were drawers opened with
		// shallow routing, and it recorded whether the drawer had pushed the
		// history entry it would later pop. Detail views are pages now, so the
		// navigation is real and the browser keeps the entry itself.
		interface PageState {}
	}
}

declare module 'svelte/elements' {
	interface SvelteWindowAttributes {
		'onfilter-dropdown-open'?: (e: CustomEvent) => void;
	}
}

export {};
