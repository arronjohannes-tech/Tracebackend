import type { PoolClient } from "pg";
import { queryMany, queryOne } from "../db.js";

export type DashboardRow = {
    supplierCount: number;
    plotCount: number;
    openReviewCount: number;
    documentCount: number;
    operationCount: number;
    suppliers: Array<{
        id: string;
        name: string;
        region: string;
        producerCount: number;
        plotCount: number;
        revision: number;
        updatedAt: string;
    }>;
    plots: Array<{
        id: string;
        producer: string;
        farmName: string;
        areaHa: string;
        geofenceStatus: string;
        updatedAt: string;
    }>;
    operations: Array<{
        id: string;
        kind: string;
        status: string;
        phase: string | null;
        updatedAt: string;
    }>;
};

export async function getDashboard(client: PoolClient, organizationId: string): Promise<DashboardRow> {
    const counts = await queryOne<{
        supplier_count: number;
        plot_count: number;
        open_review_count: number;
        document_count: number;
        operation_count: number;
    }>(client, `
    SELECT
      (SELECT count(*)::int FROM suppliers WHERE organization_id = $1) AS supplier_count,
      (SELECT count(*)::int FROM plots WHERE organization_id = $1) AS plot_count,
      (SELECT count(*)::int FROM geofence_violations WHERE organization_id = $1 AND status = 'pending') +
        (SELECT count(*)::int FROM review_requests WHERE organization_id = $1 AND status = 'pending') AS open_review_count,
      (SELECT count(*)::int FROM documents WHERE organization_id = $1 AND status = 'completed') AS document_count,
      (SELECT count(*)::int FROM operational_requests WHERE organization_id = $1) AS operation_count
  `, [organizationId]);
    const suppliers = await queryMany<{
        id: string; name: string; region: string; producer_count: number; plot_count: number; revision: number; source_updated_at: Date;
    }>(client, `
    SELECT id, name, region, producer_count, plot_count, revision, source_updated_at
      FROM suppliers WHERE organization_id = $1 ORDER BY source_updated_at DESC LIMIT 100
  `, [organizationId]);
    const plots = await queryMany<{
        id: string; producer: string; farm_name: string; area_ha: string; geofence_status: string; source_updated_at: Date;
    }>(client, `
    SELECT id, producer, farm_name, area_ha, geofence_status, source_updated_at
      FROM plots WHERE organization_id = $1 ORDER BY source_updated_at DESC LIMIT 100
  `, [organizationId]);
    const operations = await queryMany<{
        id: string; kind: string; status: string; phase: string | null; updated_at: Date;
    }>(client, `
    SELECT id, kind, status, phase, updated_at
      FROM operational_requests WHERE organization_id = $1 ORDER BY updated_at DESC LIMIT 100
  `, [organizationId]);
    return {
        supplierCount: Number(counts?.supplier_count ?? 0),
        plotCount: Number(counts?.plot_count ?? 0),
        openReviewCount: Number(counts?.open_review_count ?? 0),
        documentCount: Number(counts?.document_count ?? 0),
        operationCount: Number(counts?.operation_count ?? 0),
        suppliers: suppliers.map((row) => ({
            id: row.id, name: row.name, region: row.region,
            producerCount: Number(row.producer_count), plotCount: Number(row.plot_count),
            revision: Number(row.revision),
            updatedAt: row.source_updated_at.toISOString(),
        })),
        plots: plots.map((row) => ({
            id: row.id, producer: row.producer, farmName: row.farm_name,
            areaHa: String(row.area_ha), geofenceStatus: row.geofence_status,
            updatedAt: row.source_updated_at.toISOString(),
        })),
        operations: operations.map((row) => ({
            id: row.id, kind: row.kind, status: row.status, phase: row.phase,
            updatedAt: row.updated_at.toISOString(),
        })),
    };
}
