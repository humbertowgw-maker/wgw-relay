import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { createRelayService } from "../../../packages/server/src/relayService.js";
import { createHostedRelayStore } from "./store.js";

const MAX_BODY_BYTES = 64 * 1024;
const staticFiles = new Map([
  ["/", "../public/index.html"],
  ["/app.js", "../public/app.js"],
  ["/styles.css", "../public/styles.css"],
]);
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

function response(res, status, body = null) {
  if (status === 204) {
    res.writeHead(204);
    res.end();
    return;
  }
  const serialized = JSON.stringify(body ?? {});
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(serialized),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(serialized);
}

function errorResponse(res, error) {
  const status = {
    VALIDATION: 422,
    CONFLICT: 409,
    NOT_CONFIGURED: 409,
    NOT_FOUND: 404,
    FORBIDDEN: 403,
  }[error?.code] || 500;
  response(res, status, { error: status === 500 ? "Unexpected server error" : error.message });
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
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
    return value;
  } catch {
    const error = new Error("Request body must be a JSON object");
    error.code = "VALIDATION";
    throw error;
  }
}

function bearer(req) {
  const value = req.headers.authorization;
  return typeof value === "string" && value.startsWith("Bearer ") ? value.slice(7) : "";
}

function routeMatch(pathname, expression) {
  const match = pathname.match(expression);
  return match ? decodeURIComponent(match[1]) : null;
}

async function staticResponse(res, pathname) {
  const relativePath = staticFiles.get(pathname);
  if (!relativePath) return false;
  const url = new URL(relativePath, import.meta.url);
  const body = await readFile(fileURLToPath(url));
  const extension = relativePath.slice(relativePath.lastIndexOf("."));
  res.writeHead(200, {
    "content-type": contentTypes[extension] || "application/octet-stream",
    "content-length": body.byteLength,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(body);
  return true;
}

/**
 * Creates a local runnable hosted-console contract. Its store is intentionally
 * injected so a production deployment can replace it with durable storage.
 */
export function createHostedConsole({ adminToken, store = createHostedRelayStore() } = {}) {
  if (typeof adminToken !== "string" || adminToken.length < 16) {
    throw new Error("adminToken must be at least 16 characters");
  }
  const relay = createRelayService(store);

  function isAdmin(req) {
    return req.headers["x-relay-admin"] === adminToken;
  }

  return async function handler(req, res) {
    const url = new URL(req.url || "/", "http://relay.local");
    const { pathname } = url;
    try {
      if (req.method === "GET" && pathname === "/health") {
        return response(res, 200, { ok: true, service: "wgw-relay-hosted-console" });
      }
      if (req.method === "GET" && pathname === "/api/status") {
        return response(res, 200, { configured: store.snapshot().configured });
      }
      if (pathname.startsWith("/gateway/")) {
        const token = bearer(req);
        if (!token) return response(res, 401, { error: "Gateway authentication failed" });
        if (req.method === "POST" && pathname === "/gateway/heartbeat") {
          const result = await relay.heartbeat({ token, envelope: await jsonBody(req) });
          return response(res, result.status, result.body);
        }
        if (req.method === "POST" && pathname === "/gateway/inbound") {
          const result = await relay.receive({ token, envelope: await jsonBody(req) });
          return response(res, result.status, result.body);
        }
        if (req.method === "GET" && pathname === "/gateway/outbound") {
          const result = await relay.nextOutbound({ token, deviceId: url.searchParams.get("deviceId") || "" });
          return response(res, result.status, result.body);
        }
        if (req.method === "POST" && pathname === "/gateway/outbound-result") {
          const result = await relay.acknowledgeOutbound({ token, envelope: await jsonBody(req) });
          return response(res, result.status, result.body);
        }
        return response(res, 404, { error: "Gateway route was not found" });
      }
      if (pathname.startsWith("/api/")) {
        if (!isAdmin(req)) return response(res, 401, { error: "Admin authentication required" });
        if (req.method === "GET" && pathname === "/api/state") return response(res, 200, store.snapshot());
        if (req.method === "POST" && pathname === "/api/onboarding") {
          return response(res, 201, store.setup(await jsonBody(req)));
        }
        if (req.method === "POST" && pathname === "/api/employees") {
          return response(res, 201, store.addEmployee(await jsonBody(req)));
        }
        if (req.method === "POST" && pathname === "/api/gateways") {
          return response(res, 201, store.pairGateway(await jsonBody(req)));
        }
        const assignmentId = routeMatch(pathname, /^\/api\/conversations\/([^/]+)\/assignment$/);
        if (req.method === "POST" && assignmentId) {
          return response(res, 200, store.assignConversation({ conversationId: assignmentId, ...(await jsonBody(req)) }));
        }
        const optOutId = routeMatch(pathname, /^\/api\/conversations\/([^/]+)\/opt-out$/);
        if (req.method === "POST" && optOutId) {
          return response(res, 200, store.setOptOut({ conversationId: optOutId, ...(await jsonBody(req)) }));
        }
        const replyId = routeMatch(pathname, /^\/api\/conversations\/([^/]+)\/reply$/);
        if (req.method === "POST" && replyId) {
          return response(res, 202, store.queueReply({ conversationId: replyId, ...(await jsonBody(req)) }));
        }
        return response(res, 404, { error: "API route was not found" });
      }
      if (req.method === "GET" && await staticResponse(res, pathname)) return;
      return response(res, 404, { error: "Not found" });
    } catch (error) {
      return errorResponse(res, error);
    }
  };
}

export function createHostedConsoleServer(options) {
  return createServer(createHostedConsole(options));
}
