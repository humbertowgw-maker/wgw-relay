import test from "node:test";
import assert from "node:assert/strict";
import { GatewayEvents } from "../../protocol/src/index.js";
import { createRelayService } from "../src/relayService.js";

const inbound = {
  version: 1,
  event: GatewayEvents.INBOUND_MESSAGE,
  deviceId: "gateway_a",
  sentAt: "2026-09-13T21:00:00.000Z",
  payload: { messageId: "carrier-1", from: "+15551234567", to: "+15557654321", body: "I need help" },
};

const heartbeat = {
  version: 1,
  event: GatewayEvents.HEARTBEAT,
  deviceId: "gateway_a",
  sentAt: "2026-09-13T21:00:00.000Z",
  payload: { status: "ready", batteryPct: 88 },
};

function service(overrides = {}) {
  return createRelayService({
    authenticateGateway: async ({ token, deviceId }) => token === "valid" && deviceId === "gateway_a" ? { id: deviceId, tenantId: "tenant_a" } : null,
    recordHeartbeat: async () => {},
    recordInbound: async () => ({ conversationId: "conversation_1", duplicate: false }),
    claimOutbound: async () => null,
    recordOutboundResult: async () => {},
    ...overrides,
  });
}

test("rejects an unpaired gateway before an inbound message reaches a connector", async () => {
  let recorded = false;
  const relay = service({ recordInbound: async () => { recorded = true; } });
  const result = await relay.receive({ token: "wrong", envelope: inbound });
  assert.equal(result.status, 401);
  assert.equal(recorded, false);
});

test("records a heartbeat only after gateway authentication", async () => {
  let recorded = false;
  const relay = service({ recordHeartbeat: async () => { recorded = true; } });
  assert.equal((await relay.heartbeat({ token: "wrong", envelope: heartbeat })).status, 401);
  assert.equal(recorded, false);
  assert.deepEqual((await relay.heartbeat({ token: "valid", envelope: heartbeat })).body, { acknowledged: true });
  assert.equal(recorded, true);
});

test("records an authenticated inbound message once through the adapter", async () => {
  const relay = service();
  const result = await relay.receive({ token: "valid", envelope: inbound });
  assert.equal(result.status, 202);
  assert.deepEqual(result.body, { accepted: true, duplicate: false, conversationId: "conversation_1" });
});

test("returns no-content when an authenticated gateway has no outbound work", async () => {
  const relay = service();
  const result = await relay.nextOutbound({ token: "valid", deviceId: "gateway_a" });
  assert.equal(result.status, 204);
  assert.equal(result.body, null);
});
