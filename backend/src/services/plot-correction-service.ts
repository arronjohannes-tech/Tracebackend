import type { Pool } from "pg";
import { z } from "zod";
import { writeAudit, type AuditContext } from "../audit.js";
import { withContext } from "../db.js";
import { badRequest, conflict, notFound } from "../errors.js";
import { uuidSchema } from "../http.js";
import * as plots from "../repositories/plot-repository.js";
import * as repository from "../repositories/plot-correction-repository.js";
import type { AuthContext } from "../types.js";

const base = {
    category: z.enum(repository.correctionCategories),
    message: z.string().trim().min(1).max(2000),
};

export const correctionCreateSchema = z.discriminatedUnion("scope", [
    z.object({ ...base, scope: z.literal("plot"), plotId: uuidSchema }),
    z.object({
        ...base,
        scope: z.literal("group"),
        groupType: z.enum(["supplier", "producer"]),
        groupKey: z.string().trim().min(1).max(200),
    }),
    z.object({ ...base, scope: z.literal("all") }),
]).superRefine((value, context) => {
    if (value.scope === "group" && value.groupType === "supplier" && !uuidSchema.safeParse(value.groupKey).success) {
        context.addIssue({ code: "custom", path: ["groupKey"], message: "A supplier group needs a supplier id." });
    }
});

export const correctionListQuery = z.object({
    status: z.enum(repository.correctionStatuses).optional(),
    plotId: uuidSchema.optional(),
});

export const correctionCloseSchema = z.object({
    status: z.enum(["resolved", "cancelled"]),
    note: z.string().trim().max(2000).default(""),
});

export function createPlotCorrectionService(pool: Pool) {
    return {
        listPlots: (auth: AuthContext, organizationId: string) =>
            withContext(pool, auth, (client) => plots.listPlots(client, organizationId)),

        list: (auth: AuthContext, organizationId: string, filter: z.infer<typeof correctionListQuery>) =>
            withContext(pool, auth, (client) => repository.listRequests(client, organizationId, filter)),

        async get(auth: AuthContext, organizationId: string, id: string) {
            const request = await withContext(pool, auth, (client) =>
                repository.getRequest(client, organizationId, id));
            if (!request) throw notFound("Correction request");
            return request;
        },

        create(
            auth: AuthContext,
            audit: AuditContext,
            organizationId: string,
            input: z.infer<typeof correctionCreateSchema>,
        ) {
            return withContext(pool, auth, async (client) => {
                const target: repository.CorrectionTarget = input.scope === "plot"
                    ? { scope: "plot", plotId: input.plotId }
                    : input.scope === "group"
                        ? { scope: "group", groupType: input.groupType, groupKey: input.groupKey }
                        : { scope: "all" };
                let groupLabel = "";
                if (input.scope === "group") {
                    groupLabel = input.groupType === "supplier"
                        ? (await repository.selectSupplierName(client, organizationId, input.groupKey)) ?? ""
                        : input.groupKey;
                    if (input.groupType === "supplier" && !groupLabel) throw notFound("Supplier");
                }
                const targetPlots = await repository.selectTargetPlots(client, organizationId, target);
                if (!targetPlots.length) {
                    if (input.scope === "plot") throw notFound("Plot");
                    throw badRequest("NO_PLOTS", "There are no plots to request a correction for.");
                }
                const id = await repository.insertRequest(client, organizationId, auth.userId, {
                    scope: input.scope,
                    groupType: input.scope === "group" ? input.groupType : null,
                    groupKey: input.scope === "group" ? input.groupKey : null,
                    groupLabel,
                    category: input.category,
                    message: input.message,
                }, targetPlots);
                await writeAudit(client, audit, auth, "plot_correction.create", "plot_correction", id, {
                    organizationId,
                    scope: input.scope,
                    category: input.category,
                    plotCount: targetPlots.length,
                });
                return (await repository.getRequest(client, organizationId, id))!;
            });
        },

        close(
            auth: AuthContext,
            audit: AuditContext,
            organizationId: string,
            id: string,
            input: z.infer<typeof correctionCloseSchema>,
        ) {
            return withContext(pool, auth, async (client) => {
                const current = await repository.getRequest(client, organizationId, id);
                if (!current) throw notFound("Correction request");
                if (current.status !== "open") {
                    throw conflict("CORRECTION_CLOSED", "This correction request is already closed.");
                }
                const closed = await repository.closeRequest(
                    client, organizationId, id, auth.userId, input.status, input.note,
                );
                if (!closed) {
                    throw conflict("CORRECTION_CLOSED", "This correction request is already closed.");
                }
                await writeAudit(client, audit, auth, `plot_correction.${input.status}`, "plot_correction", id, {
                    organizationId,
                });
                return (await repository.getRequest(client, organizationId, id))!;
            });
        },

        closePlot(
            auth: AuthContext,
            audit: AuditContext,
            organizationId: string,
            id: string,
            plotId: string,
            input: z.infer<typeof correctionCloseSchema>,
        ) {
            return withContext(pool, auth, async (client) => {
                const current = await repository.getRequest(client, organizationId, id);
                if (!current) throw notFound("Correction request");
                const item = current.plots.find((plot) => plot.plotId === plotId);
                if (!item) throw notFound("Plot of the correction request");
                if (item.status !== "open") {
                    throw conflict("CORRECTION_CLOSED", "This plot correction is already closed.");
                }
                const closed = await repository.closeItem(
                    client, organizationId, id, plotId, auth.userId, input.status, input.note,
                );
                if (!closed) {
                    throw conflict("CORRECTION_CLOSED", "This plot correction is already closed.");
                }
                await writeAudit(client, audit, auth, `plot_correction.plot_${input.status}`, "plot_correction", id, {
                    organizationId,
                    plotId,
                });
                return (await repository.getRequest(client, organizationId, id))!;
            });
        },
    };
}
