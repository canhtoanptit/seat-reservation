import { afterEach, describe, expect, it } from "vitest";
import { LIMITS, _reset, allow, recordFailure, reset } from "@/lib/auth/rate-limit";

afterEach(() => _reset());

describe("rate limit token bucket", () => {
  it("allows up to the limit, then blocks", () => {
    const key = "ip:1.2.3.4";
    for (let i = 0; i < LIMITS.ip.max; i++) {
      expect(allow(key, LIMITS.ip)).toBe(true);
      recordFailure(key, LIMITS.ip);
    }
    expect(allow(key, LIMITS.ip)).toBe(false);
  });

  it("reset() clears a key", () => {
    const key = "ip-email:x:a@b.com";
    for (let i = 0; i < LIMITS.ipEmail.max; i++) {
      recordFailure(key, LIMITS.ipEmail);
    }
    expect(allow(key, LIMITS.ipEmail)).toBe(false);
    reset(key);
    expect(allow(key, LIMITS.ipEmail)).toBe(true);
  });

  it("IP and (IP,email) counters are independent", () => {
    recordFailure("ip:1.2.3.4", LIMITS.ip);
    expect(allow("ip-email:1.2.3.4:a@b.com", LIMITS.ipEmail)).toBe(true);
  });
});
