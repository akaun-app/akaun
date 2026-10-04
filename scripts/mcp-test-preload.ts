import { plugin } from "bun";

// Vitest 4's worker startup is currently incompatible with Bun in this
// workspace. The MCP fixture specs use only these shared test APIs, so they
// can also run directly under Bun, without changing the default Vitest suite.
// This adapter deliberately provides no mocking or browser-test emulation.
plugin({
  name: "akaun-mcp-test-api",
  setup(builder) {
    builder.onResolve({ filter: /^vitest$/ }, () => ({
      path: "vitest",
      namespace: "akaun-mcp-test-api",
    }));
    builder.onLoad({ filter: /.*/, namespace: "akaun-mcp-test-api" }, () => ({
      contents:
        'export { afterEach, beforeEach, describe, expect, it } from "bun:test";',
      loader: "js",
    }));
  },
});
