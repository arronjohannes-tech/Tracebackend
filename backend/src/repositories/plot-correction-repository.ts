import type { PoolClient } from "pg";
import { queryMany, queryOne } from "../db.js";

export const correctionCategories = ["geometry", "area", "geofence", "duplicate", "evidence", "other"] as const;
export const correctionStatuses = ["open", "resolved", "cancelled"] as const;
export type CorrectionCategory = (typeof correctionCategories)[number];
export type CorrectionStatus = (typeof correctionStatuses)[number];

export type CorrectionTarget =
    | { scope: "plot"; plotId: string }
    | { scope: "group"; groupType: "supplier" | "producer"; groupKey: string }
    | { scope: "all" };

export type TargetPlot = { id: string; revision: number };

type RequestRow = {
    id: string;
    scope: "plot" | "group" | "all";
    group_type: "supplier" | "producer" | null;
    group_key: string | null;
    group_label: string;
    category: CorrectionCategory;
    message: string;
    status: CorrectionStatus;
    requested_by: string | null;
    requested_by_name: string | null;
    resolved_by_name: string | null;
    resolution_note: string;
    resolved_at: Date | null;
    created_at: Date;
    updated_at: Date;
};

type ItemRow = {
    request_id: string;
    plot_id: string;
    status: CorrectionStatus;
    resolved_at: Date | null;
    plot_updated: boolean;
};

const requestColumns = `
  r.id, r.scope, r.group_type, r.group_key, r.group_label, r.category, r.message, r.status,
  r.requested_by, ru.display_name AS requested_by_name, rs.display_name AS resolved_by_name,
  r.resolution_note, r.resolved_at, r.created_at, r.updated_at`;
const requestFrom = `
  FROM plot_correction_requests r
  LEFT JOIN users ru ON ru.id = r.requested_by
  LEFT JOIN users rs ON rs.id = r.resolved_by`;

export async function selectTargetPlots(
    client: PoolClient,
    organizationId: string,
    target: CorrectionTarget,
): Promise<TargetPlot[]> {
    const select = "SELECT id, revision FROM plots WHERE organization_id = $1";
    const rows = target.scope === "plot"
        ? await queryMany<TargetPlot>(client, `${select} AND id = $2`, [organizationId, target.plotId])
        : target.scope === "all"
            ? await queryMany<TargetPlot>(client, `${select} ORDER BY id`, [organizationId])
            : target.groupType === "supplier"
                ? await queryMany<TargetPlot>(client, `${select} AND supplier_id = $2 ORDER BY id`,
                    [organizationId, target.groupKey])
                : await queryMany<TargetPlot>(client, `${select} AND producer = $2 ORDER BY id`,
                    [organizationId, target.groupKey]);
    return rows.map((row) => ({ id: row.id, revision: Number(row.revision) }));
}

export async function selectSupplierName(client: PoolClient, organizationId: string, supplierId: string) {
    const row = await queryOne<{ name: string }>(client,
        "SELECT name FROM suppliers WHERE organization_id = $1 AND id = $2", [organizationId, supplierId]);
    return row?.name ?? null;
}

