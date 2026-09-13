import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createHostedConsoleServer } from "../src/app.js";

const adminToken = "test-admin-token-with-enough-length";

async function runningServer() {
  const server = createHostedConsoleServer({ adminToken });
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

test("runs a protected operator and paired-gateway message flow", async (t) => {
  const { server, baseUrl } = await runningServer();
  t.after(() => server.close());
  const admin = { "x-relay-admin": adminToken };

  assert.equal((await request(baseUrl, "/api/state")).response.status, 401);
  const onboarding = await request(baseUrl, "/api/onboarding", {
    method: "POST",
    headers: admin,
    body: { organizationName: "WGW", mainNumber: "+15557654321", ownerName: "Owner" },
  });
  assert.equal(onboarding.response.status, 201);

  const paired = await request(baseUrl, "/api/gateways", {
    method: "POST",
    headers: admin,
    body: { label: "Desk phone", phoneNumber: "+15557654321" },
  });
  const deviceId = paired.body.gateway.id;
  const gatewayHeaders = { authorization: `Bearer ${paired.body.pairingToken}` };
  const heartbeat = await request(baseUrl, "/gateway/heartbeat", {
    method: "POST",
    headers: gatewayHeaders,
    body: { version: 1, event: "gateway.heartbeat", deviceId, sentAt: "2026-09-13T22:00:00.000Z", payload: { status: "ready", batteryPct: 90 } },
  });
  assert.equal(heartbeat.response.status, 200);

  const inbound = await request(baseUrl, "/gateway/inbound", {
    method: "POST",
    headers: gatewayHeaders,
    body: { version: 1, event: "inbound.message", deviceId, sentAt: "2026-09-13T22:01:00.000Z", payload: { messageId: "carrier-1", from: "+15551234567", to: "+15557654321", body: "I need help" } },
  });
  assert.equal(inbound.response.status, 202);

  const state = await request(baseUrl, "/api/state", { headers: admin });
  const conversation = state.body.conversations[0];
  const owner = state.body.employees[0];
  assert.equal(conversation.ownerId, null);
  await request(baseUrl, `/api/conversations/${conversation.id}/assignment`, { method: "POST", headers: admin, body: { employeeId: owner.id } });
  const reply = await request(baseUrl, `/api/conversations/${conversation.id}/reply`, { method: "POST", headers: admin, body: { body: "I can help with that." } });
  assert.equal(reply.response.status, 202);

  const outbound = await request(baseUrl, `/gateway/outbound?deviceId=${deviceId}`, { headers: gatewayHeaders });
  assert.equal(outbound.response.status, 200);
  assert.equal(outbound.body.job.to, "+15551234567");
  const result = await request(baseUrl, "/gateway/outbound-result", {
    method: "POST",
    headers: gatewayHeaders,
    body: { version: 1, event: "outbound.result", deviceId, sentAt: "2026-09-13T22:02:00.000Z", payload: { jobId: outbound.body.job.jobId, status: "delivered" } },
  });
  assert.equal(result.response.status, 200);
});
