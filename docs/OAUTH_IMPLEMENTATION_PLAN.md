# OAuth for Akaun MCP

Date: 2026-10-08. Status: implemented with optional OAuth configuration; live ChatGPT/proxy verification remains a manual release check. See [OAUTH.md](OAUTH.md) for the delivered contract. The design sections below retain the original plan.

## Implementation decision

Selected and pinned `@node-oauth/oauth2-server` 5.3.0. It provides the authorization-code, S256 PKCE, token response/verification and refresh-grant engine behind Web Request/Response adapters. Akaun implements its SQLite model, resource binding, metadata, client registration and browser consent. The in-memory integration suite proves linking and refresh through the official MCP SDK 1.32.0 on Bun, plus hook dispatch, RBAC/scope isolation, revocation and replay handling.

The onboarding mechanism is DCR with public (`none`) and confidential (`client_secret_basic` / `client_secret_post`) clients. CIMD is not advertised. The published MCP 2025-11-25 specification recommends CIMD and allows DCR; this release chooses DCR to avoid a remote metadata-fetching surface. See [the specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization).

Browser actions now have an explicit Origin/Referer CSRF check in the request hook because the existing SvelteKit configuration globally trusts origins for bearer/form API interoperability. OAuth machine endpoints are dispatched before that check and never use ambient sessions.

## Recommendation

Add OAuth authorization-code flow with mandatory S256 PKCE for the existing read-only MCP interface. Keep Akaun's username/password login, sessions, users and group permissions. Run the authorization component within the existing deployment if its runtime compatibility is demonstrated; keep its protocol implementation logically separate from MCP. Cloudflare Tunnel or a reverse proxy supplies connectivity, not identity or consent.

This agrees with the attached conversation's architecture. It is OAuth for connecting ChatGPT and other MCP clients to Akaun, rather than adding Google/Microsoft sign-in to the website. Initial delivery adds no write tools or write scopes. Existing manually configured API-token clients continue to work.

## Findings in the repository

| Area                               | Existing behavior                                                                              | Required change                                                                       |
| ---------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Stack                              | SvelteKit 2 / Svelte 5, Bun, adapter-node, Drizzle and SQLite; MCP SDK declared as `^1.32.0`   | Select a component compatible with this runtime and request model                     |
| `src/hooks.server.ts`              | `/mcp` uses bearer auth; `/api/*` shares it; other unauthenticated routes redirect to `/login` | Explicitly dispatch public discovery/protocol routes before browser login enforcement |
| `src/lib/server/bearer-auth.ts`    | Looks up the supplied token directly against `users.bearerToken` and loads current RBAC        | Add a separate MCP OAuth verifier; retain the legacy REST verifier                    |
| `src/lib/server/db/schema.ts`      | A single plaintext bearer token per user; separate browser sessions                            | Separate persisted clients, authorization transactions, grants and OAuth tokens       |
| `src/routes/login/+page.server.ts` | Argon2 credentials, login rate limiting, 30-day session, unconditional redirect to `/`         | Resume a validated pending authorization after login                                  |
| `src/lib/server/permissions.ts`    | Groups plus additive user permissions; `hasPermission` always returns true for superusers      | OAuth scope checks must precede any superuser bypass                                  |
| `src/lib/server/mcp/common.ts`     | Tools filtered at registration and checked again at invocation                                 | Enforce both scopes and current View permissions through one MCP helper               |
| `src/lib/server/mcp/server.ts`     | Also exposes context, description policy and review prompt                                     | Apply the same scope boundary to resources/prompts and permission projections         |
| `src/lib/server/mcp/http.ts`       | Stateless POST transport, no cookie auth, exact same-origin check, no-store                    | Preserve transport; standardize discovery-aware authentication challenges             |
| `src/lib/server/mcp/mcp.spec.ts`   | In-memory SQLite and official MCP client; custom fetch bypasses the SvelteKit hook             | Add real hook/route coverage, not just transport/helper tests                         |
| Deployment                         | Docker and conventional server; documented public `ORIGIN`                                     | Derive canonical OAuth URLs from validated configuration, not request headers         |

The existing API token inherits REST privileges even though MCP tools are read-only. OAuth MCP credentials must not acquire those privileges. Existing API-token storage hardening is a separate follow-up, not a migration dependency for OAuth.

## Protocol component decision

First deliver a short compatibility spike, then lock the dependency and document its integration. Evaluate `oidc-provider` as a mature authorization-server candidate, and inspect the installed MCP SDK's authorization interfaces/provider support as an integration alternative. Neither is selected or claimed compatible by this review. The SDK's existence alone does not establish that it supplies a complete production authorization server; avoid filling gaps with a handwritten OAuth implementation.

The spike must demonstrate:

