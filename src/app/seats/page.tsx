import { requireUser } from "@/lib/auth";
import { listSeats } from "@/lib/reservation/service";
import { logoutAction } from "@/app/actions/auth";
import { SeatCard } from "./SeatCard";

export const dynamic = "force-dynamic";

function formatPrice(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency,
  }).format(cents / 100);
}

export default async function SeatsPage() {
  const user = await requireUser();
  const seats = await listSeats();

  return (
    <main className="mx-auto w-full max-w-2xl p-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900">Pick a seat</h1>
          <p className="text-sm text-zinc-600">
            Signed in as {user.email}
          </p>
        </div>
        <form action={logoutAction}>
          <button
            type="submit"
            className="rounded border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100"
          >
            Sign out
          </button>
        </form>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {seats.map((seat) => (
          <SeatCard
            key={seat.id}
            seat={{
              id: seat.id,
              label: seat.label,
              price: formatPrice(seat.priceCents, seat.currency),
              activeReservation: seat.activeReservation,
            }}
            currentUserId={user.id}
          />
        ))}
      </div>

      <p className="mt-6 text-xs text-zinc-500">
        Holds last 10 minutes. If you do not pay in time, the seat is released.
      </p>
    </main>
  );
}
