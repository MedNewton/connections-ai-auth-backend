import admin from "firebase-admin";
import { env } from "./env.js";
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: env.firebaseProjectId,
            clientEmail: env.firebaseClientEmail,
            privateKey: env.firebasePrivateKey.replace(/\\n/g, "\n"),
        }),
        databaseURL: env.firebaseDatabaseUrl,
    });
}
export const db = admin.database();
