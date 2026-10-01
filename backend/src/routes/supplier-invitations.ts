import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { writeAudit } from "../audit.js";
import type { AppConfig } from "../config.js";
import { queryOne, withContext } from "../db.js";
import { AppError, conflict } from "../errors.js";
import { organizationFor, parse, requireRoles, sendData, uuidSchema } from "../http.js";
import { supplierJson } from "../repositories/sync-repository.js";
import { hashOpaqueToken, hashPassword } from "../security.js";
import { createAuthService } from "../services/auth-service.js";

const invitationSchema = z.object({
    organizationId: uuidSchema.optional(),
    legalName: z.string().trim().min(2).max(200),
    email: z.string().email().transform((value) => value.toLowerCase()),
});
const tokenSchema = z.object({ token: z.string().min(32).max(256) });
const registrationSchema = tokenSchema.extend({
    legalName: z.string().trim().min(2).max(200),
    tradingName: z.string().trim().max(200).default(""),
    registrationNumber: z.string().trim().min(1).max(100),
    taxId: z.string().trim().max(100).default(""),
    countryCode: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/),
    region: z.string().trim().min(1).max(200),
    streetAddress: z.string().trim().min(1).max(300),
    city: z.string().trim().min(1).max(200),
    postalCode: z.string().trim().max(30).default(""),
    contactName: z.string().trim().min(2).max(120),
    contactPhone: z.string().trim().min(3).max(50),
    website: z.union([z.string().url().max(300), z.literal("")]).default(""),
    password: z.string().min(12).max(1024),
});

type Invitation = {
    id: string;
    organization_id: string;
    organization_name: string;
    organization_slug: string;
    legal_name: string;
    email: string;
    expires_at: Date;
    accepted_at: Date | null;
};

function assertUsable(invitation: Invitation | null): asserts invitation is Invitation {
    if (!invitation || invitation.accepted_at || invitation.expires_at.getTime() <= Date.now()) {
        throw new AppError(410, "INVITATION_INVALID", "This invitation has expired or has already been used.");
    }
}

