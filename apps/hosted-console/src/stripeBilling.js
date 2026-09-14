import { createHmac, timingSafeEqual } from "node:crypto";

const STRIPE_API = "https://api.stripe.com/v1";
const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

function configuredValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function billingError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function signatureParts(header) {
  if (typeof header !== "string" || !header) return { timestamp: null, signatures: [] };
  const parts = header.split(",").map((part) => part.trim().split("=", 2));
  const timestamp = parts.find(([key]) => key === "t")?.[1] || null;
  return { timestamp, signatures: parts.filter(([key]) => key === "v1").map(([, value]) => value).filter(Boolean) };
}

function sameSignature(expected, candidate) {
  if (typeof candidate !== "string") return false;
  const expectedBuffer = Buffer.from(expected, "hex");
  const candidateBuffer = Buffer.from(candidate, "hex");
  return expectedBuffer.length === candidateBuffer.length && timingSafeEqual(expectedBuffer, candidateBuffer);
}

function statusFromStripeSubscription(status) {
  if (["active", "trialing"].includes(status)) return status;
  if (["past_due", "unpaid", "incomplete", "incomplete_expired", "paused"].includes(status)) return "past_due";
  if (["canceled", "cancelled"].includes(status)) return "canceled";
  return "unpaid";
}

/**
 * Minimal Stripe Checkout adapter. Hosted Checkout keeps card entry out of the
 * Relay app. Webhooks are HMAC-verified before billing state changes.
 */
export function createStripeBilling({ secretKey, priceId, appBaseUrl, webhookSecret, fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
  const config = {
    secretKey: configuredValue(secretKey),
    priceId: configuredValue(priceId),
    appBaseUrl: configuredValue(appBaseUrl).replace(/\/$/, ""),
    webhookSecret: configuredValue(webhookSecret),
  };

  function checkoutConfigured() {
    return Boolean(config.secretKey && config.priceId && config.appBaseUrl);
  }

  function webhookConfigured() {
    return Boolean(config.webhookSecret);
  }

  function checkoutUrl(path) {
    if (!config.appBaseUrl) throw billingError("BILLING_CONFIG", "APP_BASE_URL must be configured before starting checkout");
    return `${config.appBaseUrl}${path}`;
  }

  return {
    checkoutConfigured,
    webhookConfigured,

    async createCheckoutSession({ tenantId, email }) {
      if (!checkoutConfigured()) throw billingError("BILLING_CONFIG", "Billing is not configured yet. Ask the Relay owner to finish Stripe setup.");
      if (typeof fetchImpl !== "function") throw billingError("BILLING_CONFIG", "This runtime cannot start a Stripe Checkout session");
      const form = new URLSearchParams({
        mode: "subscription",
        "line_items[0][price]": config.priceId,
        "line_items[0][quantity]": "1",
        customer_email: email,
        client_reference_id: tenantId,
        "metadata[tenant_id]": tenantId,
        "subscription_data[metadata][tenant_id]": tenantId,
        success_url: checkoutUrl("/?checkout=success&session_id={CHECKOUT_SESSION_ID}"),
        cancel_url: checkoutUrl("/?checkout=cancelled"),
      });
      let response;
      try {
        response = await fetchImpl(`${STRIPE_API}/checkout/sessions`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${config.secretKey}`,
            "content-type": "application/x-www-form-urlencoded",
          },
          body: form,
        });
      } catch {
        throw billingError("BILLING_PROVIDER", "Stripe Checkout could not be reached. Please try again.");
      }
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.id || !body?.url) throw billingError("BILLING_PROVIDER", "Stripe could not start Checkout. Verify the configured Price ID and try again.");
      return { checkoutSessionId: body.id, checkoutUrl: body.url };
    },

    verifyWebhook({ rawBody, signature }) {
      if (!webhookConfigured()) throw billingError("BILLING_CONFIG", "Stripe webhook verification is not configured");
      const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody || "");
      const { timestamp, signatures } = signatureParts(signature);
      const timestampSeconds = Number(timestamp);
      if (!Number.isInteger(timestampSeconds) || !signatures.length || Math.abs(Math.floor(now() / 1000) - timestampSeconds) > SIGNATURE_TOLERANCE_SECONDS) throw billingError("BILLING_SIGNATURE", "Stripe webhook signature was not accepted");
      const expected = createHmac("sha256", config.webhookSecret).update(`${timestamp}.${body.toString("utf8")}`).digest("hex");
      if (!signatures.some((candidate) => sameSignature(expected, candidate))) throw billingError("BILLING_SIGNATURE", "Stripe webhook signature was not accepted");
      try {
        const event = JSON.parse(body.toString("utf8"));
        if (!event || typeof event !== "object" || !event.id || !event.type || !event.data?.object) throw new Error("malformed");
        return event;
      } catch {
        throw billingError("BILLING_SIGNATURE", "Stripe webhook payload was not accepted");
      }
    },

    entitlementFromEvent(event) {
      const object = event?.data?.object;
      if (!object || typeof object !== "object") return null;
      if (event.type === "checkout.session.completed") {
        const tenantId = object.client_reference_id || object.metadata?.tenant_id;
        if (!tenantId) return null;
        return {
          tenantId,
          eventId: event.id,
          status: ["paid", "no_payment_required"].includes(object.payment_status) ? "active" : "unpaid",
          stripeCustomerId: typeof object.customer === "string" ? object.customer : null,
          stripeSubscriptionId: typeof object.subscription === "string" ? object.subscription : null,
        };
      }
      if (["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"].includes(event.type)) {
        const tenantId = object.metadata?.tenant_id;
        if (!tenantId) return null;
        return {
          tenantId,
          eventId: event.id,
          status: event.type === "customer.subscription.deleted" ? "canceled" : statusFromStripeSubscription(object.status),
          stripeCustomerId: typeof object.customer === "string" ? object.customer : null,
          stripeSubscriptionId: typeof object.id === "string" ? object.id : null,
        };
      }
      return null;
    },
  };
}
