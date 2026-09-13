# Relay protocol v1

Relay uses HTTPS JSON envelopes. A native gateway only speaks to the Relay
server; it never receives CRM, AI-provider, or PBX credentials.

Every request includes a device-authentication header chosen by the server
implementation and an envelope shaped like this:

```json
{
  "version": 1,
  "event": "inbound.message",
  "deviceId": "gateway_01H...",
  "sentAt": "2026-09-13T21:00:00.000Z",
  "payload": {
    "messageId": "carrier-message-id",
    "from": "+15551234567",
    "to": "+15557654321",
    "body": "Can I talk to Alex?"
  }
}
```

## Events

| Event | Direction | Purpose |
| --- | --- | --- |
| `gateway.heartbeat` | gateway → server | Records a paired gateway's readiness. |
| `inbound.message` | gateway → server | Idempotently delivers an SMS received by the business SIM. |
| `outbound.result` | gateway → server | Records sent, failed, or delivery status for a claimed message. |

A heartbeat payload contains a `status` of `ready`, `degraded`, or `offline`.
It may include `batteryPct` (0–100) for operator visibility. Gateways should
send a heartbeat after pairing and periodically while they can receive work.

The server returns a single outbound job through its authenticated polling
endpoint. An outbound job includes a destination, body, internal owner, and
idempotency key. It never includes a customer profile beyond what the gateway
needs to send the SMS.

## Connector responsibilities

1. Match a sender to a customer or create an unassigned conversation.
2. Apply STOP/opt-out before concierge or human outbound actions.
3. Route to an internal queue or employee identity.
4. Return a concise alert and secure-app link to the assigned employee.
5. Let the employee reply in the connector's inbox; queue the resulting
   business-number message back to the gateway.

The protocol does not mandate an AI model, a carrier, or a specific PBX.
