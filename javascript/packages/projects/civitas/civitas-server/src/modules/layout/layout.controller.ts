import type { FastifyReply, FastifyRequest } from "fastify";
import { LayoutConflictError, LayoutService } from "./layout.service";
import type { LayoutParams, SaveLayoutBody } from "./layout.schema";

// Postgres reports a unique violation with this code; here it means another map
// already uses a name or a hex.
const UNIQUE_VIOLATION = "23505";

function uniqueViolation(error: unknown): string | null {
    const cause = error instanceof Error && "cause" in error ? error.cause : error;
    if (typeof cause === "object" && cause !== null && "code" in cause && cause.code === UNIQUE_VIOLATION) {
        const detail = "detail" in cause && typeof cause.detail === "string" ? cause.detail : "";
        return `another map already uses this name or hex${detail ? ": " + detail : ""}`;
    }
    return null;
}

class LayoutController {
    constructor(private readonly layoutService: LayoutService) {}

    getLayout = async (request: FastifyRequest<{ Params: LayoutParams }>, reply: FastifyReply) => {
        const layout = await this.layoutService.getLayout(request.params.id);
        if (!layout) {
            return reply.code(404).send({ message: "Map not found" });
        }
        return reply.send(layout);
    };

    saveLayout = async (request: FastifyRequest<{ Params: LayoutParams; Body: SaveLayoutBody }>, reply: FastifyReply) => {
        try {
            const layout = await this.layoutService.saveLayout(request.params.id, request.body);
            if (!layout) {
                return reply.code(404).send({ message: "Map not found" });
            }
            return reply.send(layout);
        } catch (error) {
            if (error instanceof LayoutConflictError) {
                return reply.code(409).send({ message: error.message });
            }
            const conflict = uniqueViolation(error);
            if (conflict) {
                return reply.code(409).send({ message: conflict });
            }
            throw error;
        }
    };
}

export { LayoutController };
