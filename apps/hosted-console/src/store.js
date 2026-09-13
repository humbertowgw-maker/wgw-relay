import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

const E164 = /^\+[1-9]\d{7,14}$/;
const EXTENSION = /^[A-Za-z0-9_-]{1,16}$/;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function text(value, field, maxLength = 1600) {
  if (typeof value !== "string" || !value.trim()) throw fail("VALIDATION", `${field} is required`);
  const trimmed = value.trim();
  if (trimmed.length > maxLength) throw fail("VALIDATION", `${field} is too long`);
  return trimmed;
}

function optionalPhone(value, field) {
  if (value === undefined || value === null || value === "") return null;
  const phone = text(value, field, 16);
  if (!E164.test(phone)) throw fail("VALIDATION", `${field} must be an E.164 phone number`);
  return phone;
}

function requiredPhone(value, field) {
  const phone = optionalPhone(value, field);
  if (!phone) throw fail("VALIDATION", `${field} is required`);
  return phone;
}

function digest(secret) {
  return createHash("sha256").update(secret).digest();
}

function sameSecret(expectedHash, token) {
  if (typeof token !== "string" || !token) return false;
  const actualHash = digest(token);
  return expectedHash.length === actualHash.length && timingSafeEqual(expectedHash, actualHash);
}

function publicEmployee(employee) {
  return {
    id: employee.id,
    name: employee.name,
    extension: employee.extension,
    role: employee.role,
    alertPhoneConfigured: Boolean(employee.alertPhone),
    alertEnabled: employee.alertEnabled,
    createdAt: employee.createdAt,
  };
}

function publicGateway(gateway) {
  return {
    id: gateway.id,
    label: gateway.label,
    phoneNumber: gateway.phoneNumber,
    state: gateway.state,
    createdAt: gateway.createdAt,
    lastHeartbeatAt: gateway.lastHeartbeatAt,
    lastBatteryPct: gateway.lastBatteryPct,
  };
}

function publicConversation(conversation, employees) {
  const owner = conversation.ownerId ? employees.get(conversation.ownerId) : null;
  return {
    id: conversation.id,
    customerPhone: conversation.customerPhone,
    businessPhone: conversation.businessPhone,
    ownerId: conversation.ownerId,
    ownerName: owner?.name || null,
    ownerExtension: owner?.extension || null,
    state: conversation.state,
    optedOut: conversation.optedOut,
    createdAt: conversation.createdAt,
    lastActivityAt: conversation.lastActivityAt,
    messages: conversation.messages.map((message) => ({ ...message })),
  };
}

/**
 * A deliberately small in-memory store for one managed tenant. It is suitable
 * for local evaluation and the UI contract; production hosting must replace it
 * with a transactional tenant-aware datastore.
 */
