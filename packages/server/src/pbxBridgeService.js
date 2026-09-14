import { PbxBridgeEvents, validatePbxBridgeEnvelope } from "../../protocol/src/index.js";

function response(status, body = null) {
  return { status, body };
}

/**
 * Transport-neutral authentication boundary for a privately hosted PBX
 * Bridge. This initial contract is report-only: the bridge can attest its
 * health and whether the desired call map is applied, but cannot modify a
 * customer tenant through this endpoint.
 */
export function createPbxBridgeService(adapter) {
  for (const name of ["authenticatePbxBridge", "recordPbxBridgeHeartbeat"]) {
    if (typeof adapter?.[name] !== "function") throw new Error(`adapter.${name} is required`);
  }

  return {
    async heartbeat({ token, envelope }) {
      const validated = validatePbxBridgeEnvelope(envelope);
      if (!validated.ok) return response(400, { error: "Invalid PBX Bridge envelope", details: validated.errors });
      const { value } = validated;
      if (value.event !== PbxBridgeEvents.HEARTBEAT) return response(400, { error: "Only pbx_bridge.heartbeat is accepted here" });

      const bridge = await adapter.authenticatePbxBridge({ token, bridgeId: value.bridgeId });
      if (!bridge) return response(401, { error: "PBX Bridge authentication failed" });

      await adapter.recordPbxBridgeHeartbeat({ bridge, envelope: value });
      return response(200, { acknowledged: true });
    },
  };
}
