import type { PoolClient } from "pg";
import { queryMany, queryOne } from "../db.js";

export type DashboardRow = {
    supplierCount: number;
    plotCount: number;
    openReviewCount: number;
    documentCount: number;
    operationCount: number;
    shipmentCount: number;
    suppliers: Array<{
        id: string;
        name: string;
        region: string;
        producerCount: number;
        plotCount: number;
        revision: number;
        tradingName: string;
        registrationNumber: string;
        taxId: string;
        countryCode: string;
        streetAddress: string;
        city: string;
        postalCode: string;
        contactName: string;
        contactEmail: string | null;
        contactPhone: string;
        website: string;
        createdAt: string;
        updatedAt: string;
    }>;
    plots: Array<{
        id: string;
        supplierId: string | null;
        supplierName: string | null;
        producer: string;
        farmName: string;
        areaHa: string;
        geofenceStatus: string;
        localGeofenceResult: string;
        revision: number;
        centroid: { lat: number; lng: number } | null;
        capturedAt: string;
        updatedAt: string;
    }>;
    operations: Array<{
        id: string;
        kind: string;
        subjectId: string;
        status: string;
        phase: string | null;
        message: string | null;
        externalReference: string | null;
        createdAt: string;
        updatedAt: string;
    }>;
    documents: Array<{
        id: string;
        fileName: string;
        mimeType: string;
        byteSize: number;
        status: string;
        sha256: string | null;
        createdAt: string;
        updatedAt: string;
    }>;
    reviews: Array<{
        id: string;
        type: "geofence" | "dds";
        subjectId: string;
        status: string;
        reason: string;
        reviewNote: string | null;
        createdAt: string;
        reviewedAt: string | null;
    }>;
};

