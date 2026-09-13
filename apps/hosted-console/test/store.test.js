import test from "node:test";
import assert from "node:assert/strict";
import { createHostedRelayStore } from "../src/store.js";

const inbound = {
  version: 1,
  event: "inbound.message",
  deviceId: "",
  sentAt: "2026-09-13T22:00:00.000Z",
  payload: { messageId: "carrier-message-1", from: "+15551234567", to: "+15557654321", body: "Can I get help with my bill?" },
};

function configuredStore() {
  let sequence = 0;
  const store = createHostedRelayStore({ id: () => `id_${++sequence}`, token: () => "pairing-secret" });
  const setup = store.setup({ organizationName: "WGW", mainNumber: "+15557654321", ownerName: "Humberto" });
  const paired = store.pairGateway({ label: "Front desk phone" });
  return { store, owner: setup.owner, paired };
}

test("never exposes pairing credentials in the operator snapshot", () => {
  const { store, paired } = configuredStore();
  assert.equal(paired.pairingToken, "pairing-secret");
  assert.equal(JSON.stringify(store.snapshot()).includes("pairing-secret"), false);
  assert.equal(store.authenticateGateway({ token: "wrong", deviceId: paired.gateway.id }), null);
  assert.equal(store.authenticateGateway({ token: "pairing-secret", deviceId: paired.gateway.id }).id, paired.gateway.id);
});

test("keeps an inbound message idempotent, assigned, and delivery-auditable", () => {
  const { store, owner, paired } = configuredStore();
  const gateway = store.authenticateGateway({ token: "pairing-secret", deviceId: paired.gateway.id });
  const envelope = { ...inbound, deviceId: paired.gateway.id };
  const first = store.recordInbound({ gateway, envelope });
  assert.deepEqual(store.recordInbound({ gateway, envelope }), { conversationId: first.conversationId, duplicate: true });

  store.assignConversation({ conversationId: first.conversationId, employeeId: owner.id });
  const queued = store.queueReply({ conversationId: first.conversationId, body: "Absolutely — I can help with that." });
  const job = store.claimOutbound({ gateway });
  assert.equal(job.jobId, queued.jobId);
  assert.equal(job.to, "+15551234567");
  store.recordOutboundResult({ gateway, envelope: { event: "outbound.result", payload: { jobId: job.jobId, status: "sent" } } });

  const conversation = store.snapshot().conversations[0];
  assert.equal(conversation.ownerExtension, "100");
  assert.equal(conversation.messages.at(-1).status, "sent");
});

test("locks a conversation before any further SMS is queued after an opt-out", () => {
  const { store, paired } = configuredStore();
  const gateway = store.authenticateGateway({ token: "pairing-secret", deviceId: paired.gateway.id });
  const { conversationId } = store.recordInbound({ gateway, envelope: { ...inbound, deviceId: paired.gateway.id } });
  const owner = store.snapshot().employees[0];
  store.assignConversation({ conversationId, employeeId: owner.id });
  store.setOptOut({ conversationId, optedOut: true });
  assert.throws(() => store.queueReply({ conversationId, body: "Please ignore this" }), /opted out/);
});
