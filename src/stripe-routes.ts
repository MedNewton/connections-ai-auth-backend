import crypto from "crypto";
import { FastifyInstance } from "fastify";
import { stripe } from "./stripe.js";
import { db } from "./firebase.js";
import { env } from "./env.js";

const CONFIRMATION_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateConfirmation(length = 8): string {
  let result = "";
  for (let i = 0; i < length; i++) {
    result += CONFIRMATION_CHARS[Math.floor(Math.random() * CONFIRMATION_CHARS.length)];
  }
  return result;
}

async function findCreatorByField(field: string, value: string) {
  const snapshot = await db
    .ref("/creators")
    .orderByChild(field)
    .equalTo(value)
    .once("value");
  if (!snapshot.exists()) return null;
  const data = snapshot.val();
  const key = Object.keys(data)[0];
  return { key, ...data[key] };
}

export async function stripeRoutes(fastify: FastifyInstance) {
  // ──────────────────────────────────────────────
  // POST /stripe/create-connect-account
  // ──────────────────────────────────────────────
  fastify.post<{
    Body: { userId: string; email: string; businessType: "individual" | "company" };
  }>("/create-connect-account", async (req, reply) => {
    const { userId, email, businessType } = req.body;

    try {
      // Check if creator already exists for this user
      const existing = await findCreatorByField("userId", userId);

      let creatorId: string;
      let stripeAccountId: string;

      if (existing?.stripeAccountId) {
        // Already has a Stripe account — just create a new Account Link
        creatorId = existing.id;
        stripeAccountId = existing.stripeAccountId;
      } else {
        // Create new Stripe Connect Express account
        const account = await stripe.accounts.create({
          type: "express",
          email,
          business_type: businessType,
          capabilities: {
            card_payments: { requested: true },
            transfers: { requested: true },
          },
        });

        stripeAccountId = account.id;
        creatorId = "c_" + crypto.randomUUID().replace(/-/g, "");
        const now = Date.now();

        // Write creator record to Firebase
        await db.ref(`/creators/${creatorId}`).set({
          id: creatorId,
          userId,
          stripeAccountId,
          businessName: null,
          businessType,
          kyb: { status: "pending", submittedAt: now, verifiedAt: null },
          payout: { method: "stripe", configured: false },
          stats: { totalEvents: 0, totalTicketsSold: 0, rating: null },
          createdAt: now,
          updatedAt: now,
        });

        // Update user record
        await db.ref(`/users/${userId}`).update({
          userType: "creator",
          creatorId,
          updatedAt: now,
        });
      }

      // Create Account Link for onboarding
      const accountLink = await stripe.accountLinks.create({
        account: stripeAccountId,
        refresh_url: "connectionsai://stripe-refresh",
        return_url: "connectionsai://stripe-return",
        type: "account_onboarding",
      });

      return reply.send({
        url: accountLink.url,
        creatorId,
        stripeAccountId,
      });
    } catch (err: any) {
      req.log.error(err, "Failed to create connect account");
      return reply.status(500).send({ error: err.message });
    }
  });

  // ──────────────────────────────────────────────
  // POST /stripe/create-payment-intent
  // ──────────────────────────────────────────────
  fastify.post<{ Body: { purchaseId: string } }>(
    "/create-payment-intent",
    async (req, reply) => {
      const { purchaseId } = req.body;

      try {
        // 1. Read purchase
        const purchaseSnap = await db.ref(`/purchases/${purchaseId}`).once("value");
        if (!purchaseSnap.exists()) {
          return reply.status(404).send({ error: "Purchase not found" });
        }
        const purchase = purchaseSnap.val();

        // 2. Validate status
        if (purchase.status !== "reserved") {
          return reply.status(400).send({ error: `Invalid purchase status: ${purchase.status}` });
        }
        if (purchase.reservationExpiresAt <= Date.now()) {
          return reply.status(400).send({ error: "Reservation expired" });
        }

        // 3. Read event to get creator
        const eventSnap = await db.ref(`/events/${purchase.eventId}`).once("value");
        if (!eventSnap.exists()) {
          return reply.status(404).send({ error: "Event not found" });
        }
        const event = eventSnap.val();

        // 4. Find creator's Stripe account
        const creator = await findCreatorByField("userId", event.createdBy);
        if (!creator?.stripeAccountId) {
          return reply.status(400).send({ error: "Creator has not completed Stripe setup" });
        }

        // 5. Create PaymentIntent
        const paymentIntent = await stripe.paymentIntents.create({
          amount: Math.round(purchase.total * 100),
          currency: purchase.currency.toLowerCase(),
          application_fee_amount: Math.round(purchase.fees * 100),
          transfer_data: {
            destination: creator.stripeAccountId,
          },
          metadata: {
            purchaseId,
            userId: purchase.userId,
            eventId: purchase.eventId,
          },
        });

        // 6. Update purchase
        await db.ref(`/purchases/${purchaseId}`).update({
          paymentIntentId: paymentIntent.id,
          paymentMethod: "stripe",
          status: "payment_processing",
          updatedAt: Date.now(),
        });

        return reply.send({
          clientSecret: paymentIntent.client_secret,
          paymentIntentId: paymentIntent.id,
        });
      } catch (err: any) {
        req.log.error(err, "Failed to create payment intent");
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  // ──────────────────────────────────────────────
  // POST /stripe/webhooks
  // ──────────────────────────────────────────────

  // Override JSON parser for this plugin scope to preserve raw body
  fastify.register(async function webhookPlugin(instance) {
    instance.addContentTypeParser(
      "application/json",
      { parseAs: "buffer" },
      (_req, body, done) => {
        done(null, body);
      }
    );

    instance.post("/webhooks", async (req, reply) => {
      const sig = req.headers["stripe-signature"] as string;

      let event;
      try {
        event = stripe.webhooks.constructEvent(
          req.body as Buffer,
          sig,
          env.stripeWebhookSecret
        );
      } catch (err: any) {
        req.log.error(err, "Webhook signature verification failed");
        return reply.status(400).send({ error: `Webhook Error: ${err.message}` });
      }

      req.log.info({ eventType: event.type, eventId: event.id }, "Stripe webhook received");

      try {
        switch (event.type) {
          case "payment_intent.succeeded":
            await handlePaymentSucceeded(event.data.object, req.log);
            break;
          case "payment_intent.payment_failed":
            await handlePaymentFailed(event.data.object, req.log);
            break;
          case "account.updated":
            await handleAccountUpdated(event.data.object, req.log);
            break;
          default:
            req.log.info({ eventType: event.type }, "Unhandled event type");
        }
      } catch (err: any) {
        req.log.error(err, "Error processing webhook event");
      }

      return reply.send({ received: true });
    });
  });

  // ──────────────────────────────────────────────
  // GET /stripe/connect-account-status/:userId
  // ──────────────────────────────────────────────
  fastify.get<{ Params: { userId: string } }>(
    "/connect-account-status/:userId",
    async (req, reply) => {
      const { userId } = req.params;

      try {
        const creator = await findCreatorByField("userId", userId);

        if (!creator?.stripeAccountId) {
          return reply.send({ status: "not_started" });
        }

        const account = await stripe.accounts.retrieve(creator.stripeAccountId);

        return reply.send({
          status:
            account.charges_enabled && account.payouts_enabled
              ? "verified"
              : "pending",
          chargesEnabled: account.charges_enabled,
          payoutsEnabled: account.payouts_enabled,
          kybStatus: creator.kyb?.status,
        });
      } catch (err: any) {
        req.log.error(err, "Failed to get connect account status");
        return reply.status(500).send({ error: err.message });
      }
    }
  );
}

// ──────────────────────────────────────────────
// Webhook handlers
// ──────────────────────────────────────────────

async function handlePaymentSucceeded(paymentIntent: any, log: any) {
  const purchaseId = paymentIntent.metadata?.purchaseId;
  if (!purchaseId) {
    log.warn("payment_intent.succeeded missing purchaseId in metadata");
    return;
  }

  const purchaseSnap = await db.ref(`/purchases/${purchaseId}`).once("value");
  if (!purchaseSnap.exists()) {
    log.warn({ purchaseId }, "Purchase not found for succeeded payment");
    return;
  }

  const purchase = purchaseSnap.val();

  // Idempotency check
  if (purchase.status === "completed") {
    log.info({ purchaseId }, "Purchase already completed, skipping");
    return;
  }

  const now = Date.now();
  const ticketCount = (purchase.lineItems || []).reduce(
    (sum: number, item: any) => sum + (item.quantity || 0),
    0
  );

  // Update purchase
  await db.ref(`/purchases/${purchaseId}`).update({
    status: "completed",
    completedAt: now,
    confirmation: {
      confirmationNumber: generateConfirmation(),
      purchasedAt: new Date().toISOString(),
      ticketCount,
      totalAmount: purchase.total,
      currency: purchase.currency,
    },
    reservedAt: null,
    reservationExpiresAt: null,
    updatedAt: now,
  });

  // Mark all tickets as sold
  const ticketUpdates: Record<string, any> = {};
  for (const item of purchase.lineItems || []) {
    for (const ticketId of item.ticketIds || []) {
      ticketUpdates[`/events/${purchase.eventId}/tickets/${ticketId}/status`] = "sold";
      ticketUpdates[`/events/${purchase.eventId}/tickets/${ticketId}/reservationExpiresAt`] = null;
      ticketUpdates[`/events/${purchase.eventId}/tickets/${ticketId}/updatedAt`] = now;
    }
  }
  if (Object.keys(ticketUpdates).length > 0) {
    await db.ref().update(ticketUpdates);
  }

  // Create user ticket entry
  await db.ref(`/users/${purchase.userId}/myTickets/${purchaseId}`).set({
    purchaseId,
    eventId: purchase.eventId,
    eventTitle: purchase.eventTitle,
    eventStartAt: purchase.eventStartAt,
    eventHeroImage: purchase.eventHeroImage || null,
    ticketCount,
    status: "completed",
    purchasedAt: now,
  });

  log.info({ purchaseId }, "Payment succeeded, purchase completed");
}

async function handlePaymentFailed(paymentIntent: any, log: any) {
  const purchaseId = paymentIntent.metadata?.purchaseId;
  if (!purchaseId) {
    log.warn("payment_intent.payment_failed missing purchaseId in metadata");
    return;
  }

  const purchaseSnap = await db.ref(`/purchases/${purchaseId}`).once("value");
  if (!purchaseSnap.exists()) {
    log.warn({ purchaseId }, "Purchase not found for failed payment");
    return;
  }

  const purchase = purchaseSnap.val();
  const now = Date.now();

  // Update purchase
  await db.ref(`/purchases/${purchaseId}`).update({
    status: "failed",
    failureReason: paymentIntent.last_payment_error?.message || "Payment failed",
    updatedAt: now,
  });

  // Release reserved tickets
  const ticketUpdates: Record<string, any> = {};
  for (const item of purchase.lineItems || []) {
    for (const ticketId of item.ticketIds || []) {
      const path = `/events/${purchase.eventId}/tickets/${ticketId}`;
      ticketUpdates[`${path}/status`] = "available";
      ticketUpdates[`${path}/purchaseId`] = null;
      ticketUpdates[`${path}/userId`] = null;
      ticketUpdates[`${path}/reservedAt`] = null;
      ticketUpdates[`${path}/reservationExpiresAt`] = null;
      ticketUpdates[`${path}/updatedAt`] = now;
    }
  }
  if (Object.keys(ticketUpdates).length > 0) {
    await db.ref().update(ticketUpdates);
  }

  log.info({ purchaseId }, "Payment failed, tickets released");
}

async function handleAccountUpdated(account: any, log: any) {
  const creator = await findCreatorByField("stripeAccountId", account.id);
  if (!creator) {
    log.warn({ stripeAccountId: account.id }, "No creator found for account.updated");
    return;
  }

  const updates: Record<string, any> = { updatedAt: Date.now() };

  if (account.charges_enabled && account.payouts_enabled) {
    updates["kyb/status"] = "verified";
    updates["kyb/verifiedAt"] = Date.now();
    updates["payout/configured"] = true;
  } else if (account.requirements?.disabled_reason) {
    updates["kyb/status"] = "rejected";
  }
  // else keep as "pending"

  await db.ref(`/creators/${creator.key}`).update(updates);
  log.info({ creatorKey: creator.key, chargesEnabled: account.charges_enabled }, "Creator account updated");
}
