import Fastify from "fastify";
import cors from "@fastify/cors";
import { env } from "./env.js";
import { auth } from "./auth.js";


const app = Fastify({ logger: true });

await app.register(cors, {
  origin: (origin, cb) => {
    // allow non-browser (mobile native, curl, server-to-server)
    if (!origin) return cb(null, true);

    if (env.corsOrigins.length === 0) return cb(null, true);
    if (env.corsOrigins.includes(origin)) return cb(null, true);

    return cb(new Error(`CORS blocked origin: ${origin}`), false);
  },
  credentials: true,
});

app.get("/health", async () => ({ ok: true }));

app.all("/api/auth/*", async (req, reply) => {
    const url = new URL(req.url, env.baseUrl);
  
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (Array.isArray(v)) headers.set(k, v.join(","));
      else if (typeof v === "string") headers.set(k, v);
    }
  
    const body =
      req.method === "GET" || req.method === "HEAD"
        ? undefined
        : req.body
          ? JSON.stringify(req.body)
          : undefined;
  
    const res = await auth.handler(
      new Request(url.toString(), {
        method: req.method,
        headers,
        body,
      })
    );
  
    reply.status(res.status);
    res.headers.forEach((value, key) => reply.header(key, value));
    const buf = Buffer.from(await res.arrayBuffer());
    return reply.send(buf);
  });
  

await app.listen({ port: env.port, host: "0.0.0.0" });
