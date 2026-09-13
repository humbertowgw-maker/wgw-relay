import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";

const E164 = /^\+[1-9]\d{7,14}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EXTENSION = /^[A-Za-z0-9_-]{1,16}$/;
const INVITABLE_ROLES = new Set(["manager", "agent"]);
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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

function normalizeEmail(value) {
  const email = text(value, "Email address", 254).toLowerCase();
  if (!EMAIL.test(email)) throw fail("VALIDATION", "Email address is not valid");
  return email;
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

function password(value) {
  const candidate = text(value, "Password", 256);
  if (candidate.length < 12) throw fail("VALIDATION", "Password must be at least 12 characters");
  return candidate;
}

function digest(secret) {
  return createHash("sha256").update(secret).digest();
}

function hashKey(secret) {
  return digest(secret).toString("base64url");
}

function sameSecret(expectedHash, secret) {
  if (!expectedHash || typeof secret !== "string" || !secret) return false;
  const actual = digest(secret);
  return expectedHash.length === actual.length && timingSafeEqual(expectedHash, actual);
}

function passwordRecord(candidate) {
  const salt = randomBytes(16);
  return { salt: salt.toString("base64url"), hash: scryptSync(candidate, salt, 32) };
}

function matchesPassword(record, candidate) {
  if (typeof candidate !== "string") return false;
  const actual = scryptSync(candidate, Buffer.from(record.salt, "base64url"), 32);
  return actual.length === record.hash.length && timingSafeEqual(actual, record.hash);
}

function membershipKey(tenantId, userId) {
  return `${tenantId}:${userId}`;
}

function publicMember(user, membership) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: membership.role,
    extension: membership.extension,
    alertPhoneConfigured: Boolean(membership.alertPhone),
    alertEnabled: membership.alertEnabled,
    createdAt: membership.createdAt,
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

function managesPeople(actor) { return actor.role === "owner" || actor.role === "manager"; }
function managesGateway(actor) { return actor.role === "owner"; }
function managesInbox(actor) { return actor.role === "owner" || actor.role === "manager"; }

/**
 * Reference multi-tenant store. Each tenant-sensitive operation accepts an
 * authenticated actor. Passwords, sessions, invitation codes, and pairing
 * tokens are hashed and never returned after their one issuance response.
 */
export function createHostedRelayStore({ now = () => new Date().toISOString(), nowMs = () => Date.now(), id = randomUUID, token = () => randomBytes(32).toString("base64url") } = {}) {
  const state = {
    tenants: new Map(), users: new Map(), userByEmail: new Map(), memberships: new Map(), sessions: new Map(), invitations: new Map(),
    gateways: new Map(), conversations: new Map(), inboundIds: new Map(), outboundJobs: new Map(), auditByTenant: new Map(),
  };

  function event(tenantId, action, details = {}) {
    const audit = state.auditByTenant.get(tenantId) || [];
    audit.unshift({ id: `audit_${id()}`, at: now(), action, ...details });
    audit.splice(40);
    state.auditByTenant.set(tenantId, audit);
  }

  function tenantFor(tenantId) {
    const tenant = state.tenants.get(tenantId);
    if (!tenant) throw fail("NOT_FOUND", "Organization was not found");
    return tenant;
  }

  function userFor(userId) {
    const user = state.users.get(userId);
    if (!user) throw fail("NOT_FOUND", "User was not found");
    return user;
  }

  function membershipFor(tenantId, userId) {
    const membership = state.memberships.get(membershipKey(tenantId, userId));
    if (!membership?.active) throw fail("FORBIDDEN", "You do not have access to this organization");
    return membership;
  }

  function sessionActor(sessionToken) {
    const key = hashKey(sessionToken);
    const session = state.sessions.get(key);
    if (!session || session.expiresAtMs <= nowMs()) {
      if (session) state.sessions.delete(key);
      throw fail("UNAUTHENTICATED", "Sign in to continue");
    }
    const user = userFor(session.userId);
    const membership = membershipFor(session.tenantId, session.userId);
    return { tenantId: session.tenantId, userId: session.userId, role: membership.role, user, membership, sessionId: session.id };
  }

  function actorFor(actor) {
    if (!actor?.tenantId || !actor?.userId) throw fail("UNAUTHENTICATED", "Sign in to continue");
    const user = userFor(actor.userId);
    const membership = membershipFor(actor.tenantId, actor.userId);
    return { ...actor, role: membership.role, user, membership };
  }

  function issueSession(tenantId, userId) {
    const sessionToken = token();
    const session = { id: `session_${id()}`, tenantId, userId, createdAt: now(), expiresAtMs: nowMs() + SESSION_TTL_MS };
    state.sessions.set(hashKey(sessionToken), session);
    return { sessionToken, expiresAt: new Date(session.expiresAtMs).toISOString() };
  }

  function uniqueExtension(tenantId, extension) {
    const normalized = text(extension, "Extension", 16);
    if (!EXTENSION.test(normalized)) throw fail("VALIDATION", "Extension may use letters, numbers, hyphens, and underscores only");
    if ([...state.memberships.values()].some((item) => item.tenantId === tenantId && item.extension === normalized && item.active)) throw fail("CONFLICT", "That extension is already in use");
    if ([...state.invitations.values()].some((item) => item.tenantId === tenantId && item.extension === normalized && !item.usedAt && item.expiresAtMs > nowMs())) throw fail("CONFLICT", "That extension is reserved by an active invitation");
    return normalized;
  }

  function conversationFor(actor, conversationId) {
    const conversation = state.conversations.get(conversationId);
    if (!conversation || conversation.tenantId !== actor.tenantId) throw fail("NOT_FOUND", "Conversation was not found");
    return conversation;
  }

  function canAccessConversation(actor, conversation) {
    return managesInbox(actor) || conversation.ownerId === actor.userId;
  }

  function publicConversation(conversation) {
    const owner = conversation.ownerId ? state.users.get(conversation.ownerId) : null;
    const ownerMembership = owner ? state.memberships.get(membershipKey(conversation.tenantId, owner.id)) : null;
    return {
      id: conversation.id, customerPhone: conversation.customerPhone, businessPhone: conversation.businessPhone,
      ownerId: conversation.ownerId, ownerName: owner?.name || null, ownerExtension: ownerMembership?.extension || null,
      state: conversation.state, optedOut: conversation.optedOut, createdAt: conversation.createdAt, lastActivityAt: conversation.lastActivityAt,
      messages: conversation.messages.map((message) => ({ ...message })),
    };
  }

  return {
    status() { return { registrationOpen: true }; },

    registerTenant({ organizationName, mainNumber, name, email, password: passwordInput, personalPhone, alertEnabled = false }) {
      const normalizedEmail = normalizeEmail(email);
      if (state.userByEmail.has(normalizedEmail)) throw fail("CONFLICT", "An account with that email already exists; sign in instead");
      const createdAt = now();
      const tenant = { id: `tenant_${id()}`, organizationName: text(organizationName, "Organization name", 120), mainNumber: requiredPhone(mainNumber, "Business number"), createdAt };
      const credentials = passwordRecord(password(passwordInput));
      const alertPhone = optionalPhone(personalPhone, "Personal alert number");
      if (alertEnabled && !alertPhone) throw fail("VALIDATION", "A personal alert number is required when alerts are enabled");
      const user = { id: `user_${id()}`, name: text(name, "Your name", 120), email: normalizedEmail, passwordSalt: credentials.salt, passwordHash: credentials.hash, createdAt };
      const membership = { tenantId: tenant.id, userId: user.id, role: "owner", extension: "100", alertPhone, alertEnabled: Boolean(alertEnabled), active: true, createdAt };
      state.tenants.set(tenant.id, tenant);
      state.users.set(user.id, user);
      state.userByEmail.set(user.email, user.id);
      state.memberships.set(membershipKey(tenant.id, user.id), membership);
      event(tenant.id, "tenant.registered", { actorId: user.id });
      return { ...issueSession(tenant.id, user.id), tenant: { ...tenant }, viewer: publicMember(user, membership) };
    },

    signIn({ email, password: passwordInput }) {
      const userId = state.userByEmail.get(normalizeEmail(email));
      const user = userId ? state.users.get(userId) : null;
      if (!user || !matchesPassword({ salt: user.passwordSalt, hash: user.passwordHash }, passwordInput)) throw fail("UNAUTHENTICATED", "Email or password was not accepted");
      const memberships = [...state.memberships.values()].filter((item) => item.userId === user.id && item.active);
      if (memberships.length !== 1) throw fail("CONFLICT", "This reference console requires choosing an organization before sign-in");
      const membership = memberships[0];
      event(membership.tenantId, "user.signed_in", { actorId: user.id });
      return { ...issueSession(membership.tenantId, user.id), tenant: { ...tenantFor(membership.tenantId) }, viewer: publicMember(user, membership) };
    },

    signOut(sessionToken) { state.sessions.delete(hashKey(sessionToken)); },
    authenticateUser(sessionToken) { return sessionActor(sessionToken); },

    updateProfile({ actor, name, personalPhone, alertEnabled }) {
      const current = actorFor(actor);
      if (name !== undefined) current.user.name = text(name, "Your name", 120);
      if (personalPhone !== undefined) current.membership.alertPhone = optionalPhone(personalPhone, "Personal alert number");
      if (alertEnabled !== undefined) current.membership.alertEnabled = Boolean(alertEnabled);
      if (current.membership.alertEnabled && !current.membership.alertPhone) throw fail("VALIDATION", "A personal alert number is required when alerts are enabled");
      event(current.tenantId, "profile.updated", { actorId: current.userId });
      return publicMember(current.user, current.membership);
    },

    createInvitation({ actor, name, email, role, extension }) {
      const current = actorFor(actor);
      if (!managesPeople(current)) throw fail("FORBIDDEN", "Only an owner or manager can invite teammates");
      if (!INVITABLE_ROLES.has(role)) throw fail("VALIDATION", "Invite role must be manager or agent");
      const normalizedEmail = normalizeEmail(email);
      if (state.userByEmail.has(normalizedEmail)) throw fail("CONFLICT", "That email already has an account in this reference console");
      const inviteCode = token();
      const invitation = {
        id: `invite_${id()}`, tenantId: current.tenantId, name: text(name, "Teammate name", 120), email: normalizedEmail, role,
        extension: uniqueExtension(current.tenantId, extension), codeHash: digest(inviteCode), createdAt: now(), expiresAtMs: nowMs() + INVITE_TTL_MS, usedAt: null,
      };
      state.invitations.set(invitation.id, invitation);
      event(current.tenantId, "member.invited", { actorId: current.userId, invitationId: invitation.id, role });
      return { invitation: { id: invitation.id, name: invitation.name, email: invitation.email, role: invitation.role, extension: invitation.extension, expiresAt: new Date(invitation.expiresAtMs).toISOString() }, inviteCode };
    },

    acceptInvitation({ inviteCode, password: passwordInput, personalPhone, alertEnabled = false }) {
      const invitation = [...state.invitations.values()].find((item) => sameSecret(item.codeHash, inviteCode));
      if (!invitation || invitation.usedAt || invitation.expiresAtMs <= nowMs()) throw fail("UNAUTHENTICATED", "Invitation is invalid, expired, or already used");
      if (state.userByEmail.has(invitation.email)) throw fail("CONFLICT", "That email already has an account; ask the owner to resend the invitation");
      const credentials = passwordRecord(password(passwordInput));
      const alertPhone = optionalPhone(personalPhone, "Personal alert number");
      if (alertEnabled && !alertPhone) throw fail("VALIDATION", "A personal alert number is required when alerts are enabled");
      const user = { id: `user_${id()}`, name: invitation.name, email: invitation.email, passwordSalt: credentials.salt, passwordHash: credentials.hash, createdAt: now() };
      const membership = { tenantId: invitation.tenantId, userId: user.id, role: invitation.role, extension: invitation.extension, alertPhone, alertEnabled: Boolean(alertEnabled), active: true, createdAt: now() };
      invitation.usedAt = now();
      state.users.set(user.id, user);
      state.userByEmail.set(user.email, user.id);
      state.memberships.set(membershipKey(membership.tenantId, user.id), membership);
      event(membership.tenantId, "invitation.accepted", { userId: user.id, invitationId: invitation.id });
      return { ...issueSession(membership.tenantId, user.id), tenant: { ...tenantFor(membership.tenantId) }, viewer: publicMember(user, membership) };
    },

    pairGateway({ actor, label, phoneNumber }) {
      const current = actorFor(actor);
      if (!managesGateway(current)) throw fail("FORBIDDEN", "Only the organization owner can pair a Relay phone");
      const tenant = tenantFor(current.tenantId);
      const pairingToken = token();
      const gateway = { id: `gateway_${id()}`, tenantId: tenant.id, label: text(label, "Phone name", 120), phoneNumber: requiredPhone(phoneNumber || tenant.mainNumber, "Gateway number"), tokenHash: digest(pairingToken), state: "awaiting_first_heartbeat", createdAt: now(), lastHeartbeatAt: null, lastBatteryPct: null };
      state.gateways.set(gateway.id, gateway);
      event(tenant.id, "gateway.paired", { actorId: current.userId, gatewayId: gateway.id });
      return { gateway: publicGateway(gateway), pairingToken };
    },

    authenticateGateway({ token: gatewayToken, deviceId }) {
      const gateway = state.gateways.get(deviceId);
      if (!gateway || !sameSecret(gateway.tokenHash, gatewayToken)) return null;
      return { id: gateway.id, tenantId: gateway.tenantId, phoneNumber: gateway.phoneNumber, label: gateway.label };
    },

    recordHeartbeat({ gateway, envelope }) {
      const stored = state.gateways.get(gateway.id);
      if (!stored) throw fail("NOT_FOUND", "Gateway was not found");
      stored.state = envelope.payload.status;
      stored.lastHeartbeatAt = now();
      stored.lastBatteryPct = envelope.payload.batteryPct ?? null;
      event(gateway.tenantId, "gateway.heartbeat", { gatewayId: gateway.id, state: stored.state });
    },

    recordInbound({ gateway, envelope }) {
      const duplicateKey = `${gateway.id}:${envelope.payload.messageId}`;
      const existing = state.inboundIds.get(duplicateKey);
      if (existing) return { conversationId: existing, duplicate: true };
      const payload = envelope.payload;
      let conversation = [...state.conversations.values()].find((item) => item.tenantId === gateway.tenantId && item.customerPhone === payload.from && item.businessPhone === payload.to);
      if (!conversation) {
        conversation = { id: `conversation_${id()}`, tenantId: gateway.tenantId, gatewayId: gateway.id, customerPhone: payload.from, businessPhone: payload.to, ownerId: null, state: "needs_assignment", optedOut: false, createdAt: now(), lastActivityAt: now(), messages: [] };
        state.conversations.set(conversation.id, conversation);
      }
      conversation.lastActivityAt = now();
      conversation.messages.push({ id: `message_${id()}`, carrierMessageId: payload.messageId, direction: "inbound", body: payload.body, status: "received", at: envelope.sentAt });
      state.inboundIds.set(duplicateKey, conversation.id);
      event(gateway.tenantId, "message.received", { conversationId: conversation.id, gatewayId: gateway.id });
      return { conversationId: conversation.id, duplicate: false };
    },

    claimOutbound({ gateway }) {
      const job = [...state.outboundJobs.values()].find((item) => item.gatewayId === gateway.id && item.status === "queued");
      if (!job) return null;
      job.status = "claimed";
      job.claimedAt = now();
      event(gateway.tenantId, "outbound.claimed", { jobId: job.id, gatewayId: gateway.id });
      return { jobId: job.id, to: job.to, body: job.body, ownerId: job.ownerId, idempotencyKey: job.idempotencyKey };
    },

    recordOutboundResult({ gateway, envelope }) {
      const job = state.outboundJobs.get(envelope.payload.jobId);
      if (!job || job.gatewayId !== gateway.id) throw fail("NOT_FOUND", "Outbound job was not found for this gateway");
      if (["sent", "delivered", "failed"].includes(job.status)) return;
      job.status = envelope.payload.status;
      const conversation = state.conversations.get(job.conversationId);
      const message = conversation?.messages.find((item) => item.id === job.messageId);
      if (message) message.status = job.status;
      event(gateway.tenantId, "outbound.result", { jobId: job.id, status: job.status });
    },

    assignConversation({ actor, conversationId, userId }) {
      const current = actorFor(actor);
      if (!managesInbox(current)) throw fail("FORBIDDEN", "Only an owner or manager can assign conversations");
      const conversation = conversationFor(current, conversationId);
      membershipFor(current.tenantId, userId);
      conversation.ownerId = userId;
      conversation.state = "assigned";
      conversation.lastActivityAt = now();
      event(current.tenantId, "conversation.assigned", { actorId: current.userId, conversationId, userId });
      return publicConversation(conversation);
    },

    setOptOut({ actor, conversationId, optedOut }) {
      const current = actorFor(actor);
      const conversation = conversationFor(current, conversationId);
      if (!canAccessConversation(current, conversation)) throw fail("NOT_FOUND", "Conversation was not found");
      conversation.optedOut = Boolean(optedOut);
      conversation.state = conversation.optedOut ? "opted_out" : conversation.ownerId ? "assigned" : "needs_assignment";
      conversation.lastActivityAt = now();
      event(current.tenantId, conversation.optedOut ? "conversation.opted_out" : "conversation.opted_in", { actorId: current.userId, conversationId });
      return publicConversation(conversation);
    },

    queueReply({ actor, conversationId, body }) {
      const current = actorFor(actor);
      const conversation = conversationFor(current, conversationId);
      if (!canAccessConversation(current, conversation)) throw fail("NOT_FOUND", "Conversation was not found");
      if (conversation.optedOut) throw fail("FORBIDDEN", "This customer has opted out; do not send another SMS");
      if (!conversation.ownerId) throw fail("VALIDATION", "Assign this conversation before replying");
      const message = { id: `message_${id()}`, direction: "outbound", body: text(body, "Reply", 1600), status: "queued", at: now() };
      conversation.messages.push(message);
      conversation.lastActivityAt = now();
      const job = { id: `job_${id()}`, gatewayId: conversation.gatewayId, conversationId: conversation.id, messageId: message.id, ownerId: conversation.ownerId, to: conversation.customerPhone, body: message.body, idempotencyKey: `relay:${message.id}`, status: "queued", createdAt: now() };
      state.outboundJobs.set(job.id, job);
      event(current.tenantId, "outbound.queued", { actorId: current.userId, conversationId, jobId: job.id, ownerId: conversation.ownerId });
      return { jobId: job.id, message: { ...message } };
    },

    snapshot({ actor }) {
      const current = actorFor(actor);
      const tenant = tenantFor(current.tenantId);
      const members = [...state.memberships.values()].filter((item) => item.tenantId === current.tenantId && item.active).map((item) => publicMember(userFor(item.userId), item)).sort((a, b) => a.extension.localeCompare(b.extension));
      const conversations = [...state.conversations.values()].filter((item) => item.tenantId === current.tenantId && canAccessConversation(current, item)).map(publicConversation).sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
      return {
        tenant: { ...tenant }, viewer: publicMember(current.user, current.membership),
        permissions: { managePeople: managesPeople(current), manageGateway: managesGateway(current), manageInbox: managesInbox(current) },
        members: managesPeople(current) ? members : [publicMember(current.user, current.membership)],
        gateways: managesGateway(current) ? [...state.gateways.values()].filter((item) => item.tenantId === current.tenantId).map(publicGateway) : [],
        conversations,
        audit: managesInbox(current) ? (state.auditByTenant.get(current.tenantId) || []).map((item) => ({ ...item })) : [],
      };
    },
  };
}
