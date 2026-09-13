import test from "node:test";
import assert from "node:assert/strict";
import { GatewayEvents, assertEnvelope, validateEnvelope } from "../src/index.js";

const inbound = {
  version: 1,
  event: GatewayEvents.INBOUND_MESSAGE,
  deviceId: "gateway_a",
  sentAt: "2026-09-13T21:00:00.000Z",
  payload: {
    messageId: "carrier-1",
    from: "+15551234567",
    to: "+15557654321",
    body: "Can I speak with Alex?",
  },
};

test("accepts a complete inbound message envelope", () => {
  const result = validateEnvelope(inbound);
  assert.equal(result.ok, true);
  assert.equal(result.value.payload.from, "+15551234567");
});

test("rejects an inbound message without E.164 identities", () => {
  const result = validateEnvelope({ ...inbound, payload: { ...inbound.payload, from: "5551234567" } });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /E.164/);
});

test("throws a useful error for unsupported events", () => {
  assert.throws(() => assertEnvelope({ ...inbound, event: "ai.reply" }), /event is not supported/);
});

test("validates gateway heartbeat readiness and optional battery percentage", () => {
  const result = validateEnvelope({
    version: 1,
    event: GatewayEvents.HEARTBEAT,
    deviceId: "gateway_a",
    sentAt: "2026-09-13T21:00:00.000Z",
    payload: { status: "ready", batteryPct: 101 },
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /batteryPct/);
});
