import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "./db.js";
import { env } from "./env.js";
import { sendEmail } from "./mailer.js";
import { emailOTP } from "better-auth/plugins";
import { expo } from "@better-auth/expo";
import {
  generateAppleClientSecret,
  readApplePrivateKey,
} from "./lib/appleClientSecret.js";

// Apple's "client secret" is a signed ES256 JWT (valid up to 6 months). Mint a
// fresh one at startup from the .p8 key so we never hand-rotate it.
const appleClientSecret = await generateAppleClientSecret({
  clientId: env.appleClientId,
  teamId: env.appleTeamId,
  keyId: env.appleKeyId,
  privateKey: readApplePrivateKey({
    inline: env.applePrivateKey,
    path: env.applePrivateKeyPath,
  }),
});

export const auth = betterAuth({
  secret: env.authSecret,
  baseURL: env.baseUrl,
  database: prismaAdapter(prisma, { provider: "postgresql" }),

  advanced: {
    useSecureCookies: true,
  },
  trustedOrigins: [
    "connectionsai://",
    "connectionsai://*",
    "exp://",
    "exp://*",
    "exps://",
    "exps://*",
    "https://auth.expo.io",
    "https://appleid.apple.com",
  ],
  socialProviders: {
    google: {
      clientId: env.googleClientId,
      clientSecret: env.googleClientSecret,
      prompt: "select_account",
    },
    apple: {
      clientId: env.appleClientId,
      clientSecret: appleClientSecret,
      // Native Expo flow verifies the id token against the iOS bundle id.
      appBundleIdentifier: env.appleBundleId,
    },
  },

  emailAndPassword: { enabled: true },

  plugins: [
    expo(),
    emailOTP({
      expiresIn: 10 * 60,
      // App Store review test account: return a fixed OTP for the review
      // email so Apple can sign in without receiving a real code. Returning
      // undefined for everyone else lets better-auth generate its normal
      // random OTP (see email-otp plugin: `generateOTP(...) || default`).
      generateOTP({ email }) {
        if (
          env.appleReviewEmail &&
          email.toLowerCase() === env.appleReviewEmail
        ) {
          return env.appleReviewOtp;
        }
        return undefined;
      },
      async sendVerificationOTP({ email, otp, type }) {
        // Don't send a real email for the App Store review account.
        if (
          env.appleReviewEmail &&
          email.toLowerCase() === env.appleReviewEmail
        ) {
          console.log("[OTP] App Store review account, skipping email", {
            email,
            type,
          });
          return;
        }

        const subject =
          type === "sign-in"
            ? "Your sign-in code"
            : type === "email-verification"
              ? "Verify your email"
              : "Your verification code";

        await sendEmail({
          to: email,
          subject,
          html: `<p>Your code is: <strong>${otp}</strong></p>`,
        });

        // remove later in production if you want
        console.log("[OTP]", { email, otp, type });
      },
    }),
  ],
});
