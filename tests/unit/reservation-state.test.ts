import { describe, expect, it } from "vitest";
import { canTransition, nextStatus } from "@/lib/reservation/state";
import type { ReservationStatus } from "@/lib/db/schema";

describe("reservation FSM", () => {
  it("held → paying via begin_payment", () => {
    expect(nextStatus("held", "begin_payment")).toBe("paying");
  });

  it("held → expired via expire_hold", () => {
    expect(nextStatus("held", "expire_hold")).toBe("expired");
  });

  it("held → cancelled via cancel_hold", () => {
    expect(nextStatus("held", "cancel_hold")).toBe("cancelled");
  });

  it("paying → confirmed via payment_succeeded", () => {
    expect(nextStatus("paying", "payment_succeeded")).toBe("confirmed");
  });

  it("paying → failed via payment_failed", () => {
    expect(nextStatus("paying", "payment_failed")).toBe("failed");
  });

  it("paying → expired via reconcile_expired", () => {
    expect(nextStatus("paying", "reconcile_expired")).toBe("expired");
  });

  it.each([
    ["confirmed", "begin_payment"],
    ["confirmed", "payment_succeeded"],
    ["confirmed", "cancel_hold"],
    ["expired", "begin_payment"],
    ["cancelled", "begin_payment"],
    ["failed", "begin_payment"],
    ["held", "payment_succeeded"], // skipping paying
    ["paying", "begin_payment"], // already paying
    ["paying", "cancel_hold"], // wrong actor; webhook drives this
  ] as const)("rejects illegal transition: %s + %s", (status, event) => {
    expect(nextStatus(status as ReservationStatus, event)).toBeNull();
    expect(canTransition(status as ReservationStatus, event)).toBe(false);
  });
});
