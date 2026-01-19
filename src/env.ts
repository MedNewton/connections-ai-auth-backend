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
};
