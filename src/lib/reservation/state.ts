/**
 * Reservation FSM — pure logic. Single source of truth for which transitions
 * are legal. Used by:
 *   - createHold:    none → held
 *   - beginPayment:  held → paying
 *   - cancelHold:    held → cancelled
 *   - expireHold:    held → expired
 *   - webhook:       paying → confirmed | failed
 *   - reconcile:     paying → confirmed | failed | expired
 */

import type { ReservationStatus } from "@/lib/db/schema";

export const ACTIVE_STATUSES = [
  "held",
  "paying",
  "confirmed",
] as const satisfies readonly ReservationStatus[];

export type ActiveStatus = (typeof ACTIVE_STATUSES)[number];

export function isActive(status: ReservationStatus): status is ActiveStatus {
  return (ACTIVE_STATUSES as readonly ReservationStatus[]).includes(status);
}

export type TransitionEvent =
  | "begin_payment"
  | "expire_hold"
  | "cancel_hold"
  | "payment_succeeded"
  | "payment_failed"
  | "reconcile_succeeded"
  | "reconcile_failed"
  | "reconcile_expired";

const TRANSITIONS: Record<
  ReservationStatus,
  Partial<Record<TransitionEvent, ReservationStatus>>
> = {
  held: {
    begin_payment: "paying",
    expire_hold: "expired",
    cancel_hold: "cancelled",
  },
  paying: {
    payment_succeeded: "confirmed",
    payment_failed: "failed",
    reconcile_succeeded: "confirmed",
    reconcile_failed: "failed",
    reconcile_expired: "expired",
  },
  confirmed: {},
  expired: {},
  cancelled: {},
  failed: {},
};

/**
 * Compute the next status. Returns null if the transition is illegal.
 * Callers should treat null as "do not write; log to audit_log".
 */
export function nextStatus(
  current: ReservationStatus,
  event: TransitionEvent,
): ReservationStatus | null {
  return TRANSITIONS[current][event] ?? null;
}

export function canTransition(
  current: ReservationStatus,
  event: TransitionEvent,
): boolean {
  return nextStatus(current, event) !== null;
}
