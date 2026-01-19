import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "./db.js";
import { env } from "./env.js";
import { sendEmail } from "./mailer.js";
import { emailOTP } from "better-auth/plugins";

export const auth = betterAuth({
  secret: env.authSecret,
  baseURL: env.baseUrl,
  database: prismaAdapter(prisma, { provider: "postgresql" }),

  emailAndPassword: { enabled: true },

  plugins: [
    emailOTP({
    expiresIn: 10 * 60,
      async sendVerificationOTP({ email, otp, type }) {
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
        console.log("[OTP]", { email, otp, type });
      },
    }),
  ],
});
