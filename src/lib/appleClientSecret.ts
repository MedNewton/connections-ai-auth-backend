import { readFileSync } from "node:fs";
import { SignJWT, importPKCS8 } from "jose";

/**
 * Generate the Apple "client secret" — a short-lived ES256 JWT signed with the
 * Sign in with Apple private key (.p8). Apple does not use a static secret;
 * this JWT IS the secret. Max lifetime is 6 months, so we mint a fresh one at
 * startup with the full 180-day window.
 *
 * Docs: https://better-auth.com/docs/authentication/apple
 */
export async function generateAppleClientSecret(opts: {
  clientId: string; // Service ID, or the App/bundle ID for native-only flows
  teamId: string;
  keyId: string;
  privateKey: string; // PKCS#8 PEM contents of the .p8 file
}): Promise<string> {
  const key = await importPKCS8(opts.privateKey, "ES256");
  const now = Math.floor(Date.now() / 1000);

  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: opts.keyId })
    .setIssuer(opts.teamId)
    .setSubject(opts.clientId)
    .setAudience("https://appleid.apple.com")
    .setIssuedAt(now)
    .setExpirationTime(now + 180 * 24 * 60 * 60)
    .sign(key);
}

/**
 * Read the Apple private key from either an inline env value (APPLE_PRIVATE_KEY,
 * with literal "\n" escapes) or a file path (APPLE_PRIVATE_KEY_PATH).
 */
export function readApplePrivateKey(opts: {
  inline?: string;
  path?: string;
}): string {
  if (opts.inline && opts.inline.trim().length > 0) {
    return opts.inline.replace(/\\n/g, "\n");
  }
  if (opts.path && opts.path.trim().length > 0) {
    return readFileSync(opts.path, "utf8");
  }
  throw new Error(
    "Missing Apple private key: set APPLE_PRIVATE_KEY or APPLE_PRIVATE_KEY_PATH"
  );
}
