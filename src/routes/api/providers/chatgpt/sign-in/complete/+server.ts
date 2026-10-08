import { json } from "@sveltejs/kit";
import { completeFromPastedUrl } from "$lib/server/llm/chatgpt-sign-in.js";
import type { RequestHandler } from "./$types.js";

/**
 * Finishes a sign-in from the address the browser landed on, for an Akaun that
 * runs on another machine than the browser: the loopback redirect cannot reach
 * it there (chatgpt-sign-in.ts).
 */
export const POST: RequestHandler = async ({ locals, request }) => {
  if (!locals.user) return new Response("Unauthorized", { status: 401 });
  const body: unknown = await request.json().catch(() => null);
  const url =
    typeof body === "object" && body && "url" in body
      ? String((body as { url: unknown }).url ?? "")
      : "";
  if (!url) return json({ error: "Paste the address first" }, { status: 400 });
  try {
    return json(await completeFromPastedUrl(locals.user.id, url));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "ChatGPT sign-in failed";
    return json({ error: message }, { status: 400 });
  }
};
