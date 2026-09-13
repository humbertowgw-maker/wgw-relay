# WGW Relay

WGW Relay is an open-core bridge between a real business phone/SIM and the
software that should own its conversations. A dedicated phone runs a native
relay app; a connector routes messages to a CRM, PBX, help desk, or custom app.

It is intentionally provider-neutral. You can self-host the relay contract and
write your own connector, or use a hosted relay console when available.

## What it does

```text
Customer's phone <-> business SIM + Relay app <-> Relay server <-> your connector
                                                                  |
                                                          assigned employee inbox
```

- Keeps the business number as the customer's single visible number.
- Gives each conversation an internal owner without exposing an employee's
  personal number.
- Separates a device relay from CRM/PBX routing and AI concierge behavior.
- Makes delivery status, opt-outs, and assignment auditable.

WGW is the first connector. It maps a Relay owner to a WGW extension and sends
an employee an alert or secure inbox link; it does not copy the complete
customer thread into the employee's personal SMS application.

## Repository layout

- `packages/protocol` — dependency-free event envelope and validation helpers.
- `packages/server` — adapter contract for authenticating a paired device,
  accepting inbound messages, claiming outbound work, and recording delivery.
- `connectors/wgw` — WGW ownership, handoff, and notification contract.
- `apps/hosted-console` — the private hosted-console boundary and product plan.
- `docs/PROTOCOL.md` — wire-level API contract.

## Status

This first release is a tested protocol and server-adapter foundation. It does
not yet ship a mobile gateway, hosted account console, carrier entitlement, or
AI concierge. Those require device-specific implementation and live carrier
qualification before they are advertised as working.

## Development

Requires Node.js 20 or newer. No dependencies are required for the initial
protocol and adapter tests.

```bash
npm test
npm run check
```

## Open source and hosted service

The contents of this repository are licensed under Apache-2.0. A future hosted
Relay console may run this protocol while keeping account administration,
operations, customer data, and the WGW Relay brand outside this repository.

## Security model

- Pair each physical gateway explicitly; never put pairing secrets in a browser
  bundle or logs.
- Authenticate gateway requests before returning outbound work.
- Treat message bodies, phone numbers, and contact metadata as sensitive.
- Require explicit notification preferences before sending alerts to an
  employee's personal number.
- Process STOP/opt-out before an AI concierge or employee sends another SMS.

See [SECURITY.md](SECURITY.md) and [docs/PROTOCOL.md](docs/PROTOCOL.md).
