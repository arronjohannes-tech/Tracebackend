import type { Pool } from "pg";
import type { AuthContext } from "../types.js";
import { withContext } from "../db.js";
import { AppError } from "../errors.js";
import * as repository from "../repositories/dashboard-repository.js";

export function createDashboardService(pool: Pool) {
    return {
        async get(auth: AuthContext, organizationId?: string) {
            const selectedOrganizationId = auth.role === "system_admin" ? organizationId : auth.organizationId;
            if (!selectedOrganizationId) {
                throw new AppError(400, "ORGANIZATION_REQUIRED", "Select an organization before loading the dashboard.");
            }
            const dashboard = await withContext(pool, auth, (client) => repository.getDashboard(client, selectedOrganizationId));
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
                    shipments: false,
                    riskSignals: false,
                    dds: false,
                },
                ...dashboard,
            };
        },
    };
}
