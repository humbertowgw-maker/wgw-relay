import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { createFileBackedRelayStore } from "../src/fileBackedStore.js";

test("retains tenant credentials and billing state through a single-instance restart", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "wgw-relay-store-"));
  const filePath = join(directory, "relay-store.json");
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  const first = createFileBackedRelayStore({ filePath, billingRequired: true });
  const registered = first.registerTenant({ organizationName: "WGW", name: "Owner", email: "owner@example.com", password: "owner-long-password" });
  first.applyStripeBillingEvent({ tenantId: registered.tenant.id, eventId: "evt_paid", status: "active", stripeCustomerId: "cus_123", stripeSubscriptionId: "sub_123" });
  const beforeRestart = first.authenticateUser(registered.sessionToken);
  first.configurePhoneSetup({ actor: beforeRestart, businessNumber: "+15557654321", callsEnabled: true, textsEnabled: true, voicemailEnabled: true, callForwardNumber: "+15551234567" });

  const persisted = readFileSync(filePath, "utf8");
  assert.match(persisted, /tenant_/);
  const restarted = createFileBackedRelayStore({ filePath, billingRequired: true });
  const signedIn = restarted.signIn({ email: "owner@example.com", password: "owner-long-password" });
  const afterRestart = restarted.snapshot({ actor: restarted.authenticateUser(signedIn.sessionToken) });
  assert.equal(afterRestart.tenant.billing.accessGranted, true);
  assert.equal(afterRestart.tenant.mainNumber, "+15557654321");
});
