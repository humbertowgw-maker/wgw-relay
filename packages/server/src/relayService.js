import { GatewayEvents, validateEnvelope } from "../../protocol/src/index.js";

function response(status, body = null) {
  return { status, body };
}

/**
 * Creates a transport-neutral relay service. An HTTP, WebSocket, queue, or
 * native host can adapt these methods without embedding CRM or carrier logic
 * inside the gateway application.
 */
export function createRelayService(adapter) {
  for (const name of ["authenticateGateway", "recordHeartbeat", "recordInbound", "claimOutbound", "recordOutboundResult"]) {
    if (typeof adapter?.[name] !== "function") throw new Error(`adapter.${name} is required`);
  }

  async function authenticate(token, deviceId) {
    return adapter.authenticateGateway({ token, deviceId });
  }

  return {
    async heartbeat({ token, envelope }) {
      const validated = validateEnvelope(envelope);
      if (!validated.ok) return response(400, { error: "Invalid relay envelope", details: validated.errors });

      const { value } = validated;
      if (value.event !== GatewayEvents.HEARTBEAT) {
        return response(400, { error: "Only gateway.heartbeat is accepted here" });
      }

      const gateway = await authenticate(token, value.deviceId);
      if (!gateway) return response(401, { error: "Gateway authentication failed" });

      await adapter.recordHeartbeat({ gateway, envelope: value });
      return response(200, { acknowledged: true });
    },

    async receive({ token, envelope }) {
      const validated = validateEnvelope(envelope);
      if (!validated.ok) return response(400, { error: "Invalid relay envelope", details: validated.errors });

      const { value } = validated;
      if (value.event !== GatewayEvents.INBOUND_MESSAGE) {
        return response(400, { error: "Only inbound.message is accepted here" });
      }

      const gateway = await authenticate(token, value.deviceId);
      if (!gateway) return response(401, { error: "Gateway authentication failed" });

      const recorded = await adapter.recordInbound({ gateway, envelope: value });
      return response(202, {
        accepted: true,
        duplicate: Boolean(recorded?.duplicate),
        conversationId: recorded?.conversationId || null,
      });
    },

    async nextOutbound({ token, deviceId }) {
      const gateway = await authenticate(token, deviceId);
      if (!gateway) return response(401, { error: "Gateway authentication failed" });

      const job = await adapter.claimOutbound({ gateway });
      return job ? response(200, { job }) : response(204);
    },

    async acknowledgeOutbound({ token, envelope }) {
      const validated = validateEnvelope(envelope);
      if (!validated.ok) return response(400, { error: "Invalid relay envelope", details: validated.errors });

      const { value } = validated;
      if (value.event !== GatewayEvents.OUTBOUND_RESULT) {
        return response(400, { error: "Only outbound.result is accepted here" });
      }

      const gateway = await authenticate(token, value.deviceId);
      if (!gateway) return response(401, { error: "Gateway authentication failed" });

      await adapter.recordOutboundResult({ gateway, envelope: value });
      return response(200, { acknowledged: true });
    },
  };
}
