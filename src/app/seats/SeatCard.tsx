"use client";

import Link from "next/link";
import { useActionState } from "react";
import {
  createHoldAction,
  type ReservationActionState,
} from "@/app/actions/reservation";
import type { ReservationStatus } from "@/lib/db/schema";

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
  const [state, formAction, pending] = useActionState<
    ReservationActionState,
    FormData
  >(createHoldAction, undefined);

  const reservation = seat.activeReservation;
  const ownedByMe = reservation?.userId === currentUserId;

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4">
      <div className="flex items-baseline justify-between">
        <span className="text-lg font-semibold">Seat {seat.label}</span>
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
            {state?.error ? (
              <p className="mt-2 rounded border border-red-300 bg-red-50 px-2 py-1 text-xs text-red-800">
                {state.error}
              </p>
            ) : null}
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
  );
}
