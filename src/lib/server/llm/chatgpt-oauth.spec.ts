import { describe, it, expect } from "vitest";
import {
  requestDeviceCode,
  checkDeviceCode,
  parseStoredCredentials,
  refreshCredentials,
  CODEX_CLIENT_ID,
  CHATGPT_API_BASE,
  listChatgptModels,
} from "./chatgpt-oauth.js";
import { issuer, credentials, jwt } from "./__fixtures__/chatgpt-issuer.js";
describe("device protocol", () => {
  it("requests the public client and honors the server interval", async () => {
    const up = issuer({ interval: "7" });
    const device = await requestDeviceCode(up.fn);
    expect(device.intervalMs).toBe(7000);
    expect(device.verificationUrl).toBe("https://auth.openai.com/codex/device");
    expect(JSON.parse(String(up.fn.mock.calls[0][1]?.body))).toEqual({
      client_id: CODEX_CLIENT_ID,
    });
  });
  it("treats pending as pending and exchanges approval at the device redirect", async () => {
    const up = issuer({ pending: 1 });
    const device = await requestDeviceCode(up.fn);
    expect(await checkDeviceCode(device, up.fn)).toBeNull();
    const result = await checkDeviceCode(device, up.fn);
    expect(result).toMatchObject({
      version: 2,
      authKind: "codex-device",
      accountId: "account",
      subject: "person",
    });
    expect(up.exchanges[0].get("redirect_uri")).toBe(
      "https://auth.openai.com/deviceauth/callback",
    );
    expect(up.exchanges[0].has("resource")).toBe(false);
  });
  it("does not accept expired, wrong-audience or unsigned identities", async () => {
    for (const claims of [{ exp: 1 }, { aud: "other-app" }]) {
      const up = issuer({ idClaims: claims });
      await expect(
        checkDeviceCode(await requestDeviceCode(up.fn), up.fn),
      ).rejects.toThrow(/verified/);
    }
    const up = issuer({
      tokenOverrides: {
        id_token: jwt().split(".").slice(0, 2).join(".") + ".forged",
      },
    });
    await expect(
      checkDeviceCode(await requestDeviceCode(up.fn), up.fn),
    ).rejects.toThrow(/verified/);
  });
  it("rejects legacy credentials without deleting provider configuration", () => {
    expect(
      parseStoredCredentials(
        JSON.stringify({
          clientId: "dynamic-client",
          accessToken: "old",
          refreshToken: "old",
          expiresAt: 123,
        }),
      ),
    ).toBeNull();
    const current = credentials();
    expect(parseStoredCredentials(JSON.stringify(current))).toEqual(current);
  });
  it("rejects a refreshed token for another subscription account", async () => {
    await expect(
      refreshCredentials(
        credentials(),
        issuer({ accountId: "other-account" }).fn,
      ),
    ).rejects.toThrow(/account changed/);
  });
  it("loads the Codex model catalog with account headers", async () => {
    let input = "";
    let headers = new Headers();
    const models = await listChatgptModels(
      "token",
      async (url, init) => {
        input = url;
        headers = new Headers(init?.headers);
        return Response.json({
          models: [
            {
              slug: "vision-model",
              display_name: "Vision model",
              visibility: "list",
              supported_in_api: false,
            },
            { slug: "hidden", display_name: "Hidden", visibility: "hide" },
          ],
        });
      },
      "account",
    );
    expect(input.startsWith(CHATGPT_API_BASE + "/models?client_version=")).toBe(
      true,
    );
    expect(headers.get("chatgpt-account-id")).toBe("account");
    expect(models).toEqual([{ id: "vision-model", name: "Vision model" }]);
  });
});
