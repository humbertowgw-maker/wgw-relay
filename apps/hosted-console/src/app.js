import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { createRelayService } from "../../../packages/server/src/relayService.js";
import { createPbxBridgeService } from "../../../packages/server/src/pbxBridgeService.js";
import { createHostedRelayStore } from "./store.js";
import { createFileBackedRelayStore } from "./fileBackedStore.js";
import { createStripeBilling } from "./stripeBilling.js";

const MAX_BODY_BYTES = 64 * 1024;
const staticFiles = new Map([["/", "../public/index.html"], ["/app.js", "../public/app.js"], ["/styles.css", "../public/styles.css"]]);
const contentTypes = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };

function send(res, status, body = null, extraHeaders = {}) {
  const headers = {
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "cross-origin-resource-policy": "same-origin",
    ...extraHeaders,
  };
  if (status === 204) {
    res.writeHead(204, headers);
    res.end();
    return;
  }
  const serialized = JSON.stringify(body ?? {});
  res.writeHead(status, { ...headers, "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(serialized) });
  res.end(serialized);
}

function errorResponse(res, error) {
  const status = { VALIDATION: 422, CONFLICT: 409, NOT_FOUND: 404, FORBIDDEN: 403, UNAUTHENTICATED: 401, BILLING_CONFIG: 503, BILLING_PROVIDER: 502, BILLING_SIGNATURE: 400 }[error?.code] || 500;
  send(res, status, { error: status === 500 ? "Unexpected server error" : error.message });
}

async function jsonBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      const error = new Error("Request body is too large");
      error.code = "VALIDATION";
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("not an object");
    return body;
  } catch {
    const error = new Error("Request body must be a JSON object");
    error.code = "VALIDATION";
    throw error;
  }
}

async function rawBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      const error = new Error("Request body is too large");
      error.code = "VALIDATION";
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function bearer(req) {
  const value = req.headers.authorization;
  return typeof value === "string" && value.startsWith("Bearer ") ? value.slice(7) : "";
}

function routeMatch(pathname, expression) {
  const match = pathname.match(expression);
  return match ? decodeURIComponent(match[1]) : null;
}

function defaultStore() {
  const options = { billingRequired: process.env.BILLING_REQUIRED === "true" };
  return process.env.RELAY_DATA_PATH ? createFileBackedRelayStore({ ...options, filePath: process.env.RELAY_DATA_PATH }) : createHostedRelayStore(options);
}

async function staticResponse(res, pathname) {
  const relativePath = staticFiles.get(pathname);
  if (!relativePath) return false;
  const body = await readFile(fileURLToPath(new URL(relativePath, import.meta.url)));
  const extension = relativePath.slice(relativePath.lastIndexOf("."));
  res.writeHead(200, {
    "content-type": contentTypes[extension] || "application/octet-stream",
    "content-length": body.byteLength,
    "cache-control": "no-store",
    "content-security-policy": "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
  });
  res.end(body);
  return true;
}

/**
 * Transport boundary for the reference console. Session and tenant decisions
 * are delegated to the store so every protected operation remains tenant-scoped.
 */
