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
  // Generates a Stripe OAuth URL for Standard Connect
  // ──────────────────────────────────────────────
  fastify.post<{
    Body: { userId: string; email: string };
  }>("/create-connect-account", async (req, reply) => {
    const { userId, email } = req.body;

    try {
      // Check if creator already exists for this user
      const existing = await findCreatorByField("userId", userId);

      if (existing?.stripeAccountId) {
        return reply.send({
          alreadyConnected: true,
          creatorId: existing.id,
          stripeAccountId: existing.stripeAccountId,
        });
      }

      // Generate Stripe OAuth URL — creator connects their own account
      const params = new URLSearchParams({
        response_type: "code",
        client_id: env.stripeClientId,
        scope: "read_write",
        redirect_uri: `${env.baseUrl}/stripe/connect-callback`,
        "stripe_user[email]": email,
        state: userId,
      });

      const url = `https://connect.stripe.com/oauth/authorize?${params.toString()}`;

      return reply.send({ url });
    } catch (err: any) {
      req.log.error(err, "Failed to create connect link");
      return reply.status(500).send({ error: err.message });
    }
  });

  // ──────────────────────────────────────────────
  // GET /stripe/connect-callback
  // Handles Stripe OAuth redirect after creator authorizes
  // ──────────────────────────────────────────────
  fastify.get<{
    Querystring: { code?: string; state?: string; error?: string; error_description?: string };
  }>("/connect-callback", async (req, reply) => {
    const { code, state: userId, error, error_description } = req.query;

    if (error) {
      req.log.error({ error, error_description }, "Stripe OAuth error");
      return reply.type("text/html").send(`
        <!DOCTYPE html>
        <html>
          <head>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <title>Connection Failed</title>
            <style>
              body { font-family: -apple-system, system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #F6F6F6; text-align: center; padding: 20px; }
              .card { background: white; border-radius: 16px; padding: 40px; max-width: 360px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
              h1 { color: #EF4444; font-size: 24px; margin-bottom: 12px; }
              p { color: #6B7280; font-size: 16px; line-height: 1.5; }
            </style>
          </head>
          <body>
            <div class="card">
              <h1>Connection Failed</h1>
              <p>${error_description || "Something went wrong. Please try again from the app."}</p>
            </div>
          </body>
        </html>
      `);
    }

    if (!code || !userId) {
      return reply.status(400).send({ error: "Missing code or state" });
    }

    try {
      // Exchange OAuth code for the creator's Stripe account ID
      const response = await stripe.oauth.token({
        grant_type: "authorization_code",
        code,
      });

      const stripeAccountId = response.stripe_user_id!;
      const creatorId = "c_" + crypto.randomUUID().replace(/-/g, "");
      const now = Date.now();

      // Write creator record to Firebase
      await db.ref(`/creators/${creatorId}`).set({
        id: creatorId,
        userId,
        stripeAccountId,
        businessName: null,
        businessType: "individual",
        kyb: { status: "verified", submittedAt: now, verifiedAt: now },
        payout: { method: "stripe", configured: true },
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

      req.log.info({ creatorId, stripeAccountId, userId }, "Creator connected via OAuth");

      // Show success page
      return reply.type("text/html").send(`
        <!DOCTYPE html>
        <html>
          <head>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <title>Connected!</title>
            <style>
              body { font-family: -apple-system, system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #F6F6F6; text-align: center; padding: 20px; }
              .card { background: white; border-radius: 16px; padding: 40px; max-width: 360px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
              h1 { color: #10B981; font-size: 24px; margin-bottom: 12px; }
              p { color: #6B7280; font-size: 16px; line-height: 1.5; }
            </style>
          </head>
          <body>
            <div class="card">
              <h1>Stripe Connected!</h1>
              <p>Your account is linked. You can close this page and return to the app.</p>
            </div>
          </body>
        </html>
      `);
    } catch (err: any) {
      req.log.error(err, "Failed to complete Stripe OAuth");
      return reply.type("text/html").send(`
        <!DOCTYPE html>
        <html>
          <head>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <title>Connection Failed</title>
            <style>
              body { font-family: -apple-system, system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #F6F6F6; text-align: center; padding: 20px; }
              .card { background: white; border-radius: 16px; padding: 40px; max-width: 360px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
              h1 { color: #EF4444; font-size: 24px; margin-bottom: 12px; }
              p { color: #6B7280; font-size: 16px; line-height: 1.5; }
            </style>
          </head>
          <body>
            <div class="card">
              <h1>Connection Failed</h1>
              <p>Something went wrong. Please try again from the app.</p>
            </div>
          </body>
        </html>
      `);
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

        const isVerified =
          account.charges_enabled && account.payouts_enabled;

        // Sync Firebase if Stripe says verified but Firebase still shows pending
        if (isVerified && creator.kyb?.status !== "verified") {
          const now = Date.now();
          await db.ref(`/creators/${creator.key}`).update({
            "kyb/status": "verified",
            "kyb/verifiedAt": now,
            "payout/configured": true,
            updatedAt: now,
          });
          req.log.info({ creatorKey: creator.key }, "Synced verified status to Firebase");
        }

        return reply.send({
          status: isVerified ? "verified" : "pending",
          chargesEnabled: account.charges_enabled,
          payoutsEnabled: account.payouts_enabled,
          kybStatus: isVerified ? "verified" : creator.kyb?.status,
        });
      } catch (err: any) {
        req.log.error(err, "Failed to get connect account status");
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  fastify.get("/connect-return", async (_req, reply) => {
    return reply.type("text/html").send(`                                                                                                                              
      <!DOCTYPE html>                                                                                                                                                  
      <html>                                                                                                                                                           
        <head>                                              
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>Verification Submitted</title>                                                                                                                        
          <style>
            body { font-family: -apple-system, system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0;       
  background: #F6F6F6; text-align: center; padding: 20px; }                                                                                                            
            .card { background: white; border-radius: 16px; padding: 40px; max-width: 360px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
            h1 { color: #10B981; font-size: 24px; margin-bottom: 12px; }                                                                                               
            p { color: #6B7280; font-size: 16px; line-height: 1.5; }                                                                                                   
          </style>                                                                                                                                                     
        </head>                                                                                                                                                        
        <body>                                                                                                                                                         
          <div class="card">                                
            <h1>Verification Submitted!</h1>
            <p>You can close this page and return to the app.</p>                                                                                                      
          </div>
        </body>                                                                                                                                                        
      </html>                                               
    `);
  });

  fastify.get("/connect-refresh", async (_req, reply) => {
    return reply.type("text/html").send(`
      <!DOCTYPE html>                                                                                                                                                  
      <html>
        <head>                                                                                                                                                         
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>Session Expired</title>
          <style>
            body { font-family: -apple-system, system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0;       
  background: #F6F6F6; text-align: center; padding: 20px; }                                                                                                            
            .card { background: white; border-radius: 16px; padding: 40px; max-width: 360px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); }                                
            h1 { color: #F59E0B; font-size: 24px; margin-bottom: 12px; }                                                                                               
            p { color: #6B7280; font-size: 16px; line-height: 1.5; }                                                                                                   
          </style>                                                                                                                                                     
        </head>                                                                                                                                                        
        <body>                                                                                                                                                         
          <div class="card">                                
            <h1>Session Expired</h1>                                                                                                                                   
            <p>Please close this page and try again from the app.</p>
          </div>                                                                                                                                                       
        </body>                                             
      </html>                                                                                                                                                          
    `);
  });
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
  const confirmationCode = generateConfirmation();

  // Update purchase status
  await db.ref(`/purchases/${purchaseId}`).update({
    status: "completed",
    confirmationCode,
    completedAt: now,
    updatedAt: now,
  });

  // Update ticket statuses to "sold"
  const ticketUpdates: Record<string, any> = {};
  let ticketCount = 0;
  for (const item of purchase.lineItems || []) {
    for (const ticketId of item.ticketIds || []) {
      ticketCount++;
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
