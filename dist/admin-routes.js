import { Prisma } from "@prisma/client";
import { prisma } from "./db.js";
import { requireServiceToken } from "./middleware/serviceAuth.js";
export async function adminRoutes(fastify) {
    fastify.addHook("preHandler", requireServiceToken);
    fastify.delete("/users/:uid", async (req, reply) => {
        const { uid } = req.params;
        try {
            await prisma.user.delete({ where: { id: uid } });
            req.log.info({ uid }, "Admin: user deleted");
            return reply.send({ ok: true });
        }
        catch (err) {
            if (err instanceof Prisma.PrismaClientKnownRequestError &&
                err.code === "P2025") {
                return reply.send({ ok: true, alreadyGone: true });
            }
            req.log.error(err, "Admin: failed to delete user");
            return reply.status(500).send({ error: "delete_failed" });
        }
    });
    fastify.delete("/users/:uid/sessions", async (req, reply) => {
        const { uid } = req.params;
        try {
            const result = await prisma.session.deleteMany({
                where: { userId: uid },
            });
            req.log.info({ uid, count: result.count }, "Admin: sessions revoked");
            return reply.send({ ok: true, revoked: result.count });
        }
        catch (err) {
            req.log.error(err, "Admin: failed to revoke sessions");
            return reply.status(500).send({ error: "revoke_failed" });
        }
    });
}
