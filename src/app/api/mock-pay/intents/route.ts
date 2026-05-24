/**
 * Mock provider API: create an intent. Behaves like POST /v1/payment_intents on
 * Stripe. Gated to non-production; in production this route 404s.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { mockProvider } from "@/lib/payment/mock-provider";

const BodySchema = z.object({
  amountCents: z.number().int().positive(),
  currency: z.string().length(3),
  idempotencyKey: z.string().min(8),
  returnUrl: z.string().url(),
  metadata: z.object({ reservationId: z.string().uuid() }),
});

export async function POST(req: Request) {
  if (!env.MOCK_PAYMENT_ENABLED) {
    return new NextResponse(null, { status: 404 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const intent = await mockProvider.createIntent(parsed.data);
  return NextResponse.json(intent);
}