export function createHostedConsole({
  store = defaultStore(),
  billing = createStripeBilling({
    secretKey: process.env.STRIPE_SECRET_KEY,
    priceId: process.env.STRIPE_PRICE_ID,
    appBaseUrl: process.env.APP_BASE_URL,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  }),
} = {}) {
  const relay = createRelayService(store);
  const pbxBridge = createPbxBridgeService(store);

  function actor(req) {
    const sessionToken = bearer(req);
    if (!sessionToken) {
      const error = new Error("Sign in to continue");
      error.code = "UNAUTHENTICATED";
      throw error;
    }
    return { actor: store.authenticateUser(sessionToken), sessionToken };
  }

  return async function handler(req, res) {
    const url = new URL(req.url || "/", "http://relay.local");
    const { pathname } = url;
    try {
      if (req.method === "GET" && pathname === "/health") return send(res, 200, { ok: true, service: "wgw-relay-hosted-console" });
      if (req.method === "GET" && pathname === "/api/status") return send(res, 200, store.status());

      if (req.method === "POST" && pathname === "/webhooks/stripe") {
        const event = billing.verifyWebhook({ rawBody: await rawBody(req), signature: req.headers["stripe-signature"] });
        const entitlement = billing.entitlementFromEvent(event);
        if (entitlement) store.applyStripeBillingEvent(entitlement);
        return send(res, 200, { received: true });
      }

      if (pathname.startsWith("/gateway/")) {
        const token = bearer(req);
        if (!token) return send(res, 401, { error: "Gateway authentication failed" });
        if (req.method === "POST" && pathname === "/gateway/heartbeat") {
          const result = await relay.heartbeat({ token, envelope: await jsonBody(req) });
          return send(res, result.status, result.body);
        }
        if (req.method === "POST" && pathname === "/gateway/inbound") {
          const result = await relay.receive({ token, envelope: await jsonBody(req) });
          return send(res, result.status, result.body);
        }
        if (req.method === "GET" && pathname === "/gateway/outbound") {
          const result = await relay.nextOutbound({ token, deviceId: url.searchParams.get("deviceId") || "" });
          return send(res, result.status, result.body);
        }
        if (req.method === "POST" && pathname === "/gateway/outbound-result") {
          const result = await relay.acknowledgeOutbound({ token, envelope: await jsonBody(req) });
          return send(res, result.status, result.body);
        }
        return send(res, 404, { error: "Gateway route was not found" });
      }

      if (pathname.startsWith("/pbx-bridge/")) {
        const token = bearer(req);
        if (!token) return send(res, 401, { error: "PBX Bridge authentication failed" });
        if (req.method === "POST" && pathname === "/pbx-bridge/heartbeat") {
          const result = await pbxBridge.heartbeat({ token, envelope: await jsonBody(req) });
          return send(res, result.status, result.body);
        }
        return send(res, 404, { error: "PBX Bridge route was not found" });
      }

      if (pathname.startsWith("/api/")) {
        if (req.method === "POST" && pathname === "/api/register") return send(res, 201, store.registerTenant(await jsonBody(req)));
        if (req.method === "POST" && pathname === "/api/login") return send(res, 200, store.signIn(await jsonBody(req)));
        if (req.method === "POST" && pathname === "/api/invitations/accept") return send(res, 201, store.acceptInvitation(await jsonBody(req)));

        const authenticated = actor(req);
        if (req.method === "POST" && pathname === "/api/logout") {
          store.signOut(authenticated.sessionToken);
          return send(res, 204);
        }
        if (req.method === "GET" && pathname === "/api/state") {
          const snapshot = store.snapshot({ actor: authenticated.actor });
          snapshot.tenant.billing = { ...snapshot.tenant.billing, checkoutAvailable: billing.checkoutConfigured(), webhookReady: billing.webhookConfigured() };
          return send(res, 200, snapshot);
        }
        if (req.method === "POST" && pathname === "/api/billing/checkout") {
          if (authenticated.actor.role !== "owner") return send(res, 403, { error: "Only the organization owner can start billing checkout" });
          const checkout = await billing.createCheckoutSession({ tenantId: authenticated.actor.tenantId, email: authenticated.actor.user.email });
          const billingState = store.recordBillingCheckout({ actor: authenticated.actor, checkoutSessionId: checkout.checkoutSessionId });
          return send(res, 201, { ...checkout, billing: billingState });
        }
        const billingExempt = req.method === "POST" && pathname === "/api/logout";
        if (!billingExempt && !store.hasBillingAccess({ actor: authenticated.actor })) return send(res, 402, { error: "An active Relay subscription is required before this organization can use phone-system features." });
        if (req.method === "POST" && pathname === "/api/profile") return send(res, 200, store.updateProfile({ actor: authenticated.actor, ...(await jsonBody(req)) }));
        if (req.method === "POST" && pathname === "/api/phone-setup") return send(res, 200, store.configurePhoneSetup({ actor: authenticated.actor, ...(await jsonBody(req)) }));
        if (req.method === "POST" && pathname === "/api/owner-delivery") return send(res, 200, store.configureOwnerDelivery({ actor: authenticated.actor, ...(await jsonBody(req)) }));
        if (req.method === "POST" && pathname === "/api/pbx-call-map") return send(res, 200, store.configurePbxCallMap({ actor: authenticated.actor, ...(await jsonBody(req)) }));
        if (req.method === "POST" && pathname === "/api/pbx-bridges") return send(res, 201, store.createPbxBridge({ actor: authenticated.actor, ...(await jsonBody(req)) }));
        if (req.method === "POST" && pathname === "/api/route-profiles") return send(res, 201, store.createRouteProfile({ actor: authenticated.actor, ...(await jsonBody(req)) }));
        if (req.method === "POST" && pathname === "/api/my-route-profile") return send(res, 200, store.updateMyRouteProfile({ actor: authenticated.actor, ...(await jsonBody(req)) }));
        if (req.method === "POST" && pathname === "/api/phone-connections") return send(res, 201, store.createPhoneConnection({ actor: authenticated.actor, ...(await jsonBody(req)) }));
        if (req.method === "POST" && pathname === "/api/invitations") return send(res, 201, store.createInvitation({ actor: authenticated.actor, ...(await jsonBody(req)) }));
        if (req.method === "POST" && pathname === "/api/gateways") return send(res, 201, store.pairGateway({ actor: authenticated.actor, ...(await jsonBody(req)) }));

        const routeProfileId = routeMatch(pathname, /^\/api\/route-profiles\/([^/]+)$/);
        if (req.method === "POST" && routeProfileId) return send(res, 200, store.updateRouteProfile({ actor: authenticated.actor, routeProfileId, ...(await jsonBody(req)) }));
        const pbxBridgeId = routeMatch(pathname, /^\/api\/pbx-bridges\/([^/]+)$/);
        if (req.method === "DELETE" && pbxBridgeId) return send(res, 200, store.revokePbxBridge({ actor: authenticated.actor, bridgeId: pbxBridgeId }));
        const assignmentId = routeMatch(pathname, /^\/api\/conversations\/([^/]+)\/assignment$/);
        if (req.method === "POST" && assignmentId) return send(res, 200, store.assignConversation({ actor: authenticated.actor, conversationId: assignmentId, ...(await jsonBody(req)) }));
        const optOutId = routeMatch(pathname, /^\/api\/conversations\/([^/]+)\/opt-out$/);
        if (req.method === "POST" && optOutId) return send(res, 200, store.setOptOut({ actor: authenticated.actor, conversationId: optOutId, ...(await jsonBody(req)) }));
        const replyId = routeMatch(pathname, /^\/api\/conversations\/([^/]+)\/reply$/);
        if (req.method === "POST" && replyId) return send(res, 202, store.queueReply({ actor: authenticated.actor, conversationId: replyId, ...(await jsonBody(req)) }));
        return send(res, 404, { error: "API route was not found" });
      }

      if (req.method === "GET" && await staticResponse(res, pathname)) return;
      return send(res, 404, { error: "Not found" });
    } catch (error) {
      return errorResponse(res, error);
    }
  };
}

export function createHostedConsoleServer(options) {
  return createServer(createHostedConsole(options));
}