export async function insertRequest(
    client: PoolClient,
    organizationId: string,
    userId: string,
    input: {
        scope: "plot" | "group" | "all";
        groupType: string | null;
        groupKey: string | null;
        groupLabel: string;
        category: CorrectionCategory;
        message: string;
    },
    plots: TargetPlot[],
): Promise<string> {
    const created = await queryOne<{ id: string }>(client,
        `INSERT INTO plot_correction_requests
           (organization_id, scope, group_type, group_key, group_label, category, message, requested_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [organizationId, input.scope, input.groupType, input.groupKey, input.groupLabel,
            input.category, input.message, userId]);
    await client.query(
        `INSERT INTO plot_correction_items (organization_id, request_id, plot_id, plot_revision)
         SELECT $1, $2, plot_id, plot_revision
           FROM unnest($3::uuid[], $4::int[]) AS t(plot_id, plot_revision)`,
        [organizationId, created!.id, plots.map((plot) => plot.id), plots.map((plot) => plot.revision)]);
    return created!.id;
}

function requestJson(row: RequestRow, items: ItemRow[]) {
    const mine = items.filter((item) => item.request_id === row.id);
    return {
        id: row.id,
        scope: row.scope,
        groupType: row.group_type,
        groupKey: row.group_key,
        groupLabel: row.group_label,
        category: row.category,
        message: row.message,
        status: row.status,
        requestedBy: row.requested_by ? { id: row.requested_by, displayName: row.requested_by_name ?? "" } : null,
        resolvedBy: row.resolved_by_name,
        resolutionNote: row.resolution_note,
        resolvedAt: row.resolved_at?.toISOString() ?? null,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
        plotCount: mine.length,
        openPlotCount: mine.filter((item) => item.status === "open").length,
        plots: mine.map((item) => ({
            plotId: item.plot_id,
            status: item.status,
            resolvedAt: item.resolved_at?.toISOString() ?? null,
            plotUpdated: Boolean(item.plot_updated),
        })),
    };
}

async function loadItems(client: PoolClient, organizationId: string, requestIds: string[]) {
    if (!requestIds.length) return [];
    return queryMany<ItemRow>(client, `
    SELECT i.request_id, i.plot_id, i.status, i.resolved_at, (p.revision > i.plot_revision) AS plot_updated
      FROM plot_correction_items i
      JOIN plots p ON p.organization_id = i.organization_id AND p.id = i.plot_id
     WHERE i.organization_id = $1 AND i.request_id = ANY($2::uuid[])
     ORDER BY i.plot_id`, [organizationId, requestIds]);
}

export async function listRequests(
    client: PoolClient,
    organizationId: string,
    filter: { status?: CorrectionStatus | undefined; plotId?: string | undefined },
) {
    const rows = await queryMany<RequestRow>(client, `
    SELECT ${requestColumns} ${requestFrom}
     WHERE r.organization_id = $1
       AND ($2::text IS NULL OR r.status = $2)
       AND ($3::uuid IS NULL OR EXISTS (
             SELECT 1 FROM plot_correction_items i
              WHERE i.organization_id = r.organization_id AND i.request_id = r.id AND i.plot_id = $3))
     ORDER BY r.created_at DESC, r.id LIMIT 200`,
        [organizationId, filter.status ?? null, filter.plotId ?? null]);
    const items = await loadItems(client, organizationId, rows.map((row) => row.id));
    return rows.map((row) => requestJson(row, items));
}

export async function getRequest(client: PoolClient, organizationId: string, id: string) {
    const row = await queryOne<RequestRow>(client,
        `SELECT ${requestColumns} ${requestFrom} WHERE r.organization_id = $1 AND r.id = $2`,
        [organizationId, id]);
    if (!row) return null;
    return requestJson(row, await loadItems(client, organizationId, [id]));
}

// Closes every still-open plot of the request together with the request itself.
export async function closeRequest(
    client: PoolClient,
    organizationId: string,
    id: string,
    userId: string,
    status: "resolved" | "cancelled",
    note: string,
): Promise<boolean> {
    const updated = await queryOne<{ id: string }>(client,
        `UPDATE plot_correction_requests
            SET status = $3, resolved_by = $4, resolution_note = $5, resolved_at = now()
          WHERE organization_id = $1 AND id = $2 AND status = 'open' RETURNING id`,
        [organizationId, id, status, userId, note]);
    if (!updated) return false;
    await client.query(
        `UPDATE plot_correction_items SET status = $3, resolved_at = now()
          WHERE organization_id = $1 AND request_id = $2 AND status = 'open'`,
        [organizationId, id, status]);
    return true;
}

export async function closeItem(
    client: PoolClient,
    organizationId: string,
    id: string,
    plotId: string,
    userId: string,
    status: "resolved" | "cancelled",
    note: string,
): Promise<boolean> {
    const updated = await queryOne<{ plot_id: string }>(client,
        `UPDATE plot_correction_items SET status = $4, resolved_at = now()
          WHERE organization_id = $1 AND request_id = $2 AND plot_id = $3 AND status = 'open'
          RETURNING plot_id`,
        [organizationId, id, plotId, status]);
    if (!updated) return false;
    // The request is finished as soon as no plot is waiting for a correction any more.
    const remaining = await queryOne<{ open: number }>(client,
        `SELECT count(*)::int AS open FROM plot_correction_items
          WHERE organization_id = $1 AND request_id = $2 AND status = 'open'`,
        [organizationId, id]);
    if (Number(remaining?.open ?? 0) === 0) {
        const anyResolved = await queryOne<{ n: number }>(client,
            `SELECT count(*)::int AS n FROM plot_correction_items
              WHERE organization_id = $1 AND request_id = $2 AND status = 'resolved'`,
            [organizationId, id]);
        await client.query(
            `UPDATE plot_correction_requests
                SET status = $3, resolved_by = $4, resolution_note = $5, resolved_at = now()
              WHERE organization_id = $1 AND id = $2 AND status = 'open'`,
            [organizationId, id, Number(anyResolved?.n ?? 0) > 0 ? "resolved" : "cancelled", userId, note]);
    }
    return true;
}
