# Security policy

## Supported version

Only the current `main` branch is supported while WGW Relay is pre-1.0.

## Reporting a vulnerability

Do not open a public issue for credentials, device-pairing bypasses, message
interception, tenant-isolation failures, or personal-data exposure. Use GitHub's
private vulnerability-reporting flow for this repository instead.

## Non-negotiable implementation rules

- A gateway secret must be generated once, stored only as a verifier, and never
  returned by a status endpoint.
- The relay server must authorize the gateway before it exposes queued work.
- Connectors must scope every conversation, assignment, and notification to a
  tenant.
- User sessions, invitation codes, gateway credentials, and passwords must be
  stored only as verifiers; a response may reveal a newly created code once,
  never through a later status or list endpoint.
- An agent must see only conversations assigned to that agent. Owner/manager
  coverage must be an explicit tenant role and must be auditable.
- A personal notification number is an alert destination, not permission to
  mirror a customer's private thread into consumer SMS.
- Opt-outs override AI and human outbound messaging until a permitted re-opt-in
  process completes.

## Reference-console boundary

The included console is an in-memory local reference by default. It can use a
private mounted volume for one-process persistence, but it has no database
migrations, email verification/recovery, MFA, distributed rate limiting, or
production monitoring. Do not scale it or publicly onboard customer data until
those layers are supplied.
