import "dotenv/config";

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim().length === 0) throw new Error(`Missing env: ${name}`);
  return v;
}

function optional(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim().length > 0 ? v : fallback;
}

export const env = {
  port: Number(optional("PORT", "4000")),
  baseUrl: required("BASE_URL"),
  databaseUrl: required("DATABASE_URL"),
  corsOrigins: optional("CORS_ORIGINS", "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  authSecret: required("AUTH_SECRET"),
  emailFrom: optional("EMAIL_FROM", "no-reply@example.com"),
  resendApiKey: required("RESEND_API_KEY"),
  googleClientId: required("GOOGLE_CLIENT_ID"),
  googleClientSecret: required("GOOGLE_CLIENT_SECRET"),
  // Sign in with Apple (native Expo flow). clientId == iOS bundle id since the
  // native id-token flow verifies against the app bundle, not a Services ID.
  appleClientId: required("APPLE_CLIENT_ID"),
  appleTeamId: required("APPLE_TEAM_ID"),
  appleKeyId: required("APPLE_KEY_ID"),
  applePrivateKey: optional("APPLE_PRIVATE_KEY", ""),
  applePrivateKeyPath: optional("APPLE_PRIVATE_KEY_PATH", ""),
  appleBundleId: required("APPLE_APP_BUNDLE_IDENTIFIER"),
  stripeSecretKey: required("STRIPE_SECRET_KEY"),
  stripeWebhookSecret: required("STRIPE_WEBHOOK_SECRET"),
  stripeClientId : required("STRIPE_CLIENT_ID"),
  firebaseDatabaseUrl: required("FIREBASE_DATABASE_URL"),
  firebaseProjectId: required("FIREBASE_PROJECT_ID"),
  firebaseClientEmail: required("FIREBASE_CLIENT_EMAIL"),
  firebasePrivateKey: required("FIREBASE_PRIVATE_KEY"),
  serviceToken: required("SERVICE_TOKEN"),

  // App Store review test account. When APPLE_REVIEW_EMAIL is empty the
  // bypass is fully inert. Set it only on the review deployment, and unset
  // it once Apple approval is granted.
  appleReviewEmail: optional("APPLE_REVIEW_EMAIL", "").toLowerCase(),
  appleReviewOtp: optional("APPLE_REVIEW_OTP", "000000"),
};
