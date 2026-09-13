import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createHostedConsoleServer } from "../src/app.js";

async function runningServer() {
  const server = createHostedConsoleServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

async function request(baseUrl, path, { body, headers = {}, ...options } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { ...headers, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { response, body: response.status === 204 ? null : await response.json() };
}

test("runs a signed-in tenant user flow with invitation permissions and paired-device delivery", async (t) => {
  const { server, baseUrl } = await runningServer();
  t.after(() => server.close());

  const owner = await request(baseUrl, "/api/register", { method: "POST", body: { organizationName: "WGW", mainNumber: "+15557654321", name: "Owner", email: "owner@example.com", password: "owner-long-password" } });
  assert.equal(owner.response.status, 201);
  const ownerHeaders = { authorization: `Bearer ${owner.body.sessionToken}` };
  assert.equal((await request(baseUrl, "/api/state")).response.status, 401);

  const invited = await request(baseUrl, "/api/invitations", { method: "POST", headers: ownerHeaders, body: { name: "Alex", email: "alex@example.com", role: "agent", extension: "101" } });
  assert.equal(invited.response.status, 201);
  const agent = await request(baseUrl, "/api/invitations/accept", { method: "POST", body: { inviteCode: invited.body.inviteCode, password: "alex-long-password" } });
  const agentHeaders = { authorization: `Bearer ${agent.body.sessionToken}` };
  assert.equal((await request(baseUrl, "/api/gateways", { method: "POST", headers: agentHeaders, body: { label: "Nope", phoneNumber: "+15557654321" } })).response.status, 403);

  const paired = await request(baseUrl, "/api/gateways", { method: "POST", headers: ownerHeaders, body: { label: "Desk phone", phoneNumber: "+15557654321" } });
  const deviceId = paired.body.gateway.id;
  const gatewayHeaders = { authorization: `Bearer ${paired.body.pairingToken}` };
  await request(baseUrl, "/gateway/heartbeat", { method: "POST", headers: gatewayHeaders, body: { version: 1, event: "gateway.heartbeat", deviceId, sentAt: "2026-09-13T22:00:00.000Z", payload: { status: "ready" } } });
  const inbound = await request(baseUrl, "/gateway/inbound", { method: "POST", headers: gatewayHeaders, body: { version: 1, event: "inbound.message", deviceId, sentAt: "2026-09-13T22:01:00.000Z", payload: { messageId: "carrier-1", from: "+15551234567", to: "+15557654321", body: "I need help" } } });
  assert.equal(inbound.response.status, 202);
  assert.equal((await request(baseUrl, "/api/state", { headers: agentHeaders })).body.conversations.length, 0);

  const ownerState = await request(baseUrl, "/api/state", { headers: ownerHeaders });
  await request(baseUrl, `/api/conversations/${inbound.body.conversationId}/assignment`, { method: "POST", headers: ownerHeaders, body: { userId: agent.body.viewer.id } });
  const agentState = await request(baseUrl, "/api/state", { headers: agentHeaders });
  assert.equal(agentState.body.conversations.length, 1);
  const reply = await request(baseUrl, `/api/conversations/${inbound.body.conversationId}/reply`, { method: "POST", headers: agentHeaders, body: { body: "I can help with that." } });
  assert.equal(reply.response.status, 202);

  const outbound = await request(baseUrl, `/gateway/outbound?deviceId=${deviceId}`, { headers: gatewayHeaders });
  assert.equal(outbound.body.job.to, "+15551234567");
  const result = await request(baseUrl, "/gateway/outbound-result", { method: "POST", headers: gatewayHeaders, body: { version: 1, event: "outbound.result", deviceId, sentAt: "2026-09-13T22:02:00.000Z", payload: { jobId: outbound.body.job.jobId, status: "delivered" } } });
  assert.equal(result.response.status, 200);
  assert.equal(ownerState.body.permissions.manageInbox, true);
});
