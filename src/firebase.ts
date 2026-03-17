import admin from "firebase-admin";
import { env } from "./env.js";

const serviceAccount = JSON.parse(env.firebaseServiceAccount);

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: env.firebaseDatabaseUrl,
  });
}

export const db = admin.database();
