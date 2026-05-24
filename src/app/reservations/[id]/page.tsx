import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { getOwnReservation } from "@/lib/reservation/service";
import { NotYourReservation, ReservationNotFound } from "@/lib/reservation/errors";
import { CancelHoldButton } from "./CancelHoldButton";
import { BeginPaymentButton } from "./BeginPaymentButton";

export const dynamic = "force-dynamic";

const ParamsSchema = z.object({ id: z.string().uuid() });

function formatPrice(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency,
  }).format(cents / 100);
}

function formatRemaining(date: Date | null): string {
  if (!date) return "—";
  const ms = date.getTime() - Date.now();
  if (ms <= 0) return "expired";
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000)
    .toString()
    .padStart(2, "0");
  return `${m}:${s}`;
}

export default async function ReservationPage(props: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const parsed = ParamsSchema.safeParse(await props.params);
  if (!parsed.success) notFound();

  let row;
  try {
    row = await getOwnReservation({
      reservationId: parsed.data.id,
      userId: user.id,
    });
  } catch (err) {
    if (err instanceof ReservationNotFound || err instanceof NotYourReservation) {
      notFound();
    }
    throw err;
  }

  const { reservation, seat } = row;

  return (
    <main className="mx-auto w-full max-w-md p-6">
      <Link href="/seats" className="text-sm text-zinc-600 underline">
        ← All seats
      </Link>
      <h1 className="mt-3 text-2xl font-semibold">Reservation</h1>

      <div className="mt-4 space-y-3 rounded-lg border border-zinc-200 bg-white p-4">
        <Row label="Seat" value={`Seat ${seat.label}`} />
        <Row label="Price" value={formatPrice(seat.priceCents, seat.currency)} />
        <Row label="Status" value={statusLabel(reservation.status)} />
        {reservation.status === "held" ? (
          <Row
            label="Hold expires in"
            value={formatRemaining(reservation.holdExpiresAt)}
          />
        ) : null}
      </div>

      <div className="mt-4 space-y-2">
        {reservation.status === "held" ? (
          <>
            <BeginPaymentButton reservationId={reservation.id} />
            <CancelHoldButton reservationId={reservation.id} />
          </>
        ) : null}
        {reservation.status === "paying" ? (
          <p className="text-sm text-zinc-600">
            Payment in progress. If you closed the payment page, you can re-open
            it from the provider link in the seat card.
          </p>
        ) : null}
        {reservation.status === "confirmed" ? (
          <p className="rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            Your seat is confirmed.
          </p>
        ) : null}
        {(reservation.status === "expired" ||
          reservation.status === "cancelled" ||
          reservation.status === "failed") ? (
          <p className="rounded border border-zinc-300 bg-zinc-100 px-3 py-2 text-sm text-zinc-700">
            This reservation is closed ({reservation.status}). Pick another seat.
          </p>
        ) : null}
      </div>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-zinc-600">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function statusLabel(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
