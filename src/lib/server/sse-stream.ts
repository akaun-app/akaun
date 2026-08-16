import type { EventEmitter } from "events";

/**
 * The server half of the SSE pattern, written once.
 *
 * Every stream endpoint does the same four things: encode each event as a JSON
 * frame carrying its own `type`, register a handler per event name, send a
 * heartbeat so an idle connection is not reaped by a proxy, and remove every
 * listener on cancel. Getting the last of those wrong is a listener leak that
 * only shows up as a warning hours later, which is exactly the kind of thing
 * worth having in one place.
 *
 * Frames carry `{ type, ... }` rather than a named SSE `event:` line, matching
 * the existing import/expense/income streams and the shared client registry in
 * $lib/sse.ts, which reads `type` off the parsed payload.
 */

export type StreamSource = {
  emitter: EventEmitter;
  /** Emitter event name → the `type` the frame carries. */
  events: Record<string, string>;
  /**
   * Send the `type` alone, dropping the payload. For a view that shows totals
   * rather than rows and only needs to know that something changed — sending it
   * a whole record it will not read is wasted bytes on every write.
   */
  signalOnly?: boolean;
  /**
   * Decides whether this frame is for this connection at all. Lets one emitter
   * feed several streams — the expenses list takes `kind = expense`, the income
   * list takes `kind = income` — without a second emitter to forget to fire.
   */
  filter?: (payload: Record<string, unknown>) => boolean;
};

const HEARTBEAT_MS = 15_000;

export function eventStream(sources: StreamSource[]): Response {
  const encoder = new TextEncoder();
  const encodeEvent = (data: object) =>
    encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
  const encodeComment = (text: string) => encoder.encode(`: ${text}\n\n`);

  let cleanup: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const registered: {
        emitter: EventEmitter;
        name: string;
        handler: (payload: object) => void;
      }[] = [];

      for (const source of sources) {
        for (const [name, type] of Object.entries(source.events)) {
          const handler = (payload: object) => {
            const record = (payload ?? {}) as Record<string, unknown>;
            if (source.filter && !source.filter(record)) return;
            try {
              controller.enqueue(
                encodeEvent(source.signalOnly ? { type } : { type, ...record }),
              );
            } catch {
              // The client went away mid-write; `cancel` does the tidying.
            }
          };
          source.emitter.on(name, handler);
          registered.push({ emitter: source.emitter, name, handler });
        }
      }

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encodeComment("heartbeat"));
        } catch {
          clearInterval(heartbeat);
        }
      }, HEARTBEAT_MS);

      cleanup = () => {
        clearInterval(heartbeat);
        for (const { emitter, name, handler } of registered) {
          emitter.off(name, handler);
        }
      };
    },
    cancel() {
      cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}
