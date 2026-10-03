import type { PoolClient } from "pg";
import { queryMany, queryOne } from "../db.js";

export const shipmentStatuses = ["planned", "in_transit", "arrived", "cancelled"] as const;
export type ShipmentStatus = (typeof shipmentStatuses)[number];

export type ShipmentInput = {
    reference: string;
    product: string;
    hsCode: string;
    quantityKg: number;
    originCountry: string;
    originRegion: string;
    supplierId: string | null;
    destination: string;
    status: ShipmentStatus;
    expectedArrival: string | null;
    notes: string;
};

type ShipmentRow = {
    id: string;
    reference: string;
    product: string;
    hs_code: string;
    quantity_kg: string;
    origin_country: string;
    origin_region: string;
    supplier_id: string | null;
    supplier_name: string | null;
    destination: string;
    status: ShipmentStatus;
    expected_arrival: string | null;
    notes: string;
    created_at: Date;
    updated_at: Date;
};

const selectColumns = `
  s.id, s.reference, s.product, s.hs_code, s.quantity_kg, s.origin_country, s.origin_region,
  s.supplier_id, sup.name AS supplier_name, s.destination, s.status,
  to_char(s.expected_arrival, 'YYYY-MM-DD') AS expected_arrival,
  s.notes, s.created_at, s.updated_at`;
const fromClause = `
  FROM shipments s
  LEFT JOIN suppliers sup ON sup.organization_id = s.organization_id AND sup.id = s.supplier_id`;

export function shipmentJson(row: ShipmentRow) {
    return {
        id: row.id,
        reference: row.reference,
        product: row.product,
        hsCode: row.hs_code,
        quantityKg: Number(row.quantity_kg),
        originCountry: row.origin_country,
        originRegion: row.origin_region,
        supplierId: row.supplier_id,
        supplierName: row.supplier_name,
        destination: row.destination,
        status: row.status,
        expectedArrival: row.expected_arrival,
        notes: row.notes,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
    };
}

export async function listShipments(client: PoolClient, organizationId: string) {
    const rows = await queryMany<ShipmentRow>(client,
        `SELECT ${selectColumns} ${fromClause}
          WHERE s.organization_id = $1 ORDER BY s.created_at DESC LIMIT 500`,
        [organizationId]);
    return rows.map(shipmentJson);
}

export async function getShipment(client: PoolClient, organizationId: string, id: string) {
    const row = await queryOne<ShipmentRow>(client,
        `SELECT ${selectColumns} ${fromClause} WHERE s.organization_id = $1 AND s.id = $2`,
        [organizationId, id]);
    return row ? shipmentJson(row) : null;
}

export async function insertShipment(
    client: PoolClient,
    organizationId: string,
    userId: string,
    input: ShipmentInput,
) {
    const created = await queryOne<{ id: string }>(client,
        `INSERT INTO shipments
           (organization_id, reference, product, hs_code, quantity_kg, origin_country, origin_region,
            supplier_id, destination, status, expected_arrival, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING id`,
        [
            organizationId, input.reference, input.product, input.hsCode, input.quantityKg,
            input.originCountry, input.originRegion, input.supplierId, input.destination,
            input.status, input.expectedArrival, input.notes, userId,
        ]);
    return getShipment(client, organizationId, created!.id);
}

export async function updateShipment(
    client: PoolClient,
    organizationId: string,
    id: string,
    input: ShipmentInput,
) {
    const updated = await queryOne<{ id: string }>(client,
        `UPDATE shipments
            SET reference = $3, product = $4, hs_code = $5, quantity_kg = $6, origin_country = $7,
                origin_region = $8, supplier_id = $9, destination = $10, status = $11,
                expected_arrival = $12, notes = $13
          WHERE organization_id = $1 AND id = $2
          RETURNING id`,
        [
            organizationId, id, input.reference, input.product, input.hsCode, input.quantityKg,
            input.originCountry, input.originRegion, input.supplierId, input.destination,
            input.status, input.expectedArrival, input.notes,
        ]);
    return updated ? getShipment(client, organizationId, updated.id) : null;
}

export async function deleteShipment(client: PoolClient, organizationId: string, id: string) {
    const deleted = await queryOne<{ id: string }>(client,
        "DELETE FROM shipments WHERE organization_id = $1 AND id = $2 RETURNING id",
        [organizationId, id]);
    return Boolean(deleted);
}
