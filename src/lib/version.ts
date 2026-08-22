import { version } from "$app/environment";

/**
 * The build's version, set as `kit.version.name` from `git describe` in vite.config.ts.
 * SvelteKit's default is `Date.now()`, so treat a bare number as "not stamped".
 */
export const APP_VERSION = /^\d+$/.test(version) ? "unknown" : version;

/**
 * What every screen shows. The `v` is display only — the git tags themselves carry no prefix.
 * Reads `v0.1.7` on a tagged build, `v0.1.7-10-gb26465b` past the tag, `-dirty` on top of that
 * when a file is uncommitted. The fallback stays unprefixed so it reads `unknown`, not `vunknown`.
 */
export const APP_VERSION_LABEL =
  APP_VERSION === "unknown" ? APP_VERSION : `v${APP_VERSION}`;
