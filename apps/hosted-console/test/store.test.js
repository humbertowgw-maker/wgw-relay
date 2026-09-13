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
