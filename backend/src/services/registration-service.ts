import { randomBytes, randomUUID } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import type { Pool, PoolClient } from "pg";
import { isSupportedCountry, parsePhoneNumberFromString } from "libphonenumber-js/max";
import { z } from "zod";
import { writeAudit, type AuditContext } from "../audit.js";
import type { AppConfig } from "../config.js";
import { queryMany, queryOne, withContext } from "../db.js";
import { AppError, conflict, notFound } from "../errors.js";
import { hashOpaqueToken, hashPassword } from "../security.js";
import { roles, type AuthContext, type Role } from "../types.js";
import { sendAccountEmail } from "./mail-service.js";
import { assertRemainingAdministrator } from "./user-management-service.js";

export const registrationSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  phoneCountry: z.string().length(2),
  phoneNumber: z.string().trim().min(3).max(40),
}).strict().transform((body, context) => {
  const country = body.phoneCountry;
  const phone = isSupportedCountry(country) && /^\+?[\d\s().-]+$/.test(body.phoneNumber)
    ? parsePhoneNumberFromString(body.phoneNumber, { defaultCountry: country, extract: false }) : undefined;
  if (!phone?.isValid() || phone.ext || phone.country !== country) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["phoneNumber"], message: "Enter a valid phone number for the selected country." });
    return z.NEVER;
  }
  return { ...body, phoneNumber: String(phone.number) };
});
const managedRole = z.enum(roles).exclude(["system_admin"]);
export const registrationApprovalSchema = z.object({
  organizationId: z.string().uuid(),
  roles: z.array(managedRole).min(1).max(4).refine((value) => new Set(value).size === value.length),
}).strict();
export const activationSchema = z.object({
  token: z.string().min(32).max(256),
  password: z.string().min(12).max(1024),
}).strict();
export const registrationListSchema = z.object({
  status: z.enum(["pending", "approved", "active", "disabled"]).optional(),
  search: z.string().trim().max(120).default(""),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

type Registration = {
  id: string; display_name: string; email: string; phone_country: string; phone_number: string;
  status: string; organization_id: string | null; assigned_roles: Role[] | null; user_id: string | null;
  activation_token_hash: string | null; activation_expires_at: Date | null;
};
const effectiveStatus = "CASE WHEN r.user_id IS NOT NULL THEN CASE WHEN u.active AND u.deleted_at IS NULL THEN 'active' ELSE 'disabled' END ELSE r.status END";
const publicFields = `r.id,r.display_name AS "displayName",r.email,r.phone_country AS "phoneCountry",
  r.phone_number AS "phoneNumber",${effectiveStatus} AS status,
  r.organization_id AS "organizationId",o.name AS "organizationName",
  COALESCE(u.assigned_roles,r.assigned_roles)::text[] AS roles,r.user_id AS "userId",
  r.created_at AS "createdAt",r.approved_at AS "approvedAt",r.activated_at AS "activatedAt",
  r.delivery_status AS "deliveryStatus"`;
const joins = "FROM mobile_registrations r LEFT JOIN users u ON u.id=r.user_id LEFT JOIN organizations o ON o.id=r.organization_id";
const invalidActivation = () => new AppError(400, "INVALID_ACTIVATION_TOKEN", "The activation link is invalid or expired.");
const neutral = { message: "If eligible, your registration will be reviewed. You will receive an email after approval." };

async function revokeAccess(client: PoolClient, userId: string, organizationId: string) {
  await client.query("UPDATE refresh_tokens SET revoked_at=COALESCE(revoked_at,now()) WHERE user_id=$1", [userId]);
  await client.query("UPDATE documents SET upload_expires_at=now() WHERE created_by=$1 AND organization_id=$2", [userId, organizationId]);
  await client.query("UPDATE password_reset_tokens SET consumed_at=COALESCE(consumed_at,now()) WHERE user_id=$1", [userId]);
}

export function createRegistrationService(pool: Pool, config: AppConfig, logger?: Pick<FastifyBaseLogger, "error">) {
  // All lifecycle writes lock the organization before the registration/user, matching user administration.
  async function lock(client: PoolClient, id: string, organizationId?: string) {
    const snapshot = await queryOne<Registration>(client, "SELECT * FROM mobile_registrations WHERE id=$1", [id]);
    if (!snapshot) throw notFound("Registration");
    const ids = [...new Set([snapshot.organization_id, organizationId].filter((value): value is string => Boolean(value)))].sort();
    for (const orgId of ids) await client.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [orgId]);
    const row = await queryOne<Registration>(client, "SELECT *,assigned_roles::text[] AS assigned_roles FROM mobile_registrations WHERE id=$1 FOR UPDATE", [id]);
    if (!row) throw notFound("Registration");
    if (row.organization_id !== snapshot.organization_id) throw conflict("REGISTRATION_CHANGED", "Registration changed; reload and try again.");
    return row;
  }
  async function deliver(id: string, email: string, token: string, tokenHash: string) {
    const url = new URL("/mobile-activate.html", config.TRACEHUB_BASE_URL);
    url.hash = `token=${encodeURIComponent(token)}`;
    try {
      await sendAccountEmail(config, {
        id: randomUUID(), to: email, subject: "Activate your Tracehub mobile account",
        text: `Your registration has been approved.\n\nOpen this link to set your first password in the Tracehub mobile app:\n${url}\n\nThis link expires in 24 hours and can be used once. If you did not register, ignore this email.`,
      }, logger);
    } catch (error) {
      await withContext(pool, "system", (client) => client.query(
        `UPDATE mobile_registrations SET activation_token_hash=NULL,activation_expires_at=NULL,
         delivery_status='failed',updated_at=now() WHERE id=$1 AND activation_token_hash=$2`, [id, tokenHash]));
      throw error;
    }
    await withContext(pool, "system", (client) => client.query(
      "UPDATE mobile_registrations SET delivery_status='sent',updated_at=now() WHERE id=$1 AND activation_token_hash=$2", [id, tokenHash]));
  }
  async function issue(auth: AuthContext, audit: AuditContext, id: string, approval?: z.infer<typeof registrationApprovalSchema>) {
    const token = randomBytes(32).toString("base64url");
    const tokenHash = hashOpaqueToken(token);
    const result = await withContext(pool, auth, async (client) => {
      const row = await lock(client, id, approval?.organizationId);
      if (row.user_id) {
        if (!approval) throw conflict("ALREADY_ACTIVATED", "This account already has a password.");
        if (approval.organizationId !== row.organization_id) throw conflict("ORGANIZATION_MISMATCH", "An existing account cannot be moved to another organization.");
        const user = await queryOne<{ active: boolean; assigned_roles: Role[] }>(client,
          "SELECT active,assigned_roles::text[] AS assigned_roles FROM users WHERE id=$1 AND deleted_at IS NULL FOR UPDATE", [row.user_id]);
        if (!user) throw conflict("USER_DELETED", "Deleted accounts cannot be reactivated.");
        if (user.active) throw conflict("ALREADY_ACTIVATED", "This account is already active.");
        if (!await queryOne(client, "SELECT id FROM organizations WHERE id=$1 AND active", [row.organization_id])) {
          throw conflict("ORGANIZATION_INACTIVE", "Select an active organization.");
        }
        if (approval.roles.length !== user.assigned_roles.length ||
            approval.roles.some((role) => !user.assigned_roles.includes(role))) {
          throw conflict("ROLES_UNCHANGED", "Reactivation preserves existing roles. Manage role changes in user administration.");
        }
        await client.query("UPDATE users SET active=true,token_version=token_version+1,updated_at=now() WHERE id=$1", [row.user_id]);
        await client.query("UPDATE mobile_registrations SET status='active',updated_at=now() WHERE id=$1", [id]);
        await writeAudit(client, audit, auth, "registration.reactivate", "user", row.user_id, {});
        return { email: row.email, send: false };
      }
      if (!approval && row.status !== "approved") throw conflict("NOT_APPROVED", "Approve the registration before sending an activation link.");
      const orgId = approval?.organizationId ?? row.organization_id;
      if (!await queryOne(client, "SELECT id FROM organizations WHERE id=$1 AND active", [orgId])) throw conflict("ORGANIZATION_INACTIVE", "Select an active organization.");
      if (await queryOne(client, "SELECT id FROM users WHERE lower(email)=$1 LIMIT 1", [row.email])) {
        throw conflict("ALREADY_REGISTERED", "An account with this email already exists. Manage the existing account instead.");
      }
      const selected = roles.filter((role) => (approval?.roles ?? row.assigned_roles ?? []).includes(role));
      await client.query(`UPDATE mobile_registrations SET status='approved',organization_id=$2,
        assigned_roles=$3::user_role[],approved_by=$4,approved_at=now(),
        activation_token_hash=$5,activation_expires_at=now()+interval '24 hours',
        delivery_status='not_sent',updated_at=now() WHERE id=$1`,
      [id, orgId, selected, auth.userId, tokenHash]);
      await writeAudit(client, audit, auth, approval ? "registration.approve" : "registration.resend", "registration", id,
        { organizationId: orgId, roles: selected });
      return { email: row.email, send: true };
    });
    if (result.send) await deliver(id, result.email, token, tokenHash);
    return { message: result.send ? "Registration approved; activation email accepted by mail provider." : "Account reactivated with its existing password." };
  }
  return {
    async register(body: z.output<typeof registrationSchema>) {
      await withContext(pool, "system", (client) => client.query(
        `INSERT INTO mobile_registrations(display_name,email,phone_country,phone_number)
         SELECT $1,$2,$3,$4 WHERE NOT EXISTS(SELECT 1 FROM users WHERE lower(email)=$2)
         ON CONFLICT(email) DO NOTHING`, [body.displayName, body.email, body.phoneCountry, body.phoneNumber]));
      return neutral;
    },
    async list(auth: AuthContext, options: z.infer<typeof registrationListSchema>) {
      return withContext(pool, auth, async (client) => {
        const values = [options.status ?? null, options.search];
        const filter = `WHERE ($1::text IS NULL OR ${effectiveStatus}=$1)
          AND ($2='' OR strpos(lower(r.display_name||' '||r.email||' '||r.phone_number),lower($2))>0)`;
        const count = await queryOne<{ total: number }>(client, `SELECT count(*)::int AS total ${joins} ${filter}`, values);
        const items = await queryMany(client, `SELECT ${publicFields} ${joins} ${filter}
          ORDER BY r.created_at DESC,r.id LIMIT $3 OFFSET $4`, [...values, options.pageSize, (options.page - 1) * options.pageSize]);
        return { items, total: count?.total ?? 0, page: options.page, pageSize: options.pageSize };
      });
    },
    async get(auth: AuthContext, id: string) {
      return withContext(pool, auth, async (client) => {
        const row = await queryOne(client, `SELECT ${publicFields} ${joins} WHERE r.id=$1`, [id]);
        if (!row) throw notFound("Registration");
        return row;
      });
    },
    approve: (auth: AuthContext, audit: AuditContext, id: string, body: z.infer<typeof registrationApprovalSchema>) => issue(auth, audit, id, body),
    resend: (auth: AuthContext, audit: AuditContext, id: string) => issue(auth, audit, id),
    async deactivate(auth: AuthContext, audit: AuditContext, id: string) {
      await withContext(pool, auth, async (client) => {
        const row = await lock(client, id);
        if (row.user_id) {
          if (row.user_id === auth.userId) throw conflict("SELF_ACCESS_CHANGE", "You cannot deactivate your own account.");
          await assertRemainingAdministrator(client, row.organization_id!, row.user_id, row.assigned_roles ?? [], false);
          await client.query("UPDATE users SET active=false,token_version=token_version+1,updated_at=now() WHERE id=$1", [row.user_id]);
          await revokeAccess(client, row.user_id, row.organization_id!);
        }
        await client.query(`UPDATE mobile_registrations SET status='disabled',activation_token_hash=NULL,
          activation_expires_at=NULL,updated_at=now() WHERE id=$1`, [id]);
        await writeAudit(client, audit, auth, "registration.deactivate", "registration", id, {});
      });
      return { message: "Registration deactivated; access and activation links revoked." };
    },
    async activate(token: string, password: string, audit: AuditContext) {
      const tokenHash = hashOpaqueToken(token);
      const snapshot = await withContext(pool, "system", (client) => queryOne<{ id: string }>(client,
        "SELECT id FROM mobile_registrations WHERE activation_token_hash=$1 AND status='approved' AND activation_expires_at>now() AND user_id IS NULL", [tokenHash]));
      if (!snapshot) throw invalidActivation();
      const passwordHash = await hashPassword(password);
      return withContext(pool, "system", async (client) => {
        const row = await lock(client, snapshot.id);
        if (row.status !== "approved" || row.user_id || row.activation_token_hash !== tokenHash ||
          !row.activation_expires_at || row.activation_expires_at.getTime() <= Date.now()) throw invalidActivation();
        if (!await queryOne(client, "SELECT id FROM organizations WHERE id=$1 AND active", [row.organization_id])) throw invalidActivation();
        if (await queryOne(client, "SELECT id FROM users WHERE lower(email)=$1 LIMIT 1", [row.email])) throw invalidActivation();
        const selected = row.assigned_roles!;
        const user = await queryOne<{ id: string }>(client, `INSERT INTO users(organization_id,email,display_name,password_hash,role,
          assigned_roles,active,phone_country,phone_number) VALUES($1,$2,$3,$4,$5,$6::user_role[],true,$7,$8) RETURNING id`,
        [row.organization_id, row.email, row.display_name, passwordHash, roles.find((role) => selected.includes(role)), selected, row.phone_country, row.phone_number]);
        await client.query(`UPDATE mobile_registrations SET status='active',user_id=$2,activated_at=now(),
          activation_token_hash=NULL,activation_expires_at=NULL,updated_at=now() WHERE id=$1`, [row.id, user!.id]);
        const userAuth: AuthContext = { userId: user!.id, organizationId: row.organization_id, role: roles.find((role) => selected.includes(role))!, tokenVersion: 0 };
        await writeAudit(client, audit, userAuth, "registration.activate", "user", user!.id, {});
        return { message: "Account activated. Sign in with your new password.", email: row.email };
      });
    },
  };
}
