"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import {
  cancelHold,
  createHold,
} from "@/lib/reservation/service";
import {
  HoldExpired,
  IllegalState,
  NotYourReservation,
  ReservationError,
  ReservationNotFound,
  SeatNotFound,
  SeatUnavailable,
} from "@/lib/reservation/errors";
import { logger } from "@/lib/logger";

const UuidSchema = z.string().uuid();

export type ReservationActionState = { error?: string } | undefined;

export async function createHoldAction(
  _state: ReservationActionState,
  formData: FormData,
): Promise<ReservationActionState> {
  const user = await requireUser();
  const parsed = UuidSchema.safeParse(formData.get("seatId"));
  if (!parsed.success) return { error: "Invalid seat." };

  try {
    const reservation = await createHold({
      seatId: parsed.data,
      userId: user.id,
    });
    revalidatePath("/seats");
    redirect(`/reservations/${reservation.id}`);
  } catch (err) {
    if (err instanceof SeatUnavailable) {
      revalidatePath("/seats");
      return { error: "This seat was just taken. Please choose another." };
    }
    if (err instanceof SeatNotFound) {
      return { error: "Seat not found." };
    }
    if (err instanceof ReservationError) {
      return { error: err.message };
    }
    // Re-throw NEXT_REDIRECT
    if (err instanceof Error && err.message === "NEXT_REDIRECT") throw err;
    // redirect throws an object with a digest; let it propagate
    if (
      typeof err === "object" &&
      err !== null &&
      "digest" in err &&
      typeof (err as { digest: unknown }).digest === "string" &&
      ((err as { digest: string }).digest as string).startsWith("NEXT_REDIRECT")
    ) {
      throw err;
    }
    logger.error({ err }, "createHoldAction failed");
    return { error: "Something went wrong. Please try again." };
  }
}

export async function cancelHoldAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = UuidSchema.safeParse(formData.get("reservationId"));
  if (!parsed.success) redirect("/seats");

  try {
    await cancelHold({ reservationId: parsed.data, userId: user.id });
  } catch (err) {
    if (
      err instanceof ReservationNotFound ||
      err instanceof NotYourReservation ||
      err instanceof IllegalState ||
      err instanceof HoldExpired
    ) {
      // best-effort; surface a generic error via the URL? For now, redirect.
      logger.warn({ err: err.message }, "cancelHoldAction soft-failed");
    } else if (
      typeof err === "object" &&
      err !== null &&
      "digest" in err &&
      typeof (err as { digest: unknown }).digest === "string" &&
      ((err as { digest: string }).digest as string).startsWith("NEXT_REDIRECT")
    ) {
      throw err;
    } else {
      logger.error({ err }, "cancelHoldAction failed");
    }
  }
  revalidatePath("/seats");
  redirect("/seats");
}
