/**
 * Provider-agnostic types for payment integration. Swapping the mock provider
 * for real Stripe means implementing PaymentProvider with the Stripe SDK.
 */

export type Currency = string; // ISO 4217, 3 letters

export type CreateIntentInput = {
  amountCents: number;
  currency: Currency;
  /** Used by the provider for at-most-once intent creation on retry. */
  idempotencyKey: string;
  /** Where the user is returned after they choose Succeed/Fail/Cancel. */
  returnUrl: string;
  /** Free-form correlation; for us, this is the reservation id. */
  metadata: { reservationId: string };
};

export type CreateIntentResult = {
  intentId: string;
  /** The URL the user is redirected to in order to authorise payment. */
  clientUrl: string;
};

export type WebhookEvent = {
  eventId: string;
  intentId: string;
  type: "payment.succeeded" | "payment.failed" | "payment.cancelled";
  createdAt: string; // ISO
};

export interface PaymentProvider {
  readonly providerId: string; // "mock", "stripe"
  createIntent(input: CreateIntentInput): Promise<CreateIntentResult>;
  /**
   * Verify a webhook payload against its signature. Returns the parsed event
   * on success, throws on failure.
   */
  verifyWebhook(rawBody: string, signatureHeader: string | null): WebhookEvent;
}
