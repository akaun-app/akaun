import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
	plugins: [
		tailwindcss(),
		VitePWA({
			registerType: 'autoUpdate',
			strategies: 'generateSW',
			manifest: false,
			workbox: {
				globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
				// opencv.js (~9 MB) exceeds the 2 MiB precache limit; it's runtime-cached
				// via the CacheFirst rule below instead of precached.
				globIgnores: ['**/opencv.js'],
				navigateFallback: null,
				runtimeCaching: [
					{
						urlPattern: /^\/api\//,
						handler: 'NetworkFirst',
						options: { cacheName: 'api-cache', networkTimeoutSeconds: 3 }
					},
					{
						// opencv.js (~9 MB) is too large to precache (exceeds workbox's 2 MB
						// limit), so cache it at runtime: fetched once, then served from cache
						// on every later scanner open and offline.
						urlPattern: ({ url }) => url.pathname === '/opencv.js',
						handler: 'CacheFirst',
						options: {
							cacheName: 'opencv',
							expiration: { maxEntries: 1, maxAgeSeconds: 60 * 60 * 24 * 365 },
							cacheableResponse: { statuses: [0, 200] }
						}
					}
				]
			}
		}),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			adapter: adapter()
		})
	],
	// Pre-transform all Svelte files at startup so Vite discovers transitive deps
	// (icons from income/claims/etc.) before the first browser request.
	server: {
		warmup: {
			clientFiles: ['./src/routes/**/*.svelte', './src/lib/components/**/*.svelte']
		}
	},
	optimizeDeps: {
		include: [
			// Root layout — loaded on every page
			'mode-watcher',
			'svelte-sonner',
			'@lucide/svelte/icons/*', // glob covers all subpaths: toast icons + calendar/select/sheet/checkbox icons

			// Expenses page — first post-login page
			'bits-ui',
			'@internationalized/date', // DatePicker transitive dep
			'tailwind-variants',
			'@lucide/svelte', // named icon imports

			// Utilities used across almost every component
			'tailwind-merge',
			'clsx',

			// Dashboard charts — large bundle, worth pre-bundling explicitly
			'chart.js'
		]
	},
	// bun:sqlite is a Bun builtin; unpdf and tesseract.js skip Vite SSR transform
	// so the first request isn't interrupted by dep optimization.
	ssr: { external: ['bun:sqlite', 'unpdf', 'tesseract.js'] },
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'client',
					browser: {
						enabled: true,
						provider: playwright(),
						instances: [{ browser: 'chromium', headless: true }]
					},
					include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**']
				}
			},

			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
