# WGW Relay implementation plan

Relay becomes a working phone platform by completing each stage in order. A
screen, saved configuration, or healthy container is not treated as a live
phone capability until the affected path has a recorded verification.

## Phase 1 — secure operating foundation

Status: **in progress**

- [x] Tenant isolation, owner/manager/agent roles, invitation flow, and audit events.
- [x] Owner-controlled number plan, employee extensions, PBX call map, Relay
  device pairing, and visual Connections status.
- [x] Private PBX Bridge enrollment, revocation, authenticated heartbeat, and
  Bridge-reported call-map state.
- [ ] Durable tenant database and migrations.
- [ ] Hosted production environment, encrypted secret management, backups,
  structured logs, rate limits, email verification/recovery, and MFA.

Exit evidence: a tenant can create an owner account, recover access, retain
data through a restart, and see an auditable connection status from a deployed
environment.

## Phase 2 — phone-system activation

Status: **next**

- [ ] Install the private Bridge in the PBX network using the owner-issued
  enrollment credential.
- [ ] Read and report PBX health, extensions, voicemail health, and safe
  configuration drift without exposing PBX credentials to a browser.
- [ ] Add an explicit owner approval workflow for applying a desired call map,
  including a before/after readback and rollback record.
- [ ] Run controlled inbound-call, two-way-audio, fallback, voicemail, and
  employee-forwarding tests.

Exit evidence: the Connections tab records a fresh Bridge heartbeat and a
completed owner-approved test for the exact call path.

## Phase 3 — Relay phone and messaging

Status: **planned**

- [ ] Native business-phone Relay app or device-specific adapter for carrier
  SMS/MMS, delivery state, and voicemail capture.
- [ ] Secure outbound work polling, inbound idempotency, attachment handling,
  alerts, and opt-out enforcement.
- [ ] Controlled incoming/outgoing text tests from the customer-visible number.

Exit evidence: a real text reaches the assigned inbox, a permitted reply is
delivered from the business number, and the event trail is visible to the owner.

## Phase 4 — employee and concierge operations

Status: **planned**

- [ ] Employee schedules, availability, extension tests, transfer/assignment,
  contacts, templates, and callback tasks.
- [ ] Knowledge-backed AI concierge with approved answers, confidence limits,
  customer consent, human handoff, and full review history.
- [ ] Owner controls for notification policies, retention, exports, and tenant
  branding.

Exit evidence: a customer can receive an approved answer or reach the correct
employee while both the owner and employee can review the complete handoff.

## Phase 5 — platform and launch readiness

Status: **planned**

- [ ] Versioned connector/plugin SDK, self-host deployment guide, and hosted
  tenant provisioning.
- [ ] Billing/entitlements, support tooling, observability, incident playbooks,
  data lifecycle controls, and accessibility/end-to-end device testing.
- [ ] Jurisdiction-appropriate messaging, consent, emergency-calling, and
  privacy review before public launch.

Exit evidence: a new business can complete setup independently, and support can
prove the state of each device, route, message, and user permission.
