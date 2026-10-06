// Test-only: a stand-in AI for reading a long document in pieces (006 S4.6).
// Nothing in the app imports this file. Every figure is made up: no real
// document's values are used.
//
// The documents here print one transaction per line, as
// `2026-09-03 | TX-0007 | Order income | 12.34`. The stand-in model reads them
// the way a careful model would: it lists the transactions on the lines it is
// shown, and the header and total when it is asked for those. Options make it
// misbehave the ways a real model can: list rows from the context lines, miss
// a row, add rows with no line or a wrong one, be cut off, hang, or fail.

import { MockLanguageModelV4 } from "ai/test";

/** One transaction row of a made-up document. */
export interface FakeRow {
  date: string;
  reference: string;
  description: string;
  /** As printed, with its sign. */
  amount: string;
}

/** Made-up transaction rows: income and the odd charge, alternating. */
export function fakeRows(count: number, start = 1): FakeRow[] {
  return Array.from({ length: count }, (_, at) => {
    const n = start + at;
    const day = String((n % 28) + 1).padStart(2, "0");
    const charge = n % 5 === 0;
    return {
      date: `2026-09-${day}`,
      reference: `TX-${String(n).padStart(4, "0")}`,
      description: charge ? "Adjustment" : "Order income",
      amount: charge
        ? `-${(n % 7) + 1}.50`
        : `${10 + (n % 13)}.${String(n % 100).padStart(2, "0")}`,
    };
  });
}

/** A row as the document prints it. */
export function rowText(row: FakeRow): string {
  return `${row.date} | ${row.reference} | ${row.description} | ${row.amount}`;
}

/** The rows' amounts added up, in cents, signed as printed. */
export function rowsTotalMinor(rows: readonly FakeRow[]): number {
  return rows.reduce(
    (sum, row) => sum + Math.round(Number(row.amount) * 100),
    0,
  );
}

/**
 * A made-up wallet report as pages of text: three header lines, the rows
 * `perPage` to a page, and a closing line. Number it with
 * `numberDocumentLines`.
 */
export function fakeReportPages(
  rows: readonly FakeRow[],
  perPage = 1_000,
): string[] {
  const total = (rowsTotalMinor(rows) / 100).toFixed(2);
  const pages: string[][] = [
    [
      "Example Wallet Report",
      "Account holder: Example Shop",
      `Net total ${total}`,
    ],
  ];
  rows.forEach((row, at) => {
    if (at > 0 && at % perPage === 0) pages.push([]);
    pages[pages.length - 1].push(rowText(row));
  });
  pages[pages.length - 1].push("End of report");
  return pages.map((lines) => lines.join("\n"));
}

const ROW = /^L(\d+)│(\d{4}-\d{2}-\d{2}) \| (\S+) \| (.+?) \| (-?\d+\.\d{2})$/;

/** What kind of call the stand-in model was asked. */
export type FakeCallKind = "whole" | "header" | "lines";

/** One call the stand-in model was asked, as it understood it. */
export interface FakeCall {
  kind: FakeCallKind;
  /** The first and last line numbers the call owns; null when not a piece. */
  owned: [number, number] | null;
  /** Every numbered line the call was shown. */
  shown: number[];
  system: string;
  user: string;
}

export interface FakeReaderOptions {
  /** The header and total it reads. */
  header?: {
    counterparty?: string | null;
    date?: string | null;
    reference?: string | null;
    currency?: string | null;
    stated_total?: number | null;
  };
  /** List every row shown, context lines too, as a careless model would. */
  bleed?: boolean;
  /** Line numbers it never lists from its own range. */
  skipOwned?: ReadonlySet<number>;
  /** Line numbers of its own range it lists as ignored, not as items. */
  ignoreOwned?: ReadonlySet<number>;
  /** Items it adds to its answer on the given call (1-based). */
  extraOn?: Record<number, Record<string, unknown>[]>;
  /** Cut off any lines call that would list more rows than this. */
  truncateAbove?: number;
  /** Cut off the one-call reading of a whole document. */
  truncateWhole?: boolean;
  /** Hang until stopped on any lines call listing more rows than this. */
  hangAbove?: number;
  /** Hang until stopped on the given calls (1-based, counting every call). */
  hangOn?: ReadonlySet<number>;
  /** Cut off the given calls (1-based, counting every call). */
  truncateOn?: ReadonlySet<number>;
  /** Throw this on the given calls (1-based, counting every call). */
  failOn?: Record<number, unknown>;
  /** Output tokens reported for each row it lists. Default 10. */
  tokensPerRow?: number;
  /** Called before each answer, with the call's number (1-based). */
  onCall?: (call: number, seen: FakeCall) => void;
}

