import type { Pool } from "pg";
import { z } from "zod";
import { writeAudit, type AuditContext } from "../audit.js";
import { withContext } from "../db.js";
import { notFound } from "../errors.js";
import * as repository from "../repositories/shipment-repository.js";
import type { AuthContext } from "../types.js";
import { uuidSchema } from "../http.js";

const text = (max: number) => z.string().trim().max(max);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}, "Invalid calendar date.");

export const shipmentCreateSchema = z.object({
    reference: z.string().trim().min(1).max(80),
    product: text(200).default(""),
    hsCode: text(20).default("0901"),
    quantityKg: z.number().positive().max(999_999_999),
    originCountry: text(100).default(""),
    originRegion: text(200).default(""),
    supplierId: uuidSchema.nullable().default(null),
    destination: text(200).default(""),
    status: z.enum(repository.shipmentStatuses).default("planned"),
    expectedArrival: isoDate.nullable().default(null),
    notes: text(4000).default(""),
});

export const shipmentPatchSchema = shipmentCreateSchema.partial().refine(
    (value) => Object.keys(value).length > 0,
    "At least one field is required.",
);

export function createShipmentService(pool: Pool) {
    return {
        list: (auth: AuthContext, organizationId: string) =>
            withContext(pool, auth, (client) => repository.listShipments(client, organizationId)),

        async get(auth: AuthContext, organizationId: string, id: string) {
            const shipment = await withContext(pool, auth, (client) =>
                repository.getShipment(client, organizationId, id));
            if (!shipment) throw notFound("Shipment");
            return shipment;
        },

        create(
            auth: AuthContext,
            request: AuditContext,
            organizationId: string,
            input: z.infer<typeof shipmentCreateSchema>,
        ) {
            return withContext(pool, auth, async (client) => {
                const shipment = await repository.insertShipment(client, organizationId, auth.userId, input);
                await writeAudit(client, request, auth, "shipment.create", "shipment", shipment!.id, {
                    organizationId,
                    reference: input.reference,
                });
                return shipment!;
            });
        },

        update(
            auth: AuthContext,
            request: AuditContext,
            organizationId: string,
            id: string,
            patch: z.infer<typeof shipmentPatchSchema>,
        ) {
            return withContext(pool, auth, async (client) => {
                const current = await repository.getShipment(client, organizationId, id);
                if (!current) throw notFound("Shipment");
                const merged = shipmentCreateSchema.parse({
                    reference: current.reference,
                    product: current.product,
                    hsCode: current.hsCode,
                    quantityKg: current.quantityKg,
                    originCountry: current.originCountry,
                    originRegion: current.originRegion,
                    supplierId: current.supplierId,
                    destination: current.destination,
                    status: current.status,
                    expectedArrival: current.expectedArrival,
                    notes: current.notes,
                    ...patch,
                });
                const shipment = await repository.updateShipment(client, organizationId, id, merged);
                if (!shipment) throw notFound("Shipment");
                await writeAudit(client, request, auth, "shipment.update", "shipment", id, {
                    organizationId,
                    fields: Object.keys(patch),
                });
                return shipment;
            });
        },

        remove(auth: AuthContext, request: AuditContext, organizationId: string, id: string) {
            return withContext(pool, auth, async (client) => {
                const deleted = await repository.deleteShipment(client, organizationId, id);
                if (!deleted) throw notFound("Shipment");
                await writeAudit(client, request, auth, "shipment.delete", "shipment", id, { organizationId });
                return { deleted: true as const, id };
            });
        },
    };
}
