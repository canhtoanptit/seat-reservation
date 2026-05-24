/**
 * Inbound webhook from the payment provider.
 *
 * Responsibilities, in order:
 *   1. Verify HMAC signature (401 on failure + audit_log entry)
 *   2. Idempotency via webhook_events (provider, event_id) UNIQUE
 *   3. Advance the reservation FSM under a transaction with FOR UPDATE
 *
 * Returns:
 *   200 on success or duplicate (so provider doesn't retry)
 *   200 on unknown_intent / illegal_transition (we audit-log them; retries
 *       wouldn't change anything)
 *   401 on signature failure
 *   400 on malformed body
 *   5xx on transient errors (provider should retry)
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auditLog } from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import {
  InvalidSignature,
  MalformedWebhookBody,
  mockProvider,
} from "@/lib/payment/mock-provider";
import { processWebhook } from "@/lib/reservation/payment-service";

export async function POST(req: Request) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-signature");

  let event;
  try {
    event = mockProvider.verifyWebhook(rawBody, signature);
  } catch (err) {
    if (err instanceof InvalidSignature) {
      await db.insert(auditLog).values({
        actor: "webhook",
        action: "webhook_signature_failure",
        detail: { bodyPreview: rawBody.slice(0, 200) },
      });
      logger.warn({ ip: req.headers.get("x-forwarded-for") }, "webhook signature failure");
      return new NextResponse(null, { status: 401 });
    }
    if (err instanceof MalformedWebhookBody) {
      return NextResponse.json({ error: "malformed body" }, { status: 400 });
    }
    logger.error({ err }, "webhook verify failed unexpectedly");
    return new NextResponse(null, { status: 400 });
  }

  try {
    const result = await processWebhook(mockProvider.providerId, event);
    // Always 200 unless we want the provider to retry.
    logger.info({ result, eventId: event.eventId }, "webhook processed");
    return NextResponse.json({ ok: true, result }, { status: 200 });
  } catch (err) {
    logger.error({ err, event }, "webhook processing failed transiently");
    return NextResponse.json({ error: "transient failure" }, { status: 503 });
  }
}
