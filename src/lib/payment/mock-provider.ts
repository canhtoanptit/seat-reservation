/**
 * In-repo mock payment provider. Behaves like Stripe at the protocol level:
 *   - createIntent → server-side intent ID + client_url
 *   - user visits client_url and clicks Succeed / Fail / Cancel
 *   - mock POSTs an HMAC-signed webhook to our /api/webhooks/payment
 *
 * State (intents) lives in a process-local Map. Acceptable because:
 *   - the mock only mounts when NODE_ENV !== 'production'
 *   - assessment runs in a single process
 *
 * In production this would be Stripe; the PaymentProvider interface stays.
 */

import { z } from "zod";
import { randomBytes } from "node:crypto";
import { env } from "@/lib/env";
import {
  type CreateIntentInput,
  type CreateIntentResult,
  type PaymentProvider,
  type WebhookEvent,
} from "./types";
import { signBody, verifySignature } from "./hmac";

type IntentRecord = {
  id: string;
  amountCents: number;
  currency: string;
  reservationId: string;
  returnUrl: string;
  status: "pending" | "succeeded" | "failed" | "cancelled";
  createdAt: number;
};

const intents = new Map<string, IntentRecord>();

function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}

export const mockProvider: PaymentProvider = {
  providerId: "mock",

  async createIntent(input: CreateIntentInput): Promise<CreateIntentResult> {
    // Honour idempotency by key — return the same intent if one already exists.
    for (const existing of intents.values()) {
      if (
        existing.reservationId === input.metadata.reservationId &&
        existing.status === "pending"
      ) {
        return {
          intentId: existing.id,
          clientUrl: clientUrlFor(existing.id),
        };
      }
    }

    const id = newId("pi");
    intents.set(id, {
      id,
      amountCents: input.amountCents,
      currency: input.currency,
      reservationId: input.metadata.reservationId,
      returnUrl: input.returnUrl,
      status: "pending",
      createdAt: Date.now(),
    });
    return { intentId: id, clientUrl: clientUrlFor(id) };
  },

  verifyWebhook(rawBody: string, signatureHeader: string | null): WebhookEvent {
    if (!verifySignature(env.MOCK_PAYMENT_WEBHOOK_SECRET, rawBody, signatureHeader)) {
      throw new InvalidSignature();
    }
    const parsed = WebhookEventSchema.safeParse(JSON.parse(rawBody));
    if (!parsed.success) {
      throw new MalformedWebhookBody();
    }
    return parsed.data;
  },
};

function clientUrlFor(intentId: string): string {
  return `${env.MOCK_PAYMENT_BASE_URL}/mock-pay/${intentId}`;
}

// ─── Internal helpers used by the mock's UI and API routes ───────────────

export function getIntent(intentId: string): IntentRecord | null {
  return intents.get(intentId) ?? null;
}

export function setIntentStatus(
  intentId: string,
  status: IntentRecord["status"],
): void {
  const i = intents.get(intentId);
  if (!i) return;
  i.status = status;
}

export function signMockWebhook(body: string): string {
  return signBody(env.MOCK_PAYMENT_WEBHOOK_SECRET, body);
}

const WebhookEventSchema = z.object({
  eventId: z.string().min(1),
  intentId: z.string().min(1),
  type: z.enum(["payment.succeeded", "payment.failed", "payment.cancelled"]),
  createdAt: z.string(),
});

export class InvalidSignature extends Error {
  readonly code = "INVALID_SIGNATURE";
  constructor() {
    super("Invalid webhook signature");
  }
}

export class MalformedWebhookBody extends Error {
  readonly code = "MALFORMED_WEBHOOK_BODY";
  constructor() {
    super("Malformed webhook body");
  }
}

// Test-only: clear all intents between tests.
export function _resetIntents(): void {
  intents.clear();
}
