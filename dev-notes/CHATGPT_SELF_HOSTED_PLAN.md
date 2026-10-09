# ChatGPT device login for self-hosted Akaun

Status: implemented; automated validation recorded in the task. Live account and
remote deployment checks remain user verification.

## Goal and scope

Akaun is self-hosted only. A person using a browser on another computer must be
able to connect their ChatGPT subscription without a local callback listener,
port forwarding, or pasting a failed callback URL. Replace the existing ChatGPT
provider's dynamic-client sign-in and inference integration with a compatible
device-code integration. Keep the `chatgpt` provider type and provider settings.
This work does not remove the application's desktop packaging or other providers.

`ORIGIN` remains Akaun's public origin for its own requests and reverse-proxy
configuration. Device login does not require an Akaun OAuth callback URL.

## Evidence and compatibility checkpoint

The current OpenAI dynamic-client plan-sharing flow requires an HTTP loopback
callback on `127.0.0.1`, with only the port allowed to vary:
https://developers.openai.com/siwc/token-sharing-open-source/sign-in

OpenHands implements a separate Codex subscription flow: device authorization
through `auth.openai.com`, token exchange/refresh at `/oauth/token`, and inference
at `https://chatgpt.com/backend-api/codex/responses`:
https://github.com/OpenHands/software-agent-sdk/blob/main/openhands-sdk/openhands/sdk/llm/auth/openai.py

Before implementing, verify current upstream device-auth behavior, the client
identity usable by Akaun, and model/API capabilities. OpenHands is evidence of
an implementation, not proof that every endpoint or client ID is supported for
every application. Document the chosen integration and any dependency on Codex
compatibility endpoints. Do not assume old plan-sharing tokens or model discovery
work with the new API. Do not silently use browser login when device login is
unavailable; return a useful error. If a usable device flow cannot be established,
report the specific blocker instead of shipping a nonfunctional replacement.

## Intended user experience

1. In Settings, choose the ChatGPT subscription provider and start sign-in.
2. Akaun displays a short verification code, Copy button, OpenAI verification
   link, and expiry time. The person opens the link and approves on OpenAI.
3. The server checks authorization at OpenAI's prescribed interval. Akaun's
   browser receives progress and completion through SSE, without browser polling.
4. Once connected, show the verified account identity and available models.
5. Save commits the new connection to the provider, preserving the existing rule
   that sign-in alone does not overwrite a saved provider.
6. Cancel, expiry, unavailable device auth, rejected authorization, and network
   failures have explicit states and a Retry action. Reconnection to SSE restores
   the current attempt state, including completion that happened while offline.

## Implementation sequence

### 1. Device authorization protocol

Replace the loopback-specific protocol in `src/lib/server/llm/chatgpt-oauth.ts`
with helpers for requesting a device code, checking approval, exchanging the
issued authorization code, and refreshing credentials. Use fetch injection for
protocol tests. Validate response fields and expiry, honor the upstream interval,
and bound request timeouts and total attempt lifetime. Validate identity tokens
against issuer JWKS and the applicable issuer, audience, expiry and protocol
claims; derive account identity from verified claims. Check the current protocol
before deciding which claims and account fields are mandatory.

### 2. Server attempt lifecycle and endpoints

Refactor `chatgpt-sign-in.ts` into a device-attempt manager. Bind each random
attempt ID and completed connection to the initiating Akaun user. Retain device
authorization details and tokens server-side; expose only the code, verification
URL, expiry and sanitized status needed by the UI. Apply the existing provider
endpoint authorization rules to start, status stream, cancel and save.

Update `POST /api/providers/chatgpt/sign-in` to return the display information
and attempt ID. Extend the existing sign-in SSE endpoint with an owner-scoped
snapshot on connect/reconnect and terminal states. Add a cancellation endpoint.
Start the background authorization check independently of the SSE connection,
so closing/reopening the stream neither duplicates checks nor loses completion.
Limit concurrent attempts per user and make cancellation/consumption idempotent.
Abort requests and timers on cancellation, timeout or replacement, and discard
late upstream responses. Keep short-lived completed connections until Save.
An application restart expires pending attempts and asks the person to retry.

### 3. Credentials, refresh and upgrade behavior

Version the JSON stored in `llm_providers.oauth_credentials` and identify its
auth kind explicitly. Store the account identifier and token metadata required
by the new protocol. Reuse the current per-provider single-flight refresh logic;
persist rotated tokens together before allowing callers to use them. Keep
credentials out of public provider responses, SSE, error messages and logs.

