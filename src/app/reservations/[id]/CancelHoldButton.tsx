"use client";

import { cancelHoldAction } from "@/app/actions/reservation";

export function CancelHoldButton({ reservationId }: { reservationId: string }) {
  return (
    <form action={cancelHoldAction}>
      <input type="hidden" name="reservationId" value={reservationId} />
      <button
        type="submit"
        className="w-full rounded border border-zinc-300 py-2 text-sm font-medium hover:bg-zinc-100"
      >
        Cancel hold
      </button>
    </form>
  );
}
