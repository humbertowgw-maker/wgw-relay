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

test("serves the owner connections map with truthful connection states", async (t) => {
  const { server, baseUrl } = await runningServer();
  t.after(() => server.close());

  const [index, app] = await Promise.all([fetch(`${baseUrl}/`), fetch(`${baseUrl}/app.js`)]);
  assert.equal(index.status, 200);
  assert.match(await index.text(), /data-view="connections"/);
  assert.equal(app.status, 200);
  const script = await app.text();
  assert.match(script, /function connectionsView\(\)/);
  assert.match(script, /renderPbxBridgeStatus/);
  assert.match(script, /Create Bridge enrollment credential/);
  assert.match(script, /Active — a current Relay heartbeat has confirmed it/);
  assert.match(script, /saved plan is never presented as a live connection/);
});

test("runs a signed-in tenant user flow with invitation permissions and paired-device delivery", async (t) => {
  const { server, baseUrl } = await runningServer();
  t.after(() => server.close());

  const owner = await request(baseUrl, "/api/register", { method: "POST", body: { organizationName: "WGW", name: "Owner", email: "owner@example.com", password: "owner-long-password" } });
  assert.equal(owner.response.status, 201);
  const ownerHeaders = { authorization: `Bearer ${owner.body.sessionToken}` };
  assert.equal((await request(baseUrl, "/api/state")).response.status, 401);
  assert.equal((await request(baseUrl, "/api/gateways", { method: "POST", headers: ownerHeaders, body: { label: "Too early" } })).response.status, 422);
  const phoneSetup = await request(baseUrl, "/api/phone-setup", { method: "POST", headers: ownerHeaders, body: { businessNumber: "+15557654321", businessPurpose: "Sales", callsEnabled: true, textsEnabled: true, voicemailEnabled: true, callForwardNumber: "+15551234567", notificationPhone: "+15551234567" } });
  assert.equal(phoneSetup.response.status, 200);

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

test("exposes the owner control center APIs without granting them to employees", async (t) => {
  const { server, baseUrl } = await runningServer();
  t.after(() => server.close());

  const owner = await request(baseUrl, "/api/register", { method: "POST", body: { organizationName: "WGW", name: "Owner", email: "owner@example.com", password: "owner-long-password" } });
  const ownerHeaders = { authorization: `Bearer ${owner.body.sessionToken}` };
  await request(baseUrl, "/api/phone-setup", { method: "POST", headers: ownerHeaders, body: { businessNumber: "+15557654321", businessPurpose: "Sales", callsEnabled: true, textsEnabled: true, voicemailEnabled: true, callForwardNumber: "+15551234567", notificationPhone: "+15551234567" } });

  const employee = await request(baseUrl, "/api/route-profiles", { method: "POST", headers: ownerHeaders, body: { name: "Alex", extension: "101", callForwardNumber: "+15550001111", routingTopics: "billing, phone plans", inviteEmail: "alex@example.com", role: "agent" } });
  assert.equal(employee.response.status, 201);
  assert.equal(employee.body.profile.status, "invited");
  const agent = await request(baseUrl, "/api/invitations/accept", { method: "POST", body: { inviteCode: employee.body.inviteCode, password: "alex-long-password" } });
  const agentHeaders = { authorization: `Bearer ${agent.body.sessionToken}` };

  assert.equal((await request(baseUrl, "/api/owner-delivery", { method: "POST", headers: ownerHeaders, body: { textsToOwner: true, voicemailsToOwner: true, alertMode: "summary" } })).response.status, 200);
  const callMap = await request(baseUrl, "/api/pbx-call-map", { method: "POST", headers: ownerHeaders, body: { label: "Current Mitel", type: "asterisk_mitel", primaryExtension: "101", ringSeconds: 25, fallback: "voicemail", voicemailExtension: "101" } });
  assert.equal(callMap.response.status, 200);
  const phoneConnection = await request(baseUrl, "/api/phone-connections", { method: "POST", headers: ownerHeaders, body: { type: "mitel", label: "Main office", pbxHost: "pbx.example.local", extension: "101" } });
  assert.equal(phoneConnection.response.status, 201);
  const bridge = await request(baseUrl, "/api/pbx-bridges", { method: "POST", headers: ownerHeaders, body: { label: "Office Bridge", connectionId: phoneConnection.body.id } });
  assert.equal(bridge.response.status, 201);
  const bridgeHeaders = { authorization: `Bearer ${bridge.body.enrollmentToken}` };
  assert.equal((await request(baseUrl, "/pbx-bridge/heartbeat", { method: "POST", headers: bridgeHeaders, body: { version: 1, event: "pbx_bridge.heartbeat", bridgeId: bridge.body.bridge.id, sentAt: "2026-09-13T22:03:00.000Z", payload: { status: "ready", callMapState: "applied", agentVersion: "0.1.0" } } })).response.status, 200);
  assert.equal((await request(baseUrl, "/api/phone-connections", { method: "POST", headers: agentHeaders, body: { type: "mitel", label: "Nope", extension: "101" } })).response.status, 403);
  assert.equal((await request(baseUrl, "/api/pbx-bridges", { method: "POST", headers: agentHeaders, body: { label: "Nope" } })).response.status, 403);
  assert.equal((await request(baseUrl, "/api/pbx-call-map", { method: "POST", headers: agentHeaders, body: { label: "Nope", type: "asterisk_mitel", primaryExtension: "101", ringSeconds: 25, fallback: "voicemail", voicemailExtension: "101" } })).response.status, 403);
  assert.equal((await request(baseUrl, "/api/my-route-profile", { method: "POST", headers: agentHeaders, body: { callForwardNumber: "+15550002222", routingTopics: "support" } })).response.status, 200);

  const ownerState = await request(baseUrl, "/api/state", { headers: ownerHeaders });
  const agentState = await request(baseUrl, "/api/state", { headers: agentHeaders });
  assert.equal(ownerState.body.routeProfiles[0].callForwardNumber, "+15550002222");
  assert.equal(ownerState.body.phoneConnections[0].type, "mitel");
  assert.equal(ownerState.body.tenant.pbxCallMap.primaryExtension, "101");
  assert.equal(ownerState.body.pbxBridges[0].state, "ready");
  assert.equal(ownerState.body.pbxBridges[0].callMapState, "applied");
  assert.equal(agentState.body.permissions.manageRouting, false);
  assert.equal(agentState.body.routeProfiles.length, 1);
  assert.equal((await request(baseUrl, `/api/pbx-bridges/${bridge.body.bridge.id}`, { method: "DELETE", headers: ownerHeaders })).response.status, 200);
  assert.equal((await request(baseUrl, "/pbx-bridge/heartbeat", { method: "POST", headers: bridgeHeaders, body: { version: 1, event: "pbx_bridge.heartbeat", bridgeId: bridge.body.bridge.id, sentAt: "2026-09-13T22:04:00.000Z", payload: { status: "ready", callMapState: "applied" } } })).response.status, 401);
});
