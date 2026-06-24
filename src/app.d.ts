import type { EffectivePermissions } from '$lib/server/permissions.js';

declare global {
	namespace App {
		interface Locals {
			user: { id: number; email: string; username: string; name: string | null; role: string } | null;
			permissions: EffectivePermissions | null;
			isSuperuser: boolean;
		}
		interface PageState {
			viaPush?: boolean;
		}
	}
}

declare module 'svelte/elements' {
	interface SvelteWindowAttributes {
		'onfilter-dropdown-open'?: (e: CustomEvent) => void;
	}
}

export {};
