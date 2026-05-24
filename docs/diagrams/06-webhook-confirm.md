# Webhook handler (confirm / fail)

The mock provider POSTs `/api/webhooks/payment` once the user clicks **Succeed** or **Fail** on the checkout page. The handler is the most security-sensitive piece of code in the system because it's the only **unauthenticated** entry point that mutates real state.

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant MP as Mock provider page
    participant Web as Next.js (webhook)
    participant DB as Postgres

    U->>MP: clicks Succeed (or Fail / Cancel)
    MP->>Web: POST /api/webhooks/payment\n  X-Signature: sha256=<hmac>\n  body: { event_id, intent_id, type }

    Web->>Web: verify HMAC(body, MOCK_PAYMENT_WEBHOOK_SECRET)
    alt signature invalid
        Web->>DB: INSERT INTO audit_log (action='webhook_signature_failure', ...)
        Web-->>MP: 401 unauthorized
    else signature valid
        Web->>DB: INSERT INTO webhook_events\n  (provider='mock', event_id, payload)\n  ON CONFLICT (provider, event_id) DO NOTHING
        alt rowCount = 0 (duplicate delivery)
            Web-->>MP: 200 (idempotent no-op)
        else first delivery
            Web->>DB: BEGIN
            Web->>DB: SELECT * FROM payments\n  WHERE provider_intent_id=? FOR UPDATE
            DB-->>Web: payment row
            Web->>DB: SELECT * FROM reservations\n  WHERE id=payment.reservation_id FOR UPDATE
            DB-->>Web: reservation row

            Web->>Web: FSM.canTransition(reservation.status, event.type)
            alt legal (paying → confirmed)
                Web->>DB: UPDATE payments SET status='succeeded'
                Web->>DB: UPDATE reservations SET status='confirmed'
            else legal (paying → failed)
                Web->>DB: UPDATE payments SET status='failed'
                Web->>DB: UPDATE reservations SET status='failed'
            else illegal transition
                Web->>DB: INSERT INTO audit_log\n  (action='webhook_illegal_transition', detail)
            end
            Web->>DB: UPDATE webhook_events SET processed_at=now()
            Web->>DB: COMMIT
            Web-->>MP: 200
        end
    end

    Note over U,MP: After the click, the mock page redirects the user back to /reservations/{id}, which shows confirmed / failed.
```

## Why each step exists

| Step | Why |
|---|---|
| HMAC verify first | Reject unauthenticated callers immediately, before touching the DB. |
| `INSERT ... ON CONFLICT DO NOTHING` | Inbound idempotency. The first delivery wins; a re-delivery returns 200 without re-applying. |
| `FOR UPDATE` on payment **and** reservation | Serialise against any concurrent state change (e.g., a stuck-paying reconciliation running at the same time). |
| FSM legality check | A `paying → confirmed` event arriving for an already-`expired` reservation is illegal; we log it to `audit_log` for operator attention rather than silently writing a bad transition. |
| `UPDATE webhook_events SET processed_at` | Distinguishes "received but processing failed" from "processed". |
| Always return 200 on success or duplicate | Tells the provider not to retry. We return 5xx only for transient failures (DB unavailable). 4xx is for permanent failures the provider should not retry (bad signature, malformed body). |

## What the test proves

`tests/integration/webhook-idempotency.test.ts` posts the **same signed event 5 times in parallel** to the handler. Assertions:

- The reservation transitions exactly once (`paying → confirmed`).
- Exactly one row in `webhook_events` exists for that `event_id`.
- All five HTTP responses are 200.
- No `audit_log` entries for illegal transitions are written.
