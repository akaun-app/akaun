import { json } from "@sveltejs/kit";
import { db } from "$lib/server/db/client.js";
import { getSetting, setSetting, SETTING_KEYS } from "$lib/server/settings.js";
import { startSignIn } from "$lib/server/llm/chatgpt-sign-in.js";
import type { RequestHandler } from "./$types.js";

/**
 * Starts a Sign in with ChatGPT for a `chatgpt` provider. Returns the page to
 * open. The result arrives on `./stream`, or through `./complete` when the
 * person pastes the address they landed on.
 *
 * Checks only a signed-in user, the same as the other provider endpoints: the
 * Settings page that uses it checks no permission of its own.
 */
export const POST: RequestHandler = async ({ locals }) => {
  if (!locals.user) return new Response("Unauthorized", { status: 401 });
  try {
    const { state, authorizeUrl } = await startSignIn(locals.user.id, {
      savedClientId: getSetting(db, SETTING_KEYS.chatgptClientId) ?? undefined,
      onClientId: (clientId) =>
        setSetting(db, SETTING_KEYS.chatgptClientId, clientId),
    });
    return json({ state, authorizeUrl });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "ChatGPT sign-in could not start";
    return json({ error: message }, { status: 502 });
  }
};
