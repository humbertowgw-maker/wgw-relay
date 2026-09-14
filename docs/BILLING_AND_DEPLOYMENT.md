# Billing and deployment

Relay now includes a Stripe-hosted subscription gate. It is deliberately
disabled in local development and fails closed in production when billing is
required but not configured.

## Configure Stripe

1. Create a recurring Relay subscription Price in the business Stripe account.
2. Set these production secrets in the deployment environment, never in Git:

   - `BILLING_REQUIRED=true`
   - `APP_BASE_URL=https://your-public-relay-domain`
   - `STRIPE_SECRET_KEY`
   - `STRIPE_PRICE_ID`
   - `STRIPE_WEBHOOK_SECRET`
   - `RELAY_DATA_PATH=/data/relay-store.json` on a mounted persistent volume

3. Configure Stripe to send these events to
   `https://your-public-relay-domain/webhooks/stripe`:

   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`

The owner is redirected to Stripe-hosted Checkout. Relay verifies the signed
webhook before allowing live phone-system features. A successful browser return
does not unlock an account by itself.

## Deploy container

The included `Dockerfile` runs the console on `PORT` and listens on `HOST`.
Set `HOST=0.0.0.0` in a container platform, mount a persistent volume at
`/data`, set `RELAY_DATA_PATH=/data/relay-store.json`, and use `/health` for
the health check.

The file-backed store is appropriate only for one Relay process with a mounted
private volume. Before scaling beyond one instance or publicly onboarding
customers, replace it with a durable tenant database and add encrypted secret
management, recovery/MFA, backups, rate limiting, monitoring, and a durable
Stripe event ledger.
