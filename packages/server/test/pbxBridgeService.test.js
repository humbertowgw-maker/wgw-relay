import test from "node:test";
import assert from "node:assert/strict";
import { PbxBridgeEvents } from "../../protocol/src/index.js";
import { createPbxBridgeService } from "../src/pbxBridgeService.js";

const heartbeat = {
  version: 1,
  event: PbxBridgeEvents.HEARTBEAT,
  bridgeId: "pbx_bridge_a",
  sentAt: "2026-09-13T21:00:00.000Z",
  payload: { status: "ready", callMapState: "applied", agentVersion: "0.1.0" },
};

test("records a PBX Bridge heartbeat only after private credential authentication", async () => {
  let recorded = false;
  const bridge = createPbxBridgeService({
    authenticatePbxBridge: async ({ token, bridgeId }) => token === "valid" && bridgeId === "pbx_bridge_a" ? { id: bridgeId, tenantId: "tenant_a" } : null,
    recordPbxBridgeHeartbeat: async () => { recorded = true; },
  });
  assert.equal((await bridge.heartbeat({ token: "wrong", envelope: heartbeat })).status, 401);
  assert.equal(recorded, false);
  assert.deepEqual((await bridge.heartbeat({ token: "valid", envelope: heartbeat })).body, { acknowledged: true });
  assert.equal(recorded, true);
});
