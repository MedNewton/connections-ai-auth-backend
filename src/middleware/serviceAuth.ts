import crypto from "crypto";
import { FastifyReply, FastifyRequest } from "fastify";
import { env } from "../env.js";

export async function requireServiceToken(
  req: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    reply.status(401).send({ error: "missing_bearer" });
    return;
  }

  const provided = header.slice("Bearer ".length).trim();
  const expected = env.serviceToken;

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    reply.status(401).send({ error: "invalid_token" });
    return;
  }
}
