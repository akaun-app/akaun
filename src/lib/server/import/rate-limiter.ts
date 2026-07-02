// Global in-process gate: ensures no two outbound LLM requests (across all
// concurrently-processing import jobs) start closer together than intervalMs.
// State resets on server restart — same tradeoff as jsonSchemaUnsupportedModels
// in providers/index.ts.
let lastCallAt = 0;
let queue: Promise<void> = Promise.resolve();

export function throttleLLMCall(intervalMs: number): Promise<void> {
  if (intervalMs <= 0) return Promise.resolve();

  const turn = queue.then(async () => {
    const wait = lastCallAt + intervalMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCallAt = Date.now();
  });
  queue = turn;
  return turn;
}
