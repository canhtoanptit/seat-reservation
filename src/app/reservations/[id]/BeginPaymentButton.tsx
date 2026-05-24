"use client";

import { useActionState } from "react";
import {
  beginPaymentAction,
  type ReservationActionState,
} from "@/app/actions/payment";

export function BeginPaymentButton({ reservationId }: { reservationId: string }) {
  const [state, formAction, pending] = useActionState<
    ReservationActionState,
    FormData
  >(beginPaymentAction, undefined);

  return (
    <form action={formAction}>
      <input type="hidden" name="reservationId" value={reservationId} />
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded bg-zinc-900 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
      >
        {pending ? "Starting payment…" : "Pay now"}
      </button>
      {state?.error ? (
        <p className="mt-2 rounded border border-red-300 bg-red-50 px-2 py-1 text-xs text-red-800">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
