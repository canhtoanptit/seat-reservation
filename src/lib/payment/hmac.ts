import { createHmac, timingSafeEqual } from "node:crypto";

const SIG_PREFIX = "sha256=";

export function signBody(secret: string, body: string): string {
  const digest = createHmac("sha256", secret).update(body).digest("hex");
  return SIG_PREFIX + digest;
}

/**
 * Verify a signature header against a body using HMAC-SHA256.
 * Constant-time. Returns true on match.
 *
 * Accepts either "sha256=<hex>" or "<hex>" for tolerance.
 */
export function verifySignature(
  secret: string,
  body: string,
  signatureHeader: string | null,
): boolean {
  if (!signatureHeader) return false;
  const provided = signatureHeader.startsWith(SIG_PREFIX)
    ? signatureHeader.slice(SIG_PREFIX.length)
    : signatureHeader;

  const expected = createHmac("sha256", secret).update(body).digest("hex");

  if (provided.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(provided, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}
