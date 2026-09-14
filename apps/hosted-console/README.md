# Hosted Relay console

This is an Apache-2.0 reference operator console. It demonstrates the managed
product flow without making self-hosting customers depend on a WGW service.
A future WGW-managed deployment may add private account operations and tenant
infrastructure around the same protocol.

## What works now

- self-service organization registration and normal email/password sign-in;
- a plain-language number plan: business purpose, calls, texts, voicemail,
  call-forward destination, and owner alerts;
- owner, manager, and agent roles with tenant-isolated inbox visibility;
- owner-managed employee routes: extension reservation, employee call-forward
  number, future AI/PBX routing topics, and a linked account invitation;
- owner-wide text and voicemail alert preferences plus planned Mitel or generic
  SIP connection records (without browser-stored PBX credentials);
- an owner-controlled PBX call map: main business number to a primary
  extension, bounded ring time, then voicemail or owner follow-up;
- expiring, one-use teammate invitations and individual alert preferences;
- one-time phone-gateway pairing credentials (the stored value is hashed);
- assignment, opt-out locking, queued replies, delivery state, and audit events;
- gateway heartbeat, inbound-message, outbound-work, and result endpoints.

Run it locally with Node 20+:

```bash
npm run start:console
```

It listens on `127.0.0.1:8787`. The current store is intentionally in-memory,
so restarting clears the evaluation data. It is not a deployed managed service,
nor is it ready to store customer data in production. Durable tenant storage,
email verification and recovery, MFA, rate limiting, native gateway apps,
notifications, and concierge controls are the next implementation layers.
Saving a number plan does not activate carrier calls or voicemail by itself;
that requires a paired Relay phone or PBX connection. Saving an employee route,
owner alert rule, or phone-system plan also does not activate call forwarding,
SMS forwarding, voicemail capture, PBX registration, or AI handoff until that
connection is securely configured and verified. The PBX call map is an
auditable desired configuration; a private bridge must apply it to the actual
phone system before calls are rerouted.
