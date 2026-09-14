import test from "node:test";
import assert from "node:assert/strict";
import { createHostedRelayStore } from "../src/store.js";

function fixture() {
  let sequence = 0;
  return createHostedRelayStore({ id: () => `id_${++sequence}`, token: () => `token_${++sequence}_with_enough_randomness` });
}

function register(store, name, email, number) {
  return store.registerTenant({ organizationName: `${name} Wireless`, mainNumber: number, name, email, password: "correct-horse-battery-staple" });
}

function inbound(deviceId, from, to, messageId) {
  return { version: 1, event: "inbound.message", deviceId, sentAt: "2026-09-13T22:00:00.000Z", payload: { messageId, from, to, body: "Can you help me?" } };
}

test("keeps tenant conversations, audit, and gateway credentials isolated", () => {
  const store = fixture();
  const alpha = register(store, "Alpha Owner", "alpha@example.com", "+15557654321");
  const beta = register(store, "Beta Owner", "beta@example.com", "+15559876543");
  const alphaActor = store.authenticateUser(alpha.sessionToken);
  const betaActor = store.authenticateUser(beta.sessionToken);
  const betaPhone = store.pairGateway({ actor: betaActor, label: "Beta desk phone" });
  const betaGateway = store.authenticateGateway({ token: betaPhone.pairingToken, deviceId: betaPhone.gateway.id });
  const received = store.recordInbound({ gateway: betaGateway, envelope: inbound(betaPhone.gateway.id, "+15551234567", "+15559876543", "carrier-1") });

  assert.equal(store.snapshot({ actor: alphaActor }).conversations.length, 0);
  assert.throws(() => store.assignConversation({ actor: alphaActor, conversationId: received.conversationId, userId: alpha.viewer.id }), /not found/);
  const betaState = store.snapshot({ actor: betaActor });
  assert.equal(betaState.conversations.length, 1);
  assert.equal(JSON.stringify(betaState).includes(betaPhone.pairingToken), false);
  assert.equal(JSON.stringify(betaState).includes("correct-horse-battery-staple"), false);
});

test("gives an invited agent only their assigned conversations and a one-use invite", () => {
  const store = fixture();
  const owner = register(store, "Owner", "owner@example.com", "+15557654321");
  const ownerActor = store.authenticateUser(owner.sessionToken);
  const invite = store.createInvitation({ actor: ownerActor, name: "Alex", email: "alex@example.com", role: "agent", extension: "101" });
  const agent = store.acceptInvitation({ inviteCode: invite.inviteCode, password: "alex-long-password" });
  const agentActor = store.authenticateUser(agent.sessionToken);
  assert.throws(() => store.acceptInvitation({ inviteCode: invite.inviteCode, password: "another-long-password" }), /invalid, expired, or already used/);

  const paired = store.pairGateway({ actor: ownerActor, label: "Desk phone" });
  const gateway = store.authenticateGateway({ token: paired.pairingToken, deviceId: paired.gateway.id });
  const first = store.recordInbound({ gateway, envelope: inbound(paired.gateway.id, "+15551234567", "+15557654321", "carrier-1") });
  store.recordInbound({ gateway, envelope: inbound(paired.gateway.id, "+15550001111", "+15557654321", "carrier-2") });
  assert.equal(store.snapshot({ actor: agentActor }).conversations.length, 0);

  store.assignConversation({ actor: ownerActor, conversationId: first.conversationId, userId: agent.viewer.id });
  const agentState = store.snapshot({ actor: agentActor });
  assert.equal(agentState.conversations.length, 1);
  assert.equal(agentState.conversations[0].ownerExtension, "101");
  assert.throws(() => store.assignConversation({ actor: agentActor, conversationId: first.conversationId, userId: owner.viewer.id }), /Only an owner or manager/);
  const reply = store.queueReply({ actor: agentActor, conversationId: first.conversationId, body: "I can help with that." });
  assert.ok(reply.jobId);
});

test("lets every user control their own notification preference without exposing the number", () => {
  const store = fixture();
  const owner = register(store, "Owner", "owner@example.com", "+15557654321");
  const actor = store.authenticateUser(owner.sessionToken);
  store.updateProfile({ actor, personalPhone: "+15551234567", alertEnabled: true });
  const viewer = store.snapshot({ actor }).viewer;
  assert.equal(viewer.alertEnabled, true);
  assert.equal(viewer.alertPhoneConfigured, true);
  assert.equal(JSON.stringify(viewer).includes("+15551234567"), false);
});

test("turns a plain-language number plan into tenant-scoped call, text, and voicemail settings", () => {
  const store = fixture();
  const owner = register(store, "Owner", "owner@example.com");
  const actor = store.authenticateUser(owner.sessionToken);
  assert.equal(store.snapshot({ actor }).tenant.phoneSetup.completedAt, null);
  assert.throws(() => store.pairGateway({ actor, label: "Desk phone" }), /Complete the business-number setup/);
  const configured = store.configurePhoneSetup({
    actor,
    businessNumber: "+15557654321",
    businessPurpose: "Sales and support",
    callsEnabled: true,
    textsEnabled: true,
    voicemailEnabled: true,
    callForwardNumber: "+15551234567",
    notificationPhone: "+15551234567",
  });
  assert.equal(configured.phoneSetup.callsEnabled, true);
  assert.equal(configured.phoneSetup.callForwardNumber, "+15551234567");
  assert.equal(configured.phoneSetup.connectionState, "awaiting_gateway_or_pbx_connection");
});

