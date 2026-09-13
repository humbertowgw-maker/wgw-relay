# Hosted Relay console

This is an Apache-2.0 reference operator console. It demonstrates the managed
product flow without making self-hosting customers depend on a WGW service.
A future WGW-managed deployment may add private account operations and tenant
infrastructure around the same protocol.

## What works now

- self-service organization registration and normal email/password sign-in;
- owner, manager, and agent roles with tenant-isolated inbox visibility;
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