Recognize existing unversioned dynamic-client credentials as legacy. Preserve
provider IDs, names, priorities and other configuration, but mark the connection
as requiring device sign-in and prevent legacy credentials from being sent to
the new backend. After reconnecting, require selection/validation of a compatible
model before Save. Replace legacy credentials only when the new connection is
saved. Remove the installation-wide `chatgpt.clientId` setting and its references;
clean up the obsolete setting through the established upgrade mechanism.

### 4. Inference and models

Update `model-factory.ts`, `chatgpt-fetch.ts` and the saved/unsaved model endpoints
for the chosen Codex-compatible API. Verify required account headers, request
fields, structured output support, streaming events, token usage and error
responses. Adapt the current stream collector where compatible. Keep all Akaun
features using the shared structured-call path and existing provider failover.

Use verified upstream model discovery where available. If it is unavailable,
provide a documented maintained list of compatible models rather than calling
the old `/v1/models` endpoint. Verify support for receipt/document image inputs
as well as text and JSON output; do not advertise unverified models or features.
Update usage-limit detection and cooldown behavior for the new backend instead
of retaining assumptions about plan-sharing error codes.

### 5. Settings UI and removal of the original flow

Replace callback-paste fields and handlers in
`src/routes/(app)/settings/+page.svelte` with the device-code UI. Wire cancellation
to the server and preserve the connected-account, model selection and Save flow.
Remove the callback listener, callback HTML pages, authorization URL builder,
callback parser, dynamic registration logic, loopback constants and
`/api/providers/chatgpt/sign-in/complete` route when their callers are replaced.
Remove obsolete tests and comments. Retain shared utilities only where still
used. No localhost sign-in fallback remains in the final implementation.

Update deployment/user documentation with the device login steps, relevant
ChatGPT account/workspace prerequisites, required outbound hosts, pending-attempt
restart behavior, and the one-time reconnection needed after upgrade. No new
inbound port or redirect URL configuration is required.

## Verification and completion criteria

- Protocol tests cover pending approval, success, expiry, cancellation, malformed
  responses, upstream interval handling and transient/final errors.
- Lifecycle tests cover cross-user isolation, reconnect snapshots, duplicate
  attempts, late completion after cancellation and one-time connection consumption.
- Credential tests cover legacy detection, validated account identity, rotated
  refresh tokens, concurrent refresh and saving a replacement connection.
- Inference tests cover the actual SDK request shape, required headers, streamed
  structured output, interrupted streams, 401 retry, usage limits and failover.
- Run relevant existing tests, `bun run check`, and applicable lint checks using
  isolated fixtures; never use the real `data/` database. Follow repository
  verification policy and report any pre-existing failures.
- The user verifies the complete behavior on a remote self-hosted instance: device
  sign-in, Save, model selection, image-based receipt processing, JSON output,
  refresh and reconnect after an application restart. Do not claim live upstream
  compatibility from stub tests alone.
- A final reference search finds no active loopback/paste sign-in implementation,
  dynamic-client registration or old ChatGPT inference endpoint. Existing ChatGPT
  providers clearly request reconnection and other providers continue to work.

Recommended delivery: one coherent change containing auth, inference, UI,
legacy handling and removal, so no intermediate release mixes incompatible tokens
and APIs. Removing the old flow is part of that change, after the replacement
passes the compatibility checkpoint.

## Validation record

- The repository's Vitest server project passes all 56 focused tests across the
  ChatGPT protocol, attempt lifecycle, token refresh, SDK transport, shared
  structured-call behavior and SSE snapshots (Node runner, one worker).
- `bun run check` passes with no errors or warnings.
- Standalone Bun smoke checks pass for the device protocol, RSA JWT verification,
  token expiry derivation and the cleanup migration using an in-memory database.
- Migration snapshot/journal continuity and `git diff --check` pass.
- Full `bun run lint` is blocked by existing formatting issues across 224 files.
  Targeted ESLint finds the same three pre-existing Settings-page errors as the
  original file; the changed server code has no lint errors.
- The Bun-based Vitest invocation stalled in this workspace and was stopped.
  The same focused tests passed through Node with the repository configuration;
  the production protocol was additionally exercised by the Bun smoke check.
- Live ChatGPT approval, account entitlements and remote receipt processing have
  not been exercised with a real account. These remain the deployment smoke test.
