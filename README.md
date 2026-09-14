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
- `apps/hosted-console` — a runnable reference operator console for the managed flow.
- `docs/PROTOCOL.md` — wire-level API contract.

## Status

This release has a tested relay protocol/server adapter plus a local runnable
multi-tenant reference console. It includes tenant-scoped user sessions,
owner/manager/agent permissions, invitations, profile alert preferences, and
private assigned inboxes. Owners can create employee route profiles with
extensions, call-forward destinations, AI/PBX handoff topics, and secure
account invitations; they can also save organization-wide text/voicemail alert
rules and Mitel or generic SIP connection plans. Owners can save an explicit
business call map: business number → primary extension → voicemail or owner
follow-up, with a bounded ring time. The owner-only Connections tab visually
maps the desired call path and clearly separates verified Relay-device
heartbeats from saved routes that still await private activation. The setup flow records a number plan for
calls, texts, voicemail, call forwarding, and alerts. It does not yet ship a
native mobile gateway, durable hosted tenant storage, a deployed account
console, carrier entitlement, live PBX/SIP provisioning, voicemail
capture/transcription, notification delivery, or AI concierge. Those require device-specific
implementation and live carrier qualification before they are advertised as
working.

## Development

Requires Node.js 20 or newer. No dependencies are required for the initial
protocol and adapter tests.

```bash
npm test
npm run check
```

Run `npm run start:console` to evaluate the reference console locally. It binds
to localhost and uses in-memory evaluation data; it is not a production
deployment.

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
- Give agents only their assigned conversations; owner/manager coverage is an
  explicit role, not the default team view.
- Process STOP/opt-out before an AI concierge or employee sends another SMS.

See [SECURITY.md](SECURITY.md) and [docs/PROTOCOL.md](docs/PROTOCOL.md).
