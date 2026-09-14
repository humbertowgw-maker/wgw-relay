import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createHostedRelayStore } from "./store.js";

const MUTATING_METHODS = new Set([
  "registerTenant", "signOut", "updateProfile", "configurePhoneSetup", "configureOwnerDelivery",
  "createRouteProfile", "updateRouteProfile", "updateMyRouteProfile", "createPhoneConnection",
  "configurePbxCallMap", "createPbxBridge", "revokePbxBridge", "recordPbxBridgeHeartbeat",
  "createInvitation", "acceptInvitation", "pairGateway", "recordHeartbeat", "recordInbound",
  "claimOutbound", "recordOutboundResult", "assignConversation", "setOptOut", "queueReply",
  "recordBillingCheckout", "applyStripeBillingEvent",
]);

function reviveBuffer(_key, value) {
  if (value && value.type === "Buffer" && Array.isArray(value.data)) return Buffer.from(value.data);
  return value;
}

function loadState(path) {
  if (!existsSync(path)) return null;
  try {
    const state = JSON.parse(readFileSync(path, "utf8"), reviveBuffer);
    if (state?.version !== 1 || !state.state || typeof state.state !== "object") throw new Error("unsupported format");
    return state;
  } catch {
    throw new Error(`Relay data file could not be read safely: ${path}`);
  }
}

/**
 * Durable single-process storage for an initial hosted deployment. It writes
 * atomically to a mounted volume; a multi-instance deployment must replace it
 * with the planned database adapter before it is scaled horizontally.
 */
export function createFileBackedRelayStore({ filePath, ...options }) {
  if (typeof filePath !== "string" || !filePath.trim()) throw new Error("RELAY_DATA_PATH is required for file-backed storage");
  const path = resolve(filePath);
  const parent = dirname(path);
  if (!existsSync(parent)) throw new Error(`Relay data directory does not exist: ${parent}`);
  const store = createHostedRelayStore({ ...options, persistedState: loadState(path) });

  function persist() {
    const temporaryPath = `${path}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(store.exportPersistentState())}\n`, { mode: 0o600 });
    renameSync(temporaryPath, path);
    chmodSync(path, 0o600);
  }

  return new Proxy(store, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof property !== "string" || !MUTATING_METHODS.has(property) || typeof value !== "function") return value;
      return (...args) => {
        const result = value.apply(target, args);
        persist();
        return result;
      };
    },
  });
}