export function createHostedRelayStore({ now = () => new Date().toISOString(), id = randomUUID, token = () => randomBytes(32).toString("base64url") } = {}) {
  const state = {
    tenant: null,
    employees: new Map(),
    gateways: new Map(),
    conversations: new Map(),
    inboundIds: new Map(),
    outboundJobs: new Map(),
    audit: [],
  };

  function event(action, details = {}) {
    state.audit.unshift({ id: `audit_${id()}`, at: now(), action, ...details });
    state.audit.splice(40);
  }

  function tenant() {
    if (!state.tenant) throw fail("NOT_CONFIGURED", "Complete onboarding first");
    return state.tenant;
  }

  function employeeFor(idValue) {
    const employee = state.employees.get(idValue);
    if (!employee) throw fail("NOT_FOUND", "Employee was not found");
    return employee;
  }

  function conversationFor(idValue) {
    const conversation = state.conversations.get(idValue);
    if (!conversation) throw fail("NOT_FOUND", "Conversation was not found");
    return conversation;
  }

  return {
    setup({ organizationName, mainNumber, ownerName, ownerAlertPhone }) {
      if (state.tenant) throw fail("CONFLICT", "This relay already has an organization");
      const createdAt = now();
      state.tenant = {
        id: `tenant_${id()}`,
        organizationName: text(organizationName, "Organization name", 120),
        mainNumber: requiredPhone(mainNumber, "Business number"),
        createdAt,
      };
      const owner = {
        id: `employee_${id()}`,
        name: text(ownerName, "Owner name", 120),
        extension: "100",
        role: "owner",
        alertPhone: optionalPhone(ownerAlertPhone, "Owner alert number"),
        alertEnabled: Boolean(ownerAlertPhone),
        createdAt,
      };
      state.employees.set(owner.id, owner);
      event("tenant.onboarded", { tenantId: state.tenant.id, employeeId: owner.id });
      return { tenant: { ...state.tenant }, owner: publicEmployee(owner) };
    },

    addEmployee({ name, extension, alertPhone, alertEnabled = false }) {
      const activeTenant = tenant();
      const normalizedExtension = text(extension, "Extension", 16);
      if (!EXTENSION.test(normalizedExtension)) throw fail("VALIDATION", "Extension may use letters, numbers, hyphens, and underscores only");
      if ([...state.employees.values()].some((employee) => employee.extension === normalizedExtension)) {
        throw fail("CONFLICT", "That extension is already in use");
      }
      const configuredPhone = optionalPhone(alertPhone, "Alert number");
      if (alertEnabled && !configuredPhone) throw fail("VALIDATION", "An alert number is required when alerts are enabled");
      const employee = {
        id: `employee_${id()}`,
        tenantId: activeTenant.id,
        name: text(name, "Employee name", 120),
        extension: normalizedExtension,
        role: "employee",
        alertPhone: configuredPhone,
        alertEnabled: Boolean(alertEnabled),
        createdAt: now(),
      };
      state.employees.set(employee.id, employee);
      event("employee.added", { employeeId: employee.id, extension: employee.extension });
      return publicEmployee(employee);
    },

    pairGateway({ label, phoneNumber }) {
      const activeTenant = tenant();
      const rawToken = token();
      const gateway = {
        id: `gateway_${id()}`,
        tenantId: activeTenant.id,
        label: text(label, "Phone name", 120),
        phoneNumber: requiredPhone(phoneNumber || activeTenant.mainNumber, "Gateway number"),
        tokenHash: digest(rawToken),
        state: "awaiting_first_heartbeat",
        createdAt: now(),
        lastHeartbeatAt: null,
        lastBatteryPct: null,
      };
      state.gateways.set(gateway.id, gateway);
      event("gateway.paired", { gatewayId: gateway.id });
      return { gateway: publicGateway(gateway), pairingToken: rawToken };
    },

    authenticateGateway({ token: gatewayToken, deviceId }) {
      const gateway = state.gateways.get(deviceId);
      if (!gateway || !sameSecret(gateway.tokenHash, gatewayToken)) return null;
      return { id: gateway.id, tenantId: gateway.tenantId, phoneNumber: gateway.phoneNumber, label: gateway.label };
    },

    recordHeartbeat({ gateway, envelope }) {
      const storedGateway = state.gateways.get(gateway.id);
      if (!storedGateway) throw fail("NOT_FOUND", "Gateway was not found");
      storedGateway.state = envelope.payload.status;
      storedGateway.lastHeartbeatAt = now();
      storedGateway.lastBatteryPct = envelope.payload.batteryPct ?? null;
      event("gateway.heartbeat", { gatewayId: gateway.id, state: storedGateway.state });
    },

    recordInbound({ gateway, envelope }) {
      const duplicateKey = `${gateway.id}:${envelope.payload.messageId}`;
      const existing = state.inboundIds.get(duplicateKey);
      if (existing) return { conversationId: existing, duplicate: true };

      const payload = envelope.payload;
      let conversation = [...state.conversations.values()].find((item) =>
        item.tenantId === gateway.tenantId && item.customerPhone === payload.from && item.businessPhone === payload.to,
      );
      if (!conversation) {
        conversation = {
          id: `conversation_${id()}`,
          tenantId: gateway.tenantId,
          gatewayId: gateway.id,
          customerPhone: payload.from,
          businessPhone: payload.to,
          ownerId: null,
          state: "needs_assignment",
          optedOut: false,
          createdAt: now(),
          lastActivityAt: now(),
          messages: [],
        };
        state.conversations.set(conversation.id, conversation);
      }
      conversation.lastActivityAt = now();
      conversation.messages.push({
        id: `message_${id()}`,
        carrierMessageId: payload.messageId,
        direction: "inbound",
        body: payload.body,
        status: "received",
        at: envelope.sentAt,
      });
      state.inboundIds.set(duplicateKey, conversation.id);
      event("message.received", { conversationId: conversation.id, gatewayId: gateway.id });
      return { conversationId: conversation.id, duplicate: false };
    },

    claimOutbound({ gateway }) {
      const job = [...state.outboundJobs.values()].find((item) => item.gatewayId === gateway.id && item.status === "queued");
      if (!job) return null;
      job.status = "claimed";
      job.claimedAt = now();
      event("outbound.claimed", { jobId: job.id, gatewayId: gateway.id });
      return {
        jobId: job.id,
        to: job.to,
        body: job.body,
        ownerId: job.ownerId,
        idempotencyKey: job.idempotencyKey,
      };
    },

    recordOutboundResult({ gateway, envelope }) {
      const job = state.outboundJobs.get(envelope.payload.jobId);
      if (!job || job.gatewayId !== gateway.id) throw fail("NOT_FOUND", "Outbound job was not found for this gateway");
      if (job.status === "sent" || job.status === "delivered" || job.status === "failed") return;
      job.status = envelope.payload.status;
      job.completedAt = now();
      const conversation = state.conversations.get(job.conversationId);
      const message = conversation?.messages.find((item) => item.id === job.messageId);
      if (message) message.status = envelope.payload.status;
      event("outbound.result", { jobId: job.id, status: job.status });
    },

    assignConversation({ conversationId, employeeId }) {
      const conversation = conversationFor(conversationId);
      const employee = employeeFor(employeeId);
      if (employee.tenantId && employee.tenantId !== conversation.tenantId) throw fail("FORBIDDEN", "Employee is not in this organization");
      conversation.ownerId = employee.id;
      conversation.state = "assigned";
      conversation.lastActivityAt = now();
      event("conversation.assigned", { conversationId, employeeId });
      return publicConversation(conversation, state.employees);
    },

    setOptOut({ conversationId, optedOut }) {
      const conversation = conversationFor(conversationId);
      conversation.optedOut = Boolean(optedOut);
      conversation.state = conversation.optedOut ? "opted_out" : conversation.ownerId ? "assigned" : "needs_assignment";
      conversation.lastActivityAt = now();
      event(conversation.optedOut ? "conversation.opted_out" : "conversation.opted_in", { conversationId });
      return publicConversation(conversation, state.employees);
    },

    queueReply({ conversationId, body }) {
      const conversation = conversationFor(conversationId);
      if (conversation.optedOut) throw fail("FORBIDDEN", "This customer has opted out; do not send another SMS");
      if (!conversation.ownerId) throw fail("VALIDATION", "Assign this conversation before replying");
      const message = {
        id: `message_${id()}`,
        direction: "outbound",
        body: text(body, "Reply", 1600),
        status: "queued",
        at: now(),
      };
      conversation.messages.push(message);
      conversation.lastActivityAt = now();
      const job = {
        id: `job_${id()}`,
        gatewayId: conversation.gatewayId,
        conversationId: conversation.id,
        messageId: message.id,
        ownerId: conversation.ownerId,
        to: conversation.customerPhone,
        body: message.body,
        idempotencyKey: `relay:${message.id}`,
        status: "queued",
        createdAt: now(),
      };
      state.outboundJobs.set(job.id, job);
      event("outbound.queued", { conversationId, jobId: job.id, ownerId: conversation.ownerId });
      return { jobId: job.id, message: { ...message } };
    },

    snapshot() {
      return {
        configured: Boolean(state.tenant),
        tenant: state.tenant ? { ...state.tenant } : null,
        employees: [...state.employees.values()].map(publicEmployee).sort((a, b) => a.extension.localeCompare(b.extension)),
        gateways: [...state.gateways.values()].map(publicGateway).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
        conversations: [...state.conversations.values()]
          .map((conversation) => publicConversation(conversation, state.employees))
          .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt)),
        audit: state.audit.map((item) => ({ ...item })),
      };
    },
  };
}