function textOfPrompt(prompt: unknown): { system: string; user: string } {
  let system = "";
  let user = "";
  for (const message of prompt as {
    role: string;
    content: string | { type: string; text?: string }[];
  }[]) {
    if (message.role === "system" && typeof message.content === "string") {
      system += message.content;
    } else if (message.role === "user" && Array.isArray(message.content)) {
      for (const part of message.content) {
        if (part.type === "text") user += part.text ?? "";
      }
    }
  }
  return { system, user };
}

function hang(signal: AbortSignal | undefined): Promise<never> {
  if (!signal) return Promise.reject(new Error("A hang needs an abort signal"));
  return new Promise((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    signal.addEventListener("abort", () => reject(signal.reason), {
      once: true,
    });
  });
}

/** The stand-in model, and every call it was asked. */
export function fakeReader(options: FakeReaderOptions = {}): {
  model: MockLanguageModelV4;
  calls: FakeCall[];
} {
  const calls: FakeCall[] = [];
  const model = new MockLanguageModelV4({
    doGenerate: async ({ prompt, abortSignal }) => {
      const { system, user } = textOfPrompt(prompt);
      const ownedMatch =
        /^This part's own lines are L(\d+)(?: to L(\d+))?\./.exec(user);
      const kind: FakeCallKind = ownedMatch
        ? "lines"
        : system.includes("Read only the document's header")
          ? "header"
          : "whole";
      const owned: [number, number] | null = ownedMatch
        ? [Number(ownedMatch[1]), Number(ownedMatch[2] ?? ownedMatch[1])]
        : null;
      const rows: Record<string, unknown>[] = [];
      const ignored: string[] = [];
      const shown: number[] = [];
      for (const line of user.split("\n")) {
        const numbered = /^L(\d+)│/.exec(line);
        if (numbered) shown.push(Number(numbered[1]));
        const match = ROW.exec(line);
        if (!match) continue;
        const number = Number(match[1]);
        const mine = !owned || (number >= owned[0] && number <= owned[1]);
        if (!mine && !options.bleed) continue;
        if (mine && owned && options.skipOwned?.has(number)) continue;
        if (mine && owned && options.ignoreOwned?.has(number)) {
          ignored.push(line.slice(line.indexOf("│") + 1));
          continue;
        }
        rows.push({
          description: match[4],
          amount: Number(match[5]),
          date: match[2],
          reference: match[3],
          source_line: number,
          category_account_id: null,
        });
      }
      const seen: FakeCall = { kind, owned, shown, system, user };
      calls.push(seen);
      const call = calls.length;
      options.onCall?.(call, seen);

      if (options.failOn && call in options.failOn) throw options.failOn[call];
      rows.push(...(options.extraOn?.[call] ?? []));

      if (
        options.hangOn?.has(call) ||
        (kind === "lines" &&
          options.hangAbove !== undefined &&
          rows.length > options.hangAbove)
      ) {
        return hang(abortSignal);
      }
      const truncated =
        options.truncateOn?.has(call) === true ||
        (kind === "lines" &&
          options.truncateAbove !== undefined &&
          rows.length > options.truncateAbove) ||
        (kind === "whole" && options.truncateWhole === true);

      const header = {
        counterparty: "Example Shop",
        date: "2026-09-30",
        reference: "WR-2026-09",
        currency: "MYR",
        ...options.header,
      };
      const statedTotal =
        options.header?.stated_total !== undefined
          ? options.header.stated_total
          : null;
      const answer =
        kind === "header"
          ? {
              header: {
                counterparty: header.counterparty,
                date: header.date,
                reference: header.reference,
                currency: header.currency,
              },
              stated_total: statedTotal,
            }
          : kind === "lines"
            ? { sections: { rows }, ignored }
            : {
                header: {
                  counterparty: header.counterparty,
                  date: header.date,
                  reference: header.reference,
                  currency: header.currency,
                },
                stated_total: statedTotal,
                sections: { rows },
                ignored,
              };
      const written = rows.length * (options.tokensPerRow ?? 10);
      const unified = truncated ? "length" : "stop";
      return {
        content: [
          {
            type: "text",
            text: truncated
              ? JSON.stringify(answer).slice(0, 20)
              : JSON.stringify(answer),
          },
        ],
        finishReason: { unified, raw: unified },
        usage: {
          inputTokens: {
            total: 100,
            noCache: 100,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: { total: written, text: written, reasoning: undefined },
        },
        warnings: [],
      };
    },
  });
  return { model, calls };
}
