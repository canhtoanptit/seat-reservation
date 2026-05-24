import { describe, expect, it } from "vitest";
import { signBody, verifySignature } from "@/lib/payment/hmac";

const SECRET = "test-secret-with-enough-entropy";
const OTHER_SECRET = "different-secret-with-enough-entropy";

describe("HMAC sign/verify", () => {
  it("round-trips a signed body", () => {
    const body = JSON.stringify({ eventId: "evt_1", type: "payment.succeeded" });
    const sig = signBody(SECRET, body);
    expect(verifySignature(SECRET, body, sig)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const body = JSON.stringify({ eventId: "evt_1" });
    const sig = signBody(SECRET, body);
    const tampered = body.replace("evt_1", "evt_2");
    expect(verifySignature(SECRET, tampered, sig)).toBe(false);
  });

  it("rejects the wrong secret", () => {
    const body = JSON.stringify({ eventId: "evt_1" });
    const sig = signBody(OTHER_SECRET, body);
    expect(verifySignature(SECRET, body, sig)).toBe(false);
  });

  it("rejects a missing signature", () => {
    expect(verifySignature(SECRET, "x", null)).toBe(false);
    expect(verifySignature(SECRET, "x", "")).toBe(false);
  });

  it("rejects a truncated signature", () => {
    const body = "x";
    const sig = signBody(SECRET, body);
    const truncated = sig.slice(0, -4);
    expect(verifySignature(SECRET, body, truncated)).toBe(false);
  });

  it("rejects a wholly non-hex signature", () => {
    expect(verifySignature(SECRET, "x", "sha256=not-hex-at-all")).toBe(false);
  });

  it("accepts sha256= prefix or raw hex", () => {
    const body = "x";
    const sig = signBody(SECRET, body);
    const raw = sig.replace(/^sha256=/, "");
    expect(verifySignature(SECRET, body, raw)).toBe(true);
  });
});