export async function registerSupplierInvitationRoutes(
    app: FastifyInstance,
    pool: Pool,
    config: AppConfig,
    authenticate: (request: FastifyRequest) => Promise<void>,
): Promise<void> {
    app.post("/api/v1/supplier-invitations", {
        preHandler: authenticate,
        config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
    }, async (request, reply) => {
        requireRoles(request, ["system_admin", "org_admin"]);
        const body = parse(invitationSchema, request.body);
        const organizationId = organizationFor(request, body.organizationId);
        if (!config.RESEND_API_KEY || !config.INVITATION_FROM_EMAIL) {
            throw new AppError(503, "MAIL_NOT_CONFIGURED", "Supplier invitation email is not configured.");
        }
        const token = randomBytes(32).toString("base64url");
        const invitation = await withContext(pool, request.auth!, async (client) => {
            const organization = await queryOne<{ name: string }>(client,
                "SELECT name FROM organizations WHERE id = $1 AND active = true", [organizationId]);
            if (!organization) throw new AppError(404, "ORGANIZATION_NOT_FOUND", "Organization not found.");
            const existing = await queryOne(client,
                "SELECT 1 FROM users WHERE organization_id = $1 AND lower(email) = $2", [organizationId, body.email]);
            if (existing) throw conflict("ALREADY_REGISTERED", "This email is already registered.");
            const row = await queryOne<{ id: string; expires_at: Date }>(client,
                `INSERT INTO supplier_invitations (organization_id, legal_name, email, token_hash, expires_at, created_by)
         VALUES ($1, $2, $3, $4, now() + interval '7 days', $5)
         RETURNING id, expires_at`,
                [organizationId, body.legalName, body.email, hashOpaqueToken(token), request.auth!.userId]);
            await writeAudit(client, request, request.auth!, "supplier.invite", "supplier_invitation", row!.id, {
                organizationId, email: body.email,
            });
            return { ...row!, organizationName: organization.name };
        });
        const registrationUrl = new URL("/register.html", config.TRACEHUB_BASE_URL);
        registrationUrl.hash = `token=${encodeURIComponent(token)}`;
        let delivered = false;
        try {
            const response = await fetch("https://api.resend.com/emails", {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${config.RESEND_API_KEY}`,
                    "Content-Type": "application/json",
                    "Idempotency-Key": invitation.id,
                },
                body: JSON.stringify({
                    from: config.INVITATION_FROM_EMAIL,
                    to: [body.email],
                    subject: `Invitation to register as a supplier for ${invitation.organizationName}`,
                    text: `Hello,\n\n${invitation.organizationName} invites ${body.legalName} to register as a supplier in SCTracker.\n\nRegister here: ${registrationUrl}\n\nThis link expires in 7 days and can be used once. If you did not expect this invitation, you can ignore this email.`,
                }),
                signal: AbortSignal.timeout(10_000),
            });
            delivered = response.ok;
        } catch {
            throw new AppError(502, "MAIL_DELIVERY_UNCERTAIN", "Email delivery could not be confirmed. Check with the recipient before retrying.");
        }
        if (!delivered) {
            await withContext(pool, request.auth!, (client) => client.query(
                "DELETE FROM supplier_invitations WHERE id = $1 AND accepted_at IS NULL", [invitation.id]));
            throw new AppError(502, "MAIL_DELIVERY_FAILED", "The invitation email could not be sent. Please try again.");
        }
        return sendData(reply, { email: body.email, expiresAt: invitation.expires_at }, 201);
    });

    app.post("/api/v1/supplier-invitations/resolve", {
        config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    }, async (request, reply) => {
        const { token } = parse(tokenSchema, request.body);
        const invitation = await withContext(pool, "system", (client) => queryOne<Invitation>(client,
            `SELECT i.id, i.organization_id, i.legal_name, i.email, i.expires_at, i.accepted_at,
              o.name AS organization_name, o.slug AS organization_slug
         FROM supplier_invitations i JOIN organizations o ON o.id = i.organization_id
        WHERE i.token_hash = $1 AND o.active = true`, [hashOpaqueToken(token)]));
        assertUsable(invitation);
        return sendData(reply, {
            legalName: invitation.legal_name,
            email: invitation.email,
            organizationName: invitation.organization_name,
        });
    });

    app.post("/api/v1/supplier-invitations/register", {
        config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    }, async (request, reply) => {
        const body = parse(registrationSchema, request.body);
        const passwordHash = await hashPassword(body.password);
        const account = await withContext(pool, "system", async (client) => {
            const invitation = await queryOne<Invitation>(client,
                `SELECT i.id, i.organization_id, i.legal_name, i.email, i.expires_at, i.accepted_at,
                o.name AS organization_name, o.slug AS organization_slug
           FROM supplier_invitations i JOIN organizations o ON o.id = i.organization_id
          WHERE i.token_hash = $1 AND o.active = true FOR UPDATE OF i`, [hashOpaqueToken(body.token)]);
            assertUsable(invitation);
            const supplier = await queryOne<Record<string, unknown>>(client,
                `INSERT INTO suppliers (id, organization_id, name, trading_name, registration_number, tax_id,
           country_code, region, street_address, city, postal_code, contact_name, contact_email,
           contact_phone, website, source_updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, now())
         RETURNING *`,
                [invitation.organization_id, body.legalName, body.tradingName, body.registrationNumber,
                body.taxId, body.countryCode, body.region, body.streetAddress, body.city, body.postalCode,
                body.contactName, invitation.email, body.contactPhone, body.website]);
            const user = await queryOne<{ id: string }>(client,
                `INSERT INTO users (organization_id, email, display_name, password_hash, role)
         VALUES ($1, $2, $3, $4, 'field_agent') RETURNING id`,
                [invitation.organization_id, invitation.email, body.contactName, passwordHash]);
            await client.query("UPDATE supplier_invitations SET accepted_at = now() WHERE id = $1", [invitation.id]);
            await client.query(
                "INSERT INTO sync_changes (organization_id, entity_type, entity_id, payload) VALUES ($1, 'supplier', $2, $3::jsonb)",
                [invitation.organization_id, supplier!.id, JSON.stringify(supplierJson(supplier!))]);
            await writeAudit(client, request, {
                userId: user!.id, organizationId: invitation.organization_id, role: "field_agent", tokenVersion: 0,
            }, "supplier.register", "supplier", String(supplier!.id), { organizationId: invitation.organization_id });
            return { email: invitation.email, organizationSlug: invitation.organization_slug };
        });
        const session = await createAuthService(pool, config).login({
            email: account.email, password: body.password, organizationSlug: account.organizationSlug,
        }, request);
        return sendData(reply, session, 201);
    });
}