- Bun execution and production adapter integration, including Web Request/Response versus Node HTTP middleware, cookies, redirects and form parsing.
- Discovery, authorization code + S256 PKCE, exact registered redirect matching and RFC 8707 resource enforcement during authorization, exchange and refresh.
- A persistent SQLite adapter for codes, clients, grants, access tokens and rotating refresh-token families, with atomic consumption and revocation.
- Integration with Akaun's sessions and consent without a second user/password database.
- Supported client onboarding: pre-registration as a deterministic baseline and DCR for interoperable self-hosted onboarding. Evaluate CIMD against current MCP/OpenAI requirements separately before advertising support.
- OAuth error handling and MCP discovery challenges without browser redirects on protocol endpoints.

Record the supported MCP specification revision and verified ChatGPT client behavior at implementation time. The attached conversation's claims about current CIMD preference/support need verification against current official documentation. If the mature component requires Node, decide whether a small Node authorization service is acceptable; keep one owner of the application database and do not introduce a second uncontrolled writer. Resolve this before schema/protocol implementation.

## Public endpoints and configuration

For a root issuer `https://books.example.com` and resource `https://books.example.com/mcp`:

| Endpoint                                    | Contract                                                                     |
| ------------------------------------------- | ---------------------------------------------------------------------------- |
| `/.well-known/oauth-protected-resource/mcp` | Path-specific protected-resource metadata for `/mcp`                         |
| `/.well-known/oauth-protected-resource`     | Optional root alias advertising the same canonical resource                  |
| `/.well-known/oauth-authorization-server`   | Metadata generated consistently with the chosen root issuer                  |
| `/oauth/authorize`                          | Validate the request, authenticate with Akaun and collect consent            |
| `/oauth/token`                              | Code exchange and refresh; standard OAuth responses, no session prerequisite |
| `/oauth/register`                           | DCR if selected; bounded public registration, no implicit consent            |
| `/oauth/revoke`                             | Standards-based revocation with correct client binding                       |
| `/mcp`                                      | Accept valid MCP OAuth tokens or existing API tokens                         |

Propose `OAUTH_ENABLED`, `PUBLIC_BASE_URL`, `AUTH_ISSUER` and `MCP_RESOURCE`. Default issuer/resource from a configured public base URL; require consistency with SvelteKit `ORIGIN`. Initially support a root issuer and fixed `/mcp` resource, not arbitrary issuer path prefixes. Require HTTPS for remote use; permit explicitly configured local loopback development. Reject invalid configuration at startup. Never infer issuer/audience from Host or untrusted forwarded headers.

Unauthenticated MCP requests return 401 with a Bearer `resource_metadata` challenge pointing to the canonical metadata endpoint, without a login redirect. Invalid credentials and insufficient-scope errors follow the selected MCP/OAuth specifications; distinguish missing scope from denied Akaun permissions. Discovery is publicly reachable. Token, registration and revocation requests use protocol-specific validation rather than cookie login checks. Keep CSRF protection for login and consent actions; scope any framework Origin exceptions narrowly to OAuth machine endpoints after reviewing adapter behavior.

Keep the existing MCP Origin policy for native/server clients initially. Add cross-origin browser support only if a target client needs it, with explicit CORS/preflight rules. Proxy tests must confirm discovery, Authorization headers and canonical URLs work through the public domain. Do not place discovery or token exchange behind an additional Cloudflare Access login.

## Scopes and authorization

Initial scopes: `records:read`, `accounts:read`, `contacts:read`, `reports:read`, `import:read`.

| MCP capability                                     | Required scopes and matching View permissions                            |
| -------------------------------------------------- | ------------------------------------------------------------------------ |
| Record list/detail, outstanding, account statement | `records:read`                                                           |
| Account list                                       | `accounts:read`                                                          |
| Contact list                                       | `contacts:read`                                                          |
| Contact balance                                    | Both `contacts:read` and `records:read`                                  |
| Financial reports                                  | `reports:read`                                                           |
| Import list/detail                                 | `import:read`                                                            |
| Description policy/review prompt                   | Either authorized Records read or authorized Import read                 |
| Context resource                                   | Authenticated MCP grant; permission flags reflect scope AND current RBAC |

Authorization is the intersection of approved grant scopes, token scopes and the user's current permissions. Reject unknown scopes; do not silently grant a broader scope. Consent shows client identity, the Akaun instance and requested access; grants are specific to user, client and resource. Define the omitted-scope behavior explicitly and cover it with tests. Scope expansion requires fresh consent.

Extend `App.Locals` with an optional discriminated authentication context containing credential kind, client/grant identifiers, resource and scopes. Keep scope enforcement in an MCP helper shared by discovery, execution, resources and prompts. Do not merely mask `locals.permissions`: `isSuperuser` would bypass that mask. Leave browser/legacy REST permission semantics intact.

OAuth access tokens are accepted only by `/mcp`. `/api/*` continues accepting its existing sessions/API tokens and rejects MCP OAuth credentials. Use distinguishable token formats and fail closed: an invalid OAuth token cannot fall back to legacy authentication.

