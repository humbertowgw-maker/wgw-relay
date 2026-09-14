import { createHmac } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import { createStripeBilling } from "../src/stripeBilling.js";

test("creates a server-side Stripe subscription Checkout session with tenant metadata", async () => {
  let request;
  const billing = createStripeBilling({
    secretKey: "sk_test_example",
    priceId: "price_monthly",
    appBaseUrl: "https://relay.example.com/",
    webhookSecret: "whsec_example",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, json: async () => ({ id: "cs_test_123", url: "https://checkout.stripe.com/c/pay/cs_test_123" }) };
    },
  });

  const checkout = await billing.createCheckoutSession({ tenantId: "tenant_123", email: "owner@example.com" });
  assert.equal(checkout.checkoutSessionId, "cs_test_123");
  assert.equal(request.url, "https://api.stripe.com/v1/checkout/sessions");
  assert.equal(request.options.headers.authorization, "Bearer sk_test_example");
  const form = new URLSearchParams(request.options.body);
  assert.equal(form.get("mode"), "subscription");
  assert.equal(form.get("line_items[0][price]"), "price_monthly");
  assert.equal(form.get("metadata[tenant_id]"), "tenant_123");
  assert.equal(form.get("subscription_data[metadata][tenant_id]"), "tenant_123");
});

test("verifies Stripe webhook signatures before granting an entitlement", () => {
  const timestamp = 1_800_000_000;
  const event = {
    id: "evt_123",
    type: "checkout.session.completed",
    data: { object: { client_reference_id: "tenant_123", payment_status: "paid", customer: "cus_123", subscription: "sub_123" } },
  };
  const rawBody = Buffer.from(JSON.stringify(event));
  const secret = "whsec_example";
  const signature = createHmac("sha256", secret).update(`${timestamp}.${rawBody.toString("utf8")}`).digest("hex");
  const billing = createStripeBilling({ webhookSecret: secret, now: () => timestamp * 1000 });

  const verified = billing.verifyWebhook({ rawBody, signature: `t=${timestamp},v1=${signature}` });
  assert.equal(verified.id, event.id);
  assert.deepEqual(billing.entitlementFromEvent(verified), {
    tenantId: "tenant_123",
    eventId: "evt_123",
    status: "active",
    stripeCustomerId: "cus_123",
    stripeSubscriptionId: "sub_123",
  });
  assert.throws(() => billing.verifyWebhook({ rawBody, signature: `t=${timestamp},v1=wrong` }), /signature/);
});
