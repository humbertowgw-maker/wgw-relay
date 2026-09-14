export const PROTOCOL_VERSION = 1;

export const GatewayEvents = Object.freeze({
  HEARTBEAT: "gateway.heartbeat",
  INBOUND_MESSAGE: "inbound.message",
  OUTBOUND_RESULT: "outbound.result",
});

export const PbxBridgeEvents = Object.freeze({
  HEARTBEAT: "pbx_bridge.heartbeat",
});

const knownEvents = new Set(Object.values(GatewayEvents));
const knownPbxBridgeEvents = new Set(Object.values(PbxBridgeEvents));
const E164 = /^\+[1-9]\d{7,14}$/;

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value, field, errors, maxLength = 4096) {
  if (typeof value !== "string" || !value.trim()) {
    errors.push(`${field} must be a non-empty string`);
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    errors.push(`${field} must be at most ${maxLength} characters`);
    return null;
  }
  return trimmed;
}

function e164(value, field, errors) {
  const phone = nonEmptyString(value, field, errors, 16);
  if (phone && !E164.test(phone)) errors.push(`${field} must be an E.164 phone number`);
  return phone;
}

export function validateEnvelope(input) {
  const errors = [];
  if (!isObject(input)) return { ok: false, errors: ["envelope must be an object"] };

  const version = input.version;
  if (version !== PROTOCOL_VERSION) errors.push(`version must be ${PROTOCOL_VERSION}`);

  const event = nonEmptyString(input.event, "event", errors, 64);
  if (event && !knownEvents.has(event)) errors.push("event is not supported");

  const deviceId = nonEmptyString(input.deviceId, "deviceId", errors, 128);
  const sentAt = nonEmptyString(input.sentAt, "sentAt", errors, 64);
  if (sentAt && Number.isNaN(Date.parse(sentAt))) errors.push("sentAt must be an ISO-8601 timestamp");

  const payload = input.payload;
  if (!isObject(payload)) errors.push("payload must be an object");

  if (event === GatewayEvents.INBOUND_MESSAGE && isObject(payload)) {
    nonEmptyString(payload.messageId, "payload.messageId", errors, 256);
    e164(payload.from, "payload.from", errors);
    e164(payload.to, "payload.to", errors);
    nonEmptyString(payload.body, "payload.body", errors, 1600);
  }

  if (event === GatewayEvents.HEARTBEAT && isObject(payload)) {
    const status = nonEmptyString(payload.status, "payload.status", errors, 32);
    if (status && !["ready", "degraded", "offline"].includes(status)) {
      errors.push("payload.status must be ready, degraded, or offline");
    }
    if (payload.batteryPct !== undefined && (!Number.isInteger(payload.batteryPct) || payload.batteryPct < 0 || payload.batteryPct > 100)) {
      errors.push("payload.batteryPct must be an integer from 0 to 100 when provided");
    }
  }

  if (event === GatewayEvents.OUTBOUND_RESULT && isObject(payload)) {
    nonEmptyString(payload.jobId, "payload.jobId", errors, 128);
    const status = nonEmptyString(payload.status, "payload.status", errors, 32);
    if (status && !["sent", "failed", "delivered"].includes(status)) {
      errors.push("payload.status must be sent, failed, or delivered");
    }
  }

  return errors.length
    ? { ok: false, errors }
    : { ok: true, value: { version, event, deviceId, sentAt, payload } };
}

/**
 * Validates the deliberately narrow, outbound-only heartbeat sent by a
 * privately hosted PBX Bridge. A heartbeat reports state; it can never change
 * a call map or submit PBX credentials to Relay.
 */
export function validatePbxBridgeEnvelope(input) {
  const errors = [];
  if (!isObject(input)) return { ok: false, errors: ["envelope must be an object"] };

  const version = input.version;
  if (version !== PROTOCOL_VERSION) errors.push(`version must be ${PROTOCOL_VERSION}`);

  const event = nonEmptyString(input.event, "event", errors, 64);
  if (event && !knownPbxBridgeEvents.has(event)) errors.push("event is not supported");

  const bridgeId = nonEmptyString(input.bridgeId, "bridgeId", errors, 128);
  const sentAt = nonEmptyString(input.sentAt, "sentAt", errors, 64);
  if (sentAt && Number.isNaN(Date.parse(sentAt))) errors.push("sentAt must be an ISO-8601 timestamp");

  const payload = input.payload;
  if (!isObject(payload)) errors.push("payload must be an object");
  if (event === PbxBridgeEvents.HEARTBEAT && isObject(payload)) {
    const status = nonEmptyString(payload.status, "payload.status", errors, 32);
    if (status && !["ready", "degraded", "offline"].includes(status)) errors.push("payload.status must be ready, degraded, or offline");
    const callMapState = nonEmptyString(payload.callMapState, "payload.callMapState", errors, 32);
    if (callMapState && !["not_applied", "applied", "drifted"].includes(callMapState)) errors.push("payload.callMapState must be not_applied, applied, or drifted");
    if (payload.agentVersion !== undefined) nonEmptyString(payload.agentVersion, "payload.agentVersion", errors, 64);
  }

  return errors.length
    ? { ok: false, errors }
    : { ok: true, value: { version, event, bridgeId, sentAt, payload } };
}

export function assertEnvelope(input) {
  const result = validateEnvelope(input);
  if (!result.ok) throw new Error(`Invalid relay envelope: ${result.errors.join("; ")}`);
  return result.value;
}