## Persistence and lifecycle

Prefer opaque random access tokens for this single-instance resource server if supported by the chosen component. Store hashes rather than token plaintext and retain issuer/resource/client/user/grant/scope/expiry bindings. If the library uses JWTs, validate algorithm, signature, issuer, audience and expiry and implement grant revocation checks; never trust claims before validation.

Persist library-compatible equivalents of clients, pending authorization transactions, authorization codes, grants, access tokens and refresh-token families. Use foreign keys, indexes, bounded metadata, cleanup and generated Drizzle migrations. A pending transaction is short-lived, tied to the browser interaction and preserves the validated request, PKCE challenge and opaque client `state`. Login resumes through a server-generated local transaction reference, not an arbitrary return URL. Invalid redirects must never receive an error redirect.

Suggested starting lifetimes: authorization codes 2 minutes, access tokens 15 minutes, refresh grants 30 days. Confirm library support and tune operationally. Consume codes once in an atomic transaction. Bind exchanges to client, redirect, PKCE and resource. Rotate refresh tokens atomically, revoke the family on reuse, and prevent scope/resource expansion. Persist across restarts and prune expired artifacts without touching bookkeeping records.

Add Connected apps to Profile: show client, scopes, creation/last-use/expiry and revoke access. Revocation invalidates the grant and all associated credentials immediately. User deletion invalidates access; RBAC changes take effect on the next MCP request. Normal browser logout need not revoke connected apps. Establish password-change/admin-reset revocation policy explicitly; recommended default is revoke OAuth grants after credential resets.

DCR needs strict redirect/client metadata validation, body limits, rate limits and bounded storage. CIMD, if added, also requires SSRF defenses for fetching client URLs: HTTPS, blocked local/private/metadata destinations, redirect and DNS controls, bounded response/time/cache behavior. Display client-supplied names as untrusted labels, not verified identities. Never log codes, access/refresh tokens, authorization headers or passwords.

## Delivery sequence

1. **Compatibility spike and decision.** Prove the protocol component/runtime/client onboarding combination with isolated fixtures. Document pinned dependency, supported spec and limitations.
2. **Persistence and configuration.** Add OAuth module, auth-context types, schemas/migrations and canonical URL validation. Test migration from a disposable pre-OAuth database; preserve existing users and API tokens.
3. **Discovery and authorization.** Implement public metadata, protocol routing, pending transactions, login resume, consent and exact redirect/resource validation. Reject unsupported flows.
4. **Token lifecycle.** Implement exchange, verification, rotation, reuse detection and revocation through the selected library and persistent adapter.
5. **MCP enforcement.** Add discovery challenges and dual MCP credential handling; enforce scopes across every capability while preventing REST reuse. Consolidate duplicate 401 behavior in hook/transport.
6. **Connected-app management and docs.** Add own-user grant list/revocation, deployment examples and OAuth instructions in README/MCP docs; retain API-token connection instructions.
7. **Interoperability release check.** Exercise real ChatGPT linking, reconnect/refresh, revoked access and limited-scope tool discovery through Cloudflare Tunnel and a conventional reverse proxy. This is a manual release gate, not established by source review.

## Validation and acceptance

Use in-memory SQLite or explicitly isolated temporary database fixtures. Avoid importing the production database singleton: it performs migrations and upgrade work at module load. No dev server or production data is needed for planning.

- Discovery returns JSON to logged-out callers; MCP challenges include reachable metadata; protocol errors never become `/login` redirects.
- Correct login/consent resumes the original validated transaction; denial returns the correct error/state; malformed redirects and external login-return URLs cannot cause redirects.
- Missing/plain PKCE, wrong verifier, reused/expired codes, mismatched client/redirect/resource, unknown scopes and unauthorized grant types fail.
- Refresh rotates; replay revokes the family; narrowing is allowed where supported; widening/audience changes fail; tokens survive legitimate restarts and cease working after revocation.
- Reduced-scope superusers cannot discover or execute out-of-scope tools/resources/prompts; current RBAC reductions and deleted users take effect immediately.
- MCP OAuth tokens cannot access REST, including admin routes; legacy REST/MCP tokens and cookie browser sessions preserve their existing behavior.
- Cover actual hook/route dispatch in addition to official MCP client integration, since the existing custom fetch harness skips hooks.
- Test migrations, concurrent code/refresh consumption, isolation between users/clients and bounded registration/metadata inputs.
- Run `bun run check`, relevant lint checks, OAuth tests and `bun run test:mcp` following runtime compatibility verification. Browser/client deployment checks remain the user's manual verification under the repository's verification policy.

The first release is complete when a user can connect ChatGPT, approve selected read scopes, query only currently permitted data, refresh/reconnect and revoke access, while existing configured-token clients continue to work and hosting remains portable.
