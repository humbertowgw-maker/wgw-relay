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
- A personal notification number is an alert destination, not permission to
  mirror a customer's private thread into consumer SMS.
- Opt-outs override AI and human outbound messaging until a permitted re-opt-in
  process completes.
