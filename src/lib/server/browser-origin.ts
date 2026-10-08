/** Verify browser form provenance, including privacy policies that hide Origin.
 * Sec-Fetch-Site is browser-controlled; JavaScript cannot forge this header.
 * Never let it override an explicit foreign Origin or Referer.
 */
export function isSameOriginRequest(
  request: Request,
  expectedOrigin: string,
): boolean {
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const source = origin && origin !== "null" ? origin : referer;
  if (source) {
    try {
      return new URL(source).origin === expectedOrigin;
    } catch {
      return false;
    }
  }
  return request.headers.get("sec-fetch-site") === "same-origin";
}