export async function getDashboard(client: PoolClient, organizationId: string): Promise<DashboardRow> {
    const counts = await queryOne<{
        supplier_count: number;
        plot_count: number;
        open_review_count: number;
        document_count: number;
        operation_count: number;
        shipment_count: number;
    }>(client, `
    SELECT
      (SELECT count(*)::int FROM suppliers WHERE organization_id = $1) AS supplier_count,
      (SELECT count(*)::int FROM plots WHERE organization_id = $1) AS plot_count,
      (SELECT count(*)::int FROM geofence_violations WHERE organization_id = $1 AND status = 'pending') +
        (SELECT count(*)::int FROM review_requests WHERE organization_id = $1 AND status = 'pending') AS open_review_count,
      (SELECT count(*)::int FROM documents WHERE organization_id = $1 AND status = 'completed') AS document_count,
      (SELECT count(*)::int FROM operational_requests WHERE organization_id = $1) AS operation_count,
      (SELECT count(*)::int FROM shipments WHERE organization_id = $1) AS shipment_count
  `, [organizationId]);
    const suppliers = await queryMany<{
        id: string; name: string; region: string; producer_count: number; plot_count: number; revision: number;
        trading_name: string; registration_number: string; tax_id: string; country_code: string;
        street_address: string; city: string; postal_code: string; contact_name: string;
        contact_email: string | null; contact_phone: string; website: string;
        created_at: Date; source_updated_at: Date;
    }>(client, `
    SELECT id, name, region, producer_count, plot_count, revision, trading_name, registration_number,
           tax_id, country_code, street_address, city, postal_code, contact_name, contact_email,
           contact_phone, website, created_at, source_updated_at
      FROM suppliers WHERE organization_id = $1 ORDER BY source_updated_at DESC LIMIT 100
  `, [organizationId]);
    const plots = await queryMany<{
        id: string; supplier_id: string | null; supplier_name: string | null; producer: string;
        farm_name: string; area_ha: string; geofence_status: string; local_geofence_result: string;
        revision: number; lat: number | null; lng: number | null; captured_at: Date; source_updated_at: Date;
    }>(client, `
    SELECT p.id, p.supplier_id, s.name AS supplier_name, p.producer, p.farm_name, p.area_ha,
           p.geofence_status, p.local_geofence_result, p.revision,
           ST_Y(ST_Centroid(p.polygon)) AS lat, ST_X(ST_Centroid(p.polygon)) AS lng,
           p.captured_at, p.source_updated_at
      FROM plots p
      LEFT JOIN suppliers s ON s.organization_id = p.organization_id AND s.id = p.supplier_id
     WHERE p.organization_id = $1 ORDER BY p.source_updated_at DESC LIMIT 100
  `, [organizationId]);
    const operations = await queryMany<{
        id: string; kind: string; subject_id: string; status: string; phase: string | null;
        message: string | null; external_reference: string | null; created_at: Date; updated_at: Date;
    }>(client, `
    SELECT id, kind, subject_id, status, phase, message, external_reference, created_at, updated_at
      FROM operational_requests WHERE organization_id = $1 ORDER BY updated_at DESC LIMIT 100
  `, [organizationId]);
    const documents = await queryMany<{
        id: string; file_name: string; mime_type: string; byte_size: number; status: string;
        sha256: string | null; created_at: Date; updated_at: Date;
    }>(client, `
    SELECT id, file_name, mime_type, byte_size, status, sha256, created_at, updated_at
      FROM documents WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 100
  `, [organizationId]);
    const geofenceReviews = await queryMany<{
        id: string; subject_id: string; status: string; reason: string; review_note: string | null;
        created_at: Date; reviewed_at: Date | null;
    }>(client, `
    SELECT id, entity_id AS subject_id, status, reason, review_note, created_at, reviewed_at
      FROM geofence_violations WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 100
  `, [organizationId]);
    const ddsReviews = await queryMany<{
        id: string; subject_id: string; status: string; review_note: string | null;
        created_at: Date; reviewed_at: Date | null;
    }>(client, `
    SELECT id, subject_id, status, review_note, created_at, reviewed_at
      FROM review_requests WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 100
  `, [organizationId]);
    const reviews: DashboardRow["reviews"] = [
        ...geofenceReviews.map((row) => ({
            id: row.id, type: "geofence" as const, subjectId: row.subject_id, status: row.status,
            reason: row.reason, reviewNote: row.review_note,
            createdAt: row.created_at.toISOString(), reviewedAt: row.reviewed_at?.toISOString() ?? null,
        })),
        ...ddsReviews.map((row) => ({
            id: row.id, type: "dds" as const, subjectId: row.subject_id, status: row.status,
            reason: "DDS submission approval", reviewNote: row.review_note,
            createdAt: row.created_at.toISOString(), reviewedAt: row.reviewed_at?.toISOString() ?? null,
        })),
    ].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100);
    return {
        supplierCount: Number(counts?.supplier_count ?? 0),
        plotCount: Number(counts?.plot_count ?? 0),
        openReviewCount: Number(counts?.open_review_count ?? 0),
        documentCount: Number(counts?.document_count ?? 0),
        operationCount: Number(counts?.operation_count ?? 0),
        shipmentCount: Number(counts?.shipment_count ?? 0),
        suppliers: suppliers.map((row) => ({
            id: row.id, name: row.name, region: row.region,
            producerCount: Number(row.producer_count), plotCount: Number(row.plot_count),
            revision: Number(row.revision),
            tradingName: row.trading_name, registrationNumber: row.registration_number, taxId: row.tax_id,
            countryCode: row.country_code, streetAddress: row.street_address, city: row.city,
            postalCode: row.postal_code, contactName: row.contact_name, contactEmail: row.contact_email,
            contactPhone: row.contact_phone, website: row.website,
            createdAt: row.created_at.toISOString(),
            updatedAt: row.source_updated_at.toISOString(),
        })),
        plots: plots.map((row) => ({
            id: row.id, supplierId: row.supplier_id, supplierName: row.supplier_name,
            producer: row.producer, farmName: row.farm_name,
            areaHa: String(row.area_ha), geofenceStatus: row.geofence_status,
            localGeofenceResult: row.local_geofence_result, revision: Number(row.revision),
            centroid: row.lat === null || row.lng === null ? null : { lat: Number(row.lat), lng: Number(row.lng) },
            capturedAt: row.captured_at.toISOString(),
            updatedAt: row.source_updated_at.toISOString(),
        })),
        operations: operations.map((row) => ({
            id: row.id, kind: row.kind, subjectId: row.subject_id, status: row.status, phase: row.phase,
            message: row.message, externalReference: row.external_reference,
            createdAt: row.created_at.toISOString(),
            updatedAt: row.updated_at.toISOString(),
        })),
        documents: documents.map((row) => ({
            id: row.id, fileName: row.file_name, mimeType: row.mime_type, byteSize: Number(row.byte_size),
            status: row.status, sha256: row.sha256,
            createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
        })),
        reviews,
    };
}

