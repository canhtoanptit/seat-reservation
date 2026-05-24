"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { beginPayment } from "@/lib/reservation/payment-service";
import {
  HoldExpired,
  IllegalState,
  NotYourReservation,
  ReservationError,
  ReservationNotFound,
} from "@/lib/reservation/errors";
import { logger } from "@/lib/logger";

const UuidSchema = z.string().uuid();

export type ReservationActionState = { error?: string } | undefined;

export async function beginPaymentAction(
  _state: ReservationActionState,
  formData: FormData,
): Promise<ReservationActionState> {
  const user = await requireUser();
  const parsed = UuidSchema.safeParse(formData.get("reservationId"));
  if (!parsed.success) return { error: "Invalid reservation." };

  try {
    const result = await beginPayment({
      reservationId: parsed.data,
      userId: user.id,
    });
    redirect(result.clientUrl);
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      "digest" in err &&
      typeof (err as { digest: unknown }).digest === "string" &&
      ((err as { digest: string }).digest).startsWith("NEXT_REDIRECT")
    ) {
      throw err;
    }
    if (err instanceof HoldExpired) {
      return { error: "Your hold expired. Please choose a seat again." };
    }
    if (err instanceof ReservationNotFound || err instanceof NotYourReservation) {
      return { error: "Reservation not found." };
    }
    if (err instanceof IllegalState) {
      return { error: err.message };
    }
    if (err instanceof ReservationError) {
      return { error: err.message };
    }
    logger.error({ err }, "beginPaymentAction failed");
    return { error: "Could not start payment. Please try again." };
  }
}
