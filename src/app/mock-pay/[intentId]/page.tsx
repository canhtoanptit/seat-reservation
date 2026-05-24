/**
 * Mock provider checkout UI. Three buttons: Succeed / Fail / Cancel. Each one
 * triggers a server action that posts a signed webhook to the app, then
 * redirects the user back to the return_url.
 *
 * Gated to non-production; in production this 404s.
 */

import { notFound } from "next/navigation";
import { env } from "@/lib/env";
import { getIntent } from "@/lib/payment/mock-provider";
import { mockWebhookAction } from "./actions";

function formatPrice(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency,
  }).format(cents / 100);
}

export const dynamic = "force-dynamic";

export default async function MockCheckout(props: {
  params: Promise<{ intentId: string }>;
}) {
  if (!env.MOCK_PAYMENT_ENABLED) notFound();

  const { intentId } = await props.params;
  const intent = getIntent(intentId);
  if (!intent) notFound();

  if (intent.status !== "pending") {
    return (
      <main className="mx-auto w-full max-w-sm p-6">
        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <h1 className="text-lg font-semibold">Mock provider</h1>
          <p className="mt-2 text-sm text-zinc-600">
            This intent is already <code>{intent.status}</code>.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-sm p-6">
      <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <h1 className="text-lg font-semibold">Mock provider checkout</h1>
        <p className="mt-1 text-xs text-zinc-500">
          This page emulates a real payment provider (e.g. Stripe Checkout).
        </p>

        <dl className="mt-4 space-y-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-zinc-600">Amount</dt>
            <dd className="font-medium">
              {formatPrice(intent.amountCents, intent.currency)}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-zinc-600">Intent</dt>
            <dd className="font-mono text-xs">{intent.id}</dd>
          </div>
        </dl>

        <div className="mt-5 space-y-2">
          <form action={mockWebhookAction}>
            <input type="hidden" name="intentId" value={intent.id} />
            <input type="hidden" name="action" value="succeed" />
            <button
              type="submit"
              className="w-full rounded bg-emerald-700 py-2 text-sm font-medium text-white hover:bg-emerald-800"
            >
              Succeed
            </button>
          </form>
          <form action={mockWebhookAction}>
            <input type="hidden" name="intentId" value={intent.id} />
            <input type="hidden" name="action" value="fail" />
            <button
              type="submit"
              className="w-full rounded bg-red-700 py-2 text-sm font-medium text-white hover:bg-red-800"
            >
              Fail
            </button>
          </form>
          <form action={mockWebhookAction}>
            <input type="hidden" name="intentId" value={intent.id} />
            <input type="hidden" name="action" value="cancel" />
            <button
              type="submit"
              className="w-full rounded border border-zinc-300 py-2 text-sm hover:bg-zinc-100"
            >
              Cancel
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
