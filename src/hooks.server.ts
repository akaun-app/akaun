import { redirect, type Handle } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import {
  db,
  ensureDefaultAdmin,
  ensureGroupSeed,
  applyRecordsPermission,
} from "$lib/server/db/client.js";
import { seedAccounts } from "$lib/server/db/seed-accounts.js";
import { getSessionUser } from "$lib/server/auth.js";
import { bearerLocals } from "$lib/server/bearer-auth.js";
import { getEffectivePermissions } from "$lib/server/permissions.js";
import { setLogLevel } from "$lib/server/logger.js";
import { startImportWorker } from "$lib/server/import/worker.js";

if (env.LOG_LEVEL) setLogLevel(env.LOG_LEVEL);

export const init = async () => {
  await ensureDefaultAdmin();
  ensureGroupSeed();
  // Beside the group seed, because it finishes the same job: the seed writes the
  // `records` ability for a fresh install, and this rewrites the two abilities it
  // replaces for an existing one (FR-029).
  applyRecordsPermission();
  // The chart of accounts a new installation starts with. An installation that
  // had books already has every seeded code by now — `db/auto-upgrade.ts` runs
  // before this, at module load in `createDb()`, and `migrateAccountChart` either
  // renames a legacy account onto each seeded name or creates the seed — so this
  // is a no-op there and only does work on a fresh install (research.md R-06).
  seedAccounts(db);
  // `ensureLedgerUpgrade()` was called here, and the conversion is self-running
  // again — but it cannot run from `init()`. `migrate()` applies 0015, which drops
  // the tables the conversion reads, and that happens at module load in
  // `createDb()`, long before this. So it moved *earlier* rather than away:
  // `db/auto-upgrade.ts`, called before the database is even opened for writing
  // (002 FR-037, research.md R-06).
  startImportWorker();
};

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function withSecurityHeaders(response: Response): Response {
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  if (!response.headers.has("Content-Security-Policy")) {
    response.headers.set("Content-Security-Policy", "frame-ancestors 'none'");
  }
  return response;
}

export const handle: Handle = async ({ event, resolve }) => {
  const { pathname } = event.url;

  // MCP is a protocol interface beside REST. Cookie sessions must never turn
  // an unauthenticated MCP request into a browser login redirect.
  if (pathname === "/mcp" || pathname === "/mcp/") {
    const actor = bearerLocals(db, event.request.headers.get("Authorization"));
    if (!actor) {
      return withSecurityHeaders(
        new Response("Unauthorized", {
          status: 401,
          headers: {
            "WWW-Authenticate": 'Bearer realm="akaun-mcp"',
            "Cache-Control": "no-store",
          },
        }),
      );
    }
    Object.assign(event.locals, actor);
    return withSecurityHeaders(await resolve(event));
  }

  if (pathname.startsWith("/api/")) {
    const header = event.request.headers.get("Authorization");
    if (header?.startsWith("Bearer ")) {
      const actor = bearerLocals(db, header);
      if (!actor) {
        return new Response("Unauthorized", { status: 401 });
      }
      Object.assign(event.locals, actor);
    } else {
      const sessionId = event.cookies.get("session");
      const sessionUser = sessionId ? getSessionUser(db, sessionId) : null;
      if (!sessionUser) {
        return new Response("Unauthorized", { status: 401 });
      }
      // CSRF defence-in-depth for cookie-authenticated state-changing requests:
      // require the Origin (or Referer) host to match this site. Bearer-token clients
      // are exempt (they authenticate without ambient cookies and send no Origin).
      if (MUTATING_METHODS.has(event.request.method)) {
        const origin = event.request.headers.get("origin");
        const referer = event.request.headers.get("referer");
        const source = origin ?? referer;
        let ok = false;
        if (source) {
          try {
            ok = new URL(source).host === event.url.host;
          } catch {
            ok = false;
          }
        }
        if (!ok) {
          return new Response("Forbidden (CSRF origin check failed)", {
            status: 403,
          });
        }
      }
      event.locals.user = sessionUser;
      const { permissions, isSuperuser } = getEffectivePermissions(
        db,
        sessionUser.id,
      );
      event.locals.permissions = permissions;
      event.locals.isSuperuser = isSuperuser;
    }
    return withSecurityHeaders(await resolve(event));
  }

  const sessionId = event.cookies.get("session");
  const sessionUser = sessionId ? getSessionUser(db, sessionId) : null;
  event.locals.user = sessionUser;

  if (!sessionUser) {
    if (pathname !== "/login") throw redirect(302, "/login");
    event.locals.permissions = null;
    event.locals.isSuperuser = false;
    return withSecurityHeaders(await resolve(event));
  }

  const { permissions, isSuperuser } = getEffectivePermissions(
    db,
    sessionUser.id,
  );
  event.locals.permissions = permissions;
  event.locals.isSuperuser = isSuperuser;

  return withSecurityHeaders(await resolve(event));
};
