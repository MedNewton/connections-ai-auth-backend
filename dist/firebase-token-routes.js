// src/firebase-token-routes.ts
import admin from "firebase-admin";
import { auth } from "./auth.js";
import "./firebase.js";
import { userKeyFromUser } from "./lib/userKey.js";
export async function firebaseTokenRoutes(fastify) {
    fastify.post("/token", async (req, reply) => {
        // Replay request headers into a Web `Headers` object so BetterAuth's
        // `auth.api.getSession` can pick up the session cookie / authorization.
        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers)) {
            if (Array.isArray(v))
                headers.set(k, v.join(","));
            else if (typeof v === "string")
                headers.set(k, v);
        }
        const session = await auth.api.getSession({ headers });
        if (!session?.user) {
            return reply.status(401).send({ error: "unauthorized" });
        }
        let uid;
        try {
            uid = userKeyFromUser({
                id: session.user.id,
                email: session.user.email,
            });
        }
        catch (err) {
            req.log.warn({ err, userId: session.user.id }, "Cannot derive userKey");
            return reply.status(400).send({ error: "no_user_key" });
        }
        try {
            const token = await admin.auth().createCustomToken(uid);
            return reply.send({ token, uid });
        }
        catch (err) {
            req.log.error({ err, uid }, "Failed to mint Firebase custom token");
            return reply.status(500).send({ error: "mint_failed" });
        }
    });
}
