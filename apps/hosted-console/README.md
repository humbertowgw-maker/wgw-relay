# Hosted Relay console

This directory reserves the private, hosted application layer. It is not part
of the initial open-source release.

The hosted console will provide:

- organization and subscription setup;
- one-time device pairing;
- employee extension and personal-alert preferences;
- concierge knowledge and handoff controls;
- monitored delivery, opt-out, and audit views.

It consumes `@wgw-relay/protocol` and `@wgw-relay/server`, but it must never
require self-hosting customers to use the hosted service.
