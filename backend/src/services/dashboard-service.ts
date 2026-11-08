import type { Pool } from "pg";
import type { AuthContext } from "../types.js";
import { withContext } from "../db.js";
import { AppError } from "../errors.js";
import * as repository from "../repositories/dashboard-repository.js";
import { assignedRoles, effectivePermissions, hasRole } from "../permissions.js";

export function createDashboardService(pool: Pool) {
    return {
        async get(auth: AuthContext, organizationId?: string) {
            const selectedOrganizationId = auth.role === "system_admin" ? organizationId : auth.organizationId;
            if (!selectedOrganizationId) {
                throw new AppError(400, "ORGANIZATION_REQUIRED", "Select an organization before loading the dashboard.");
            }
            const dashboard = await withContext(pool, auth, (client) => repository.getDashboard(client, selectedOrganizationId));
            const permissions = auth.permissions ?? effectivePermissions(assignedRoles(auth), []);
            if (!permissions.suppliers.read) { dashboard.suppliers = []; dashboard.supplierCount = 0; }
            if (!permissions.plots.read) { dashboard.plots = []; dashboard.plotCount = 0; }
            if (!permissions.shipments.read) dashboard.shipmentCount = 0;
            if (!permissions.risk.read) { dashboard.reviews = []; dashboard.openReviewCount = 0; }
            if (!permissions.dds.read) { dashboard.documents = []; dashboard.documentCount = 0; }
            dashboard.operations = dashboard.operations.filter((operation) =>
                operation.kind === "satellite" ? permissions.plots.read : permissions.dds.read);
            dashboard.operationCount = dashboard.operations.length;
            return {
                organizationId: selectedOrganizationId,
                source: "tracebackend",
                generatedAt: new Date().toISOString(),
                capabilities: {
                    suppliers: true,
                    plots: true,
                    reviews: true,
                    documents: true,
                    operations: true,
                    shipments: true,
                    riskSignals: true,
                    dds: true,
                },
                ...dashboard,
            };
        },

        async organization(auth: AuthContext, organizationId: string) {
            const privileged = hasRole(auth, ["system_admin", "org_admin"]) && auth.permissions?.users.read !== false;
            const details = await withContext(pool, auth, (client) =>
                repository.getOrganization(client, organizationId, {
                    includeConfig: true,
                    includeMembers: privileged,
                }));
            if (!details) throw new AppError(404, "NOT_FOUND", "Organization was not found.");
            const permissions = auth.permissions ?? effectivePermissions(assignedRoles(auth), []);
            if (!permissions.users.read) details.counts.users = 0;
            if (!permissions.suppliers.read) details.counts.suppliers = 0;
            if (!permissions.plots.read) details.counts.plots = 0;
            if (!permissions.shipments.read) details.counts.shipments = 0;
            if (!permissions.dds.read) { details.counts.documents = 0; details.counts.operations = 0; }
            return details;
        },
    };
}
