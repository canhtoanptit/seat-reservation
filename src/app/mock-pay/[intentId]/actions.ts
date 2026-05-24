"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { z } from "zod";
import { env } from "@/lib/env";
import {
  getIntent,
  setIntentStatus,
  signMockWebhook,
} from "@/lib/payment/mock-provider";
import { logger } from "@/lib/logger";

const ActionSchema = z.object({
  intentId: z.string().min(1),
  action: z.enum(["succeed", "fail", "cancel"]),
});

export async function mockWebhookAction(formData: FormData): Promise<void> {
  if (!env.MOCK_PAYMENT_ENABLED) return;

  const parsed = ActionSchema.safeParse({
    intentId: formData.get("intentId"),
    action: formData.get("action"),
  });
  if (!parsed.success) return;

  const intent = getIntent(parsed.data.intentId);
  if (!intent) return;

  const type =
    parsed.data.action === "succeed"
      ? "payment.succeeded"
      : parsed.data.action === "fail"
        ? "payment.failed"
        : "payment.cancelled";

  const event = {
    eventId: `evt_${randomUUID()}`,
    intentId: intent.id,
    type,
    createdAt: new Date().toISOString(),
  };
  const body = JSON.stringify(event);
  const signature = signMockWebhook(body);

  setIntentStatus(
    intent.id,
    parsed.data.action === "succeed"
      ? "succeeded"
      : parsed.data.action === "fail"
        ? "failed"
        : "cancelled",
  );

  // Deliver the webhook to our own /api/webhooks/payment endpoint. We do this
  // over HTTP rather than calling the handler directly so the integration is
  // faithful to a real provider: same network hop, same signature, same body.
  try {
    const res = await fetch(`${env.MOCK_PAYMENT_BASE_URL}/api/webhooks/payment`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature": signature,
      },
      body,
    });
    if (!res.ok) {
      logger.warn(
        { status: res.status, intentId: intent.id },
        "mock webhook delivery returned non-2xx",
      );
    }
  } catch (err) {
    logger.error({ err, intentId: intent.id }, "mock webhook delivery failed");
  }

  redirect(intent.returnUrl);
}
