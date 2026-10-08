// Codex subscription transport: required headers, streaming replies, refresh and failover.
import { isObject, codexHeaders } from "./chatgpt-oauth.js";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface TokenSource {
  accountId(): Promise<string>;
  /** A token that should still be valid. */
  token(): Promise<string>;
  /** Called after `rejected` got a 401. Returns a fresh token. */
  refresh(rejected: string): Promise<string>;
}

/** Fields the Codex backend refuses. The request fails if any of them is sent. */
const REJECTED_FIELDS = [
  "background",
  "conversation",
  "max_output_tokens",
  "max_tool_calls",
  "metadata",
  "moderation",
  "multi_agent",
  "prompt",
  "prompt_cache_retention",
  "safety_identifier",
  "temperature",
  "top_logprobs",
  "top_p",
  "truncation",
  "user",
];

/** Error codes in a failed response → the HTTP status reported to the SDK. */
const STATUS_BY_CODE: Record<string, number> = {
  rate_limit_exceeded: 429,
  server_error: 500,
};

const USAGE_LIMIT_CODES = new Set([
  "usage_limit_reached",
  "usage_limit_exceeded",
  "insufficient_quota",
]);
const USAGE_LIMIT_MESSAGE =
  "The ChatGPT subscription usage limit has been reached. Check usage in ChatGPT, or add another provider.";
const DEFAULT_REST_MS = 15 * 60_000;

/** Thrown, not returned, so the SDK does not retry it (see the header). */
export class ChatgptUsageLimitError extends Error {
  readonly until: number;
  constructor(until: number) {
    super(USAGE_LIMIT_MESSAGE);
    this.name = "ChatgptUsageLimitError";
    this.until = until;
  }
}

/** Provider id → when its plan may be asked again. */
const resting = new Map<string, number>();

/** Test seam. */
export function clearUsageLimitRest(): void {
  resting.clear();
}

function restUntil(retryAfter: string | null): number {
  const seconds = Number(retryAfter);
  if (retryAfter && Number.isFinite(seconds) && seconds > 0)
    return Date.now() + seconds * 1000;
  const date = retryAfter ? Date.parse(retryAfter) : NaN;
  return Number.isFinite(date) && date > Date.now()
    ? date
    : Date.now() + DEFAULT_REST_MS;
}

const MAX_STREAM_BYTES = 16 * 1024 * 1024;

/** `key` names the provider for the usage-limit rest. */
export function createChatgptFetch(
  tokens: TokenSource,
  upstream: FetchLike = fetch,
  key = "",
): FetchLike {
  return async (input, init = {}) => {
    const until = resting.get(key);
    if (until !== undefined) {
      if (until > Date.now()) throw new ChatgptUsageLimitError(until);
      resting.delete(key);
    }
    const isResponses = new URL(input).pathname.endsWith("/responses");
    const body =
      isResponses && typeof init.body === "string"
        ? rewriteBody(init.body)
        : init.body;
    const accountId = await tokens.accountId();
    const send = (token: string) => {
      const headers = new Headers(init.headers);
      for (const [name, value] of Object.entries(
        codexHeaders(token, accountId),
      ))
        headers.set(name, value);
      if (isResponses) headers.set("accept", "text/event-stream");
      return upstream(input, { ...init, headers, body });
    };

    let token = await tokens.token();
    let res = await send(token);
    if (res.status === 401) {
      await res.body?.cancel().catch(() => undefined);
      token = await tokens.refresh(token);
      res = await send(token);
    }
    try {
      if (!res.ok) return await normaliseError(res);
      return isResponses ? await collectStream(res) : res;
    } catch (error) {
      if (error instanceof ChatgptUsageLimitError)
        resting.set(key, error.until);
      throw error;
    }
  };
}

export function rewriteBody(raw: string): string {
  const body: unknown = JSON.parse(raw);
  if (!isObject(body)) return raw;
  for (const field of REJECTED_FIELDS) delete body[field];
  // Codex requires instructions. Preserve complex system prompts in the input
  // rather than losing receipt extraction rules during transport normalization.
  const contexts: string[] = [];
  if (typeof body.instructions === "string" && body.instructions)
    contexts.push(body.instructions);
  if (Array.isArray(body.input)) {
    const input = body.input.filter((item: unknown) => {
      if (
        !isObject(item) ||
        !["system", "developer"].includes(String(item.role))
      )
        return true;
      if (typeof item.content === "string") contexts.push(item.content);
      else if (Array.isArray(item.content)) {
        for (const part of item.content)
          if (isObject(part) && typeof part.text === "string")
            contexts.push(part.text);
      }
      return false;
    });
    if (contexts.length)
      input.unshift({
        role: "user",
        content: [{ type: "input_text", text: contexts.join("\n\n") }],
      });
    body.input = input;
  } else if (contexts.length) {
    body.input = [
      {
        role: "user",
        content: [{ type: "input_text", text: contexts.join("\n\n") }],
      },
      {
        role: "user",
        content: [{ type: "input_text", text: String(body.input ?? "") }],
      },
    ];
  }
  body.instructions =
    "Follow the supplied task instructions and return the requested output.";
  body.stream = true;
  body.store = false;
  return JSON.stringify(body);
}

