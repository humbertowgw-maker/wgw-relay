# WGW connector

The WGW connector maps a Relay conversation to the existing WGW phone-system
model.

## Mapping

| Relay concept | WGW concept |
| --- | --- |
| `deviceId` | paired shared business phone |
| tenant | WGW organization |
| conversation owner | active internal extension / assigned rep |
| employee alert | WGW notification plus a secure inbox link |
| outbound job | existing local-SIM message queue |

## Handoff behavior

1. An inbound message is deduplicated by gateway and carrier message ID.
2. STOP-like opt-outs are applied before any automatic response.
3. A concierge may answer only from approved knowledge or ask a routing question.
4. On human handoff, WGW assigns one extension and sends that employee a short
   alert. The customer keeps the same business-number thread.
5. The employee replies from WGW; the connector queues the business-number SMS
   to the Relay gateway.

The connector must not treat a personal notification number as a second copy of
the customer conversation. It is for an alert, call-forward target, or secure
link only.