test("puts the owner in control of a tenant-scoped PBX business-call map", () => {
  const store = fixture();
  const owner = register(store, "Owner", "owner@example.com", "+15557654321");
  const ownerActor = store.authenticateUser(owner.sessionToken);
  const callMap = store.configurePbxCallMap({
    actor: ownerActor,
    label: "Current Mitel 5330e",
    type: "asterisk_mitel",
    primaryExtension: "101",
    ringSeconds: 25,
    fallback: "voicemail",
    voicemailExtension: "101",
  });
  assert.equal(callMap.primaryExtension, "101");
  assert.equal(callMap.voicemailExtension, "101");
  assert.equal(callMap.bridgeState, "saved_waiting_for_private_bridge");
  assert.equal(store.snapshot({ actor: ownerActor }).tenant.pbxCallMap.ringSeconds, 25);

  const beta = register(store, "Beta", "beta@example.com", "+15559876543");
  const betaActor = store.authenticateUser(beta.sessionToken);
  assert.equal(store.snapshot({ actor: betaActor }).tenant.pbxCallMap, null);
  assert.throws(() => store.configurePbxCallMap({ actor: betaActor, label: "Bad", type: "asterisk_mitel", primaryExtension: "101", ringSeconds: 5, fallback: "voicemail", voicemailExtension: "101" }), /Ring time must be between/);
});

test("lets an owner reserve an employee extension, link it on invitation acceptance, and control routing", () => {
  const store = fixture();
  const owner = register(store, "Owner", "owner@example.com", "+15557654321");
  const ownerActor = store.authenticateUser(owner.sessionToken);
  store.updateProfile({ actor: ownerActor, personalPhone: "+15551234567", alertEnabled: true });

  const created = store.createRouteProfile({
    actor: ownerActor,
    name: "Alex",
    extension: "101",
    callForwardNumber: "+15550001111",
    routingTopics: "billing, phone plans",
    inviteEmail: "alex@example.com",
    role: "agent",
  });
  assert.equal(created.profile.extension, "101");
  assert.equal(created.profile.status, "invited");
  assert.equal(created.profile.callForwardNumber, "+15550001111");
  assert.throws(() => store.createInvitation({ actor: ownerActor, name: "Duplicate", email: "duplicate@example.com", role: "agent", extension: "101" }), /reserved by an active invitation|already assigned/);

  const agent = store.acceptInvitation({ inviteCode: created.inviteCode, password: "alex-long-password" });
  const agentActor = store.authenticateUser(agent.sessionToken);
  const afterInvite = store.snapshot({ actor: ownerActor });
  assert.equal(afterInvite.routeProfiles[0].status, "active");
  assert.equal(afterInvite.routeProfiles[0].userId, agent.viewer.id);
  assert.equal(agent.viewer.extension, "101");

  store.updateRouteProfile({ actor: ownerActor, routeProfileId: created.profile.id, extension: "102" });
  assert.equal(store.snapshot({ actor: agentActor }).viewer.extension, "102");

  store.updateMyRouteProfile({ actor: agentActor, callForwardNumber: "+15550002222", routingTopics: ["support"] });
  assert.equal(store.snapshot({ actor: agentActor }).myRouteProfile.callForwardNumber, "+15550002222");
  assert.throws(() => store.updateRouteProfile({ actor: agentActor, routeProfileId: created.profile.id, extension: "102" }), /Only the organization owner/);

  const delivery = store.configureOwnerDelivery({ actor: ownerActor, textsToOwner: true, voicemailsToOwner: true, alertMode: "full_content" });
  assert.equal(delivery.textsToOwner, true);
  assert.equal(delivery.alertMode, "full_content");
  const connection = store.createPhoneConnection({ actor: ownerActor, type: "mitel", label: "Main office Mitel", pbxHost: "pbx.example.local", extension: "101" });
  assert.equal(connection.status, "planned_needs_secure_credentials");
  assert.equal(store.snapshot({ actor: ownerActor }).phoneConnections[0].type, "mitel");
});

test("keeps employee routes and PBX plans tenant-scoped", () => {
  const store = fixture();
  const alpha = register(store, "Alpha", "alpha@example.com", "+15557654321");
  const beta = register(store, "Beta", "beta@example.com", "+15559876543");
  const alphaActor = store.authenticateUser(alpha.sessionToken);
  const betaActor = store.authenticateUser(beta.sessionToken);
  const profile = store.createRouteProfile({ actor: alphaActor, name: "Alex", extension: "101", callForwardNumber: "+15550001111" });

  assert.throws(() => store.updateRouteProfile({ actor: betaActor, routeProfileId: profile.profile.id, extension: "102" }), /not found/);
  assert.equal(store.snapshot({ actor: betaActor }).routeProfiles.length, 0);
  assert.equal(store.snapshot({ actor: betaActor }).phoneConnections.length, 0);
});
