import { requireUser } from "@/lib/auth";
import { listSeats } from "@/lib/reservation/service";
import { logoutAction } from "@/app/actions/auth";
import { SeatCard } from "./SeatCard";

export const dynamic = "force-dynamic";

// The spec asks to "display 3 available seats". The inventory is larger so
// that the page can honour this requirement even after some seats have been
// reserved.
const MAX_AVAILABLE_SHOWN = 3;

function formatPrice(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency,
  }).format(cents / 100);
}

export default async function SeatsPage() {
  const user = await requireUser();
  const allSeats = await listSeats();

  const mine = allSeats.filter(
    (s) => s.activeReservation && s.activeReservation.userId === user.id,
  );
  const available = allSeats
    .filter((s) => !s.activeReservation)
    .slice(0, MAX_AVAILABLE_SHOWN);

  return (
    <main className="mx-auto w-full max-w-2xl p-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900">Pick a seat</h1>
          <p className="text-sm text-zinc-600">Signed in as {user.email}</p>
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

      {mine.length > 0 ? (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-600">
            Your reservations
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {mine.map((seat) => (
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
        </section>
      ) : null}

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-600">
          Available seats
        </h2>
        {available.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {available.map((seat) => (
              <SeatCard
                key={seat.id}
                seat={{
                  id: seat.id,
                  label: seat.label,
                  price: formatPrice(seat.priceCents, seat.currency),
                  activeReservation: null,
                }}
                currentUserId={user.id}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-zinc-200 bg-white p-6 text-center text-sm text-zinc-600">
            All seats are currently reserved. Try again in a few minutes —
            unconfirmed holds release automatically after 10 minutes.
          </div>
        )}
      </section>

      <p className="mt-6 text-xs text-zinc-500">
        Holds last 10 minutes. If you do not pay in time, the seat is released
        and re-appears here.
      </p>
    </main>
  );
}