/** Reads the event stream to its final event and returns that as one reply. */
async function collectStream(res: Response): Promise<Response> {
  if (!res.body)
    return errorResponse(
      502,
      "ChatGPT returned an empty response.",
      "invalid_stream",
    );
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let data: string[] = [];
  let seen = 0;
  // Each finished output item, in case the final response comes without them.
  const items: unknown[] = [];

  // One finished SSE event. Returns the reply once the stream has settled.
  const dispatch = (): Response | null => {
    const payload = data.join("\n");
    data = [];
    if (!payload || payload === "[DONE]") return null;
    let event: unknown;
    try {
      event = JSON.parse(payload);
    } catch {
      return errorResponse(
        502,
        "ChatGPT sent an unreadable response.",
        "invalid_stream",
      );
    }
    if (!isObject(event)) return null;
    if (event.type === "response.output_item.done" && event.item)
      items.push(event.item);
    // `incomplete` means the model stopped early. The response it carries says
    // why in `incomplete_details`, which the SDK turns into a finish reason.
    if (
      (event.type === "response.completed" ||
        event.type === "response.incomplete") &&
      isObject(event.response)
    ) {
      // With `store: false`, the final response is not guaranteed to repeat
      // its output. The items streamed before it are the same output.
      const response = event.response;
      if (
        (!Array.isArray(response.output) || response.output.length === 0) &&
        items.length > 0
      )
        response.output = items;
      return Response.json(response, { status: 200 });
    }
    if (event.type === "response.failed" || event.type === "error")
      return failedResponse(
        isObject(event.response) ? event.response : event,
        res.headers.get("retry-after"),
      );
    return null;
  };

  try {
    for (;;) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      seen += chunk.value?.length ?? 0;
      if (seen > MAX_STREAM_BYTES)
        return errorResponse(
          502,
          "The ChatGPT response was too large.",
          "response_too_large",
        );
      // An event ends at a blank line. Split on LF only and drop a trailing CR,
      // so a CRLF cut between two chunks is not read as an extra blank line.
      const lines = buffer.split("\n");
      buffer = chunk.done ? "" : (lines.pop() ?? "");
      for (const raw of lines) {
        const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
        if (line === "") {
          const result = dispatch();
          if (result) return result;
        } else if (line.startsWith("data:")) {
          data.push(line.slice(5).replace(/^ /, ""));
        }
      }
      if (chunk.done) {
        const result = dispatch();
        if (result) return result;
        return errorResponse(
          502,
          "The ChatGPT response ended before it finished. Try again.",
          "stream_interrupted",
        );
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

function failedResponse(
  source: Record<string, unknown>,
  retryAfter: string | null,
): Response {
  const error = isObject(source.error) ? source.error : source;
  const code = typeof error.code === "string" ? error.code : "response_failed";
  if (USAGE_LIMIT_CODES.has(code))
    throw new ChatgptUsageLimitError(restUntil(retryAfter));
  const message =
    typeof error.message === "string" && error.message
      ? error.message
      : "ChatGPT could not complete the request.";
  const status =
    STATUS_BY_CODE[code] ?? (/^(invalid|unsupported)_/.test(code) ? 400 : 500);
  return errorResponse(status, message, code);
}

/**
 * A rejected request keeps its status, but its body is rewritten into the shape
 * the SDK reads. The backend can answer with `detail` text instead of
 * `error.message`, and then the SDK would report only "Bad Request".
 */
async function normaliseError(res: Response): Promise<Response> {
  const text = await res.text().catch(() => "");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  const top = isObject(body) ? body : {};
  const nested = isObject(top.error) ? top.error : {};
  const code =
    typeof nested.code === "string"
      ? nested.code
      : typeof top.error === "string"
        ? top.error
        : typeof top.code === "string"
          ? top.code
          : `http_${res.status}`;
  const retryAfter = res.headers.get("retry-after");
  if (USAGE_LIMIT_CODES.has(code))
    throw new ChatgptUsageLimitError(restUntil(retryAfter));
  const message =
    typeof nested.message === "string"
      ? nested.message
      : typeof top.detail === "string"
        ? top.detail
        : typeof top.message === "string"
          ? top.message
          : `ChatGPT returned HTTP ${res.status}`;
  return errorResponse(
    STATUS_BY_CODE[code] ?? res.status,
    message,
    code,
    retryAfter,
  );
}

function errorResponse(
  status: number,
  message: string,
  code: string,
  retryAfter: string | null = null,
): Response {
  // `retry-after` is kept: the SDK's retry reads it.
  const headers = retryAfter ? { "retry-after": retryAfter } : undefined;
  return Response.json(
    { error: { message, type: code, code } },
    { status, headers },
  );
}
