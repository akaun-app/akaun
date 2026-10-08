import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createReadServer } from "./server.js";
import type { ReadContext } from "./common.js";
import { scopeChallenge } from "./oauth-challenge.js";

export async function handleMcpRequest(
  request: Request,
  context: ReadContext,
  expectedOrigin: string,
): Promise<Response> {
  const headers = { "Cache-Control": "no-store" };
  if (!context.locals.user)
    return new Response("Unauthorized", {
      status: 401,
      headers: { ...headers, "WWW-Authenticate": 'Bearer realm="akaun-mcp"' },
    });
  // Exact origin includes scheme and port. Native clients may omit Origin.
  const origin = request.headers.get("Origin");
  if (origin !== null && origin !== expectedOrigin)
    return new Response("Forbidden (MCP origin check failed)", {
      status: 403,
      headers,
    });
  if (request.method !== "POST")
    return new Response("This stateless MCP endpoint accepts POST only.", {
      status: 405,
      headers: { ...headers, Allow: "POST" },
    });

  const challenge = await scopeChallenge(request, context.locals);
  if (challenge) return challenge;
  const server = createReadServer(context);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    maxRequestBodySize: 128 * 1024,
  });
  try {
    await server.connect(transport);
    const response = await transport.handleRequest(request);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } finally {
    // JSON mode resolves only after the result is serialized; safe to close.
    await server.close();
  }
}