export type OrganizationDetails = {
    id: string;
    name: string;
    slug: string;
    active: boolean;
    createdAt: string;
    updatedAt: string;
    counts: {
        users: number;
        suppliers: number;
        plots: number;
        shipments: number;
        documents: number;
        operations: number;
    };
    config: {
        satelliteEnabled: boolean;
        evidencePackEnabled: boolean;
        euMode: string;
    } | null;
    members: Array<{ id: string; displayName: string; email: string; role: string; active: boolean }>;
};

export async function getOrganization(
    client: PoolClient,
    organizationId: string,
    options: { includeConfig: boolean; includeMembers: boolean },
): Promise<OrganizationDetails | null> {
    const organization = await queryOne<{
        id: string; name: string; slug: string; active: boolean; created_at: Date; updated_at: Date;
        user_count: number; supplier_count: number; plot_count: number; shipment_count: number;
        document_count: number; operation_count: number;
    }>(client, `
    SELECT o.id, o.name, o.slug, o.active, o.created_at, o.updated_at,
      (SELECT count(*)::int FROM users WHERE organization_id = o.id) AS user_count,
      (SELECT count(*)::int FROM suppliers WHERE organization_id = o.id) AS supplier_count,
      (SELECT count(*)::int FROM plots WHERE organization_id = o.id) AS plot_count,
      (SELECT count(*)::int FROM shipments WHERE organization_id = o.id) AS shipment_count,
      (SELECT count(*)::int FROM documents WHERE organization_id = o.id) AS document_count,
      (SELECT count(*)::int FROM operational_requests WHERE organization_id = o.id) AS operation_count
      FROM organizations o WHERE o.id = $1
  `, [organizationId]);
    if (!organization) return null;
    const config = options.includeConfig
        ? await queryOne<{ satellite_enabled: boolean; evidence_pack_enabled: boolean; eu_mode: string }>(client,
            "SELECT satellite_enabled, evidence_pack_enabled, eu_mode FROM organization_api_config WHERE organization_id = $1",
            [organizationId])
        : null;
    const members = options.includeMembers
        ? await queryMany<{ id: string; display_name: string; email: string; role: string; active: boolean }>(client,
            "SELECT id, display_name, email, role, active FROM users WHERE organization_id = $1 ORDER BY email",
            [organizationId])
        : [];
    return {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        active: organization.active,
        createdAt: organization.created_at.toISOString(),
        updatedAt: organization.updated_at.toISOString(),
        counts: {
            users: Number(organization.user_count),
            suppliers: Number(organization.supplier_count),
            plots: Number(organization.plot_count),
            shipments: Number(organization.shipment_count),
            documents: Number(organization.document_count),
            operations: Number(organization.operation_count),
        },
        config: config
            ? {
                satelliteEnabled: config.satellite_enabled,
                evidencePackEnabled: config.evidence_pack_enabled,
                euMode: config.eu_mode,
            }
            : null,
        members: members.map((row) => ({
            id: row.id, displayName: row.display_name, email: row.email, role: row.role, active: row.active,
        })),
    };
}
