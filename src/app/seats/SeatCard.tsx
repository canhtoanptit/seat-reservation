"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import {
  createHoldAction,
  type ReservationActionState,
} from "@/app/actions/reservation";
import type { ReservationStatus } from "@/lib/db/schema";
import { ErrorDialog } from "./ErrorDialog";

type Props = {
  seat: {
    id: string;
    label: string;
    price: string;
    activeReservation: {
      id: string;
      userId: string;
      status: ReservationStatus;
    } | null;
  };
  currentUserId: string;
};

export function SeatCard({ seat, currentUserId }: Props) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<
    ReservationActionState,
    FormData
  >(createHoldAction, undefined);
  const [dismissed, setDismissed] = useState(false);

  // Every action invocation returns a fresh state object; reset dismissed so
  // a fresh error opens the dialog again even if the message is the same.
  useEffect(() => {
    setDismissed(false);
  }, [state]);

  const reservation = seat.activeReservation;
  const ownedByMe = reservation?.userId === currentUserId;
  const errorOpen = !!state?.error && !dismissed;

  const handleClose = () => {
    setDismissed(true);
    // Refresh the Server Component so the availability list reflects what
    // actually happened while the user was looking at the error.
    router.refresh();
  };

  return (
    <>
      <div className="rounded-lg border border-zinc-200 bg-white p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-lg font-semibold text-zinc-900">
            Seat {seat.label}
          </span>
          <span className="text-sm text-zinc-600">{seat.price}</span>
        </div>

        <div className="mt-3">
          {!reservation ? (
            <form action={formAction}>
              <input type="hidden" name="seatId" value={seat.id} />
              <button
                type="submit"
                disabled={pending}
                className="w-full rounded bg-zinc-900 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
              >
                {pending ? "Reserving…" : "Reserve"}
              </button>
            </form>
          ) : ownedByMe ? (
            <Link
              href={`/reservations/${reservation.id}`}
              className="block w-full rounded bg-emerald-700 py-2 text-center text-sm font-medium text-white hover:bg-emerald-800"
            >
              {reservation.status === "confirmed"
                ? "Confirmed — view"
                : reservation.status === "paying"
                  ? "Paying — view"
                  : "Your hold — continue"}
            </Link>
          ) : (
            <div className="w-full rounded border border-zinc-200 bg-zinc-100 py-2 text-center text-sm text-zinc-600">
              Taken
            </div>
          )}
        </div>
      </div>

      <ErrorDialog
        open={errorOpen}
        title="Seat unavailable"
        message={state?.error ?? ""}
        onClose={handleClose}
      />
    </>
  );
}
