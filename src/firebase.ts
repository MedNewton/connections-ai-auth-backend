import admin from "firebase-admin";
import { env } from "./env.js";

const serviceAccount = JSON.parse(
  Buffer.from(env.firebaseServiceAccount, "base64").toString("utf-8")
);

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: env.firebaseDatabaseUrl,
  });
}

export const db = admin.database();
