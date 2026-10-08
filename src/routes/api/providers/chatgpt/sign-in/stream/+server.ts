import { eventStream } from "$lib/server/sse-stream.js";
import { chatgptSignInEvents } from "$lib/server/llm/chatgpt-sign-in.js";
import type { RequestHandler } from "./$types.js";

/**
 * Tells the Settings sheet that a sign-in finished. The loopback listener
 * finishes it outside any request, so the sheet cannot learn of it from a
 * reply. Opened when "Sign in with ChatGPT" is clicked and closed when the
 * result arrives. No snapshot: a sheet that missed the event pastes the
 * address instead.
 *
 *   sign-in-complete { state, connectionId, email }
 *   sign-in-failed   { state, message }
 *
 * Each person hears only their own sign-ins.
 */
export const GET: RequestHandler = ({ locals }) => {
  const user = locals.user;
  if (!user) return new Response("Unauthorized", { status: 401 });
  return eventStream([
    {
      emitter: chatgptSignInEvents,
      events: {
        "sign-in-complete": "sign-in-complete",
        "sign-in-failed": "sign-in-failed",
      },
      filter: (payload) => payload.userId === user.id,
    },
  ]);
};
