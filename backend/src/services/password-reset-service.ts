import { randomBytes, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { FastifyBaseLogger } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { queryMany, queryOne, withContext } from "../db.js";
import { AppError } from "../errors.js";
import { hashOpaqueToken, hashPassword } from "../security.js";

const mailUnavailable = () =>
  new AppError(503, "MAIL_UNAVAILABLE", "Password reset email is temporarily unavailable. Please try again later.");

export const forgotPasswordSchema = z.object({
  email: z.string().email().transform((value) => value.toLowerCase()),
  organizationSlug: z.string().min(2).max(63).optional(),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(32).max(256),
  password: z.string().min(12).max(1024),
});

type ResetRecipient = {
  id: string;
  email: string;
  token: string;
  tokenHash: string;
};

async function sendResetEmail(
  recipient: ResetRecipient,
  resendApiKey: string,
  fromEmail: string,
  frontendBaseUrl: string,
  logger?: Pick<FastifyBaseLogger, "error">,
): Promise<void> {
  const resetUrl = new URL("/index-prod.html", frontendBaseUrl);
  resetUrl.hash = `reset-password?token=${encodeURIComponent(recipient.token)}`;

  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": recipient.id,
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [recipient.email],
        subject: "Password reset",
        text: `Use this link to reset your password: ${resetUrl}\n\nThis link expires in one hour and can be used once. If you did not request a password reset, you can ignore this email.`,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    logger?.error({ mailFailure: "network_or_timeout" }, "Password reset email delivery failed");
    throw mailUnavailable();
  }
  if (!response.ok) {
    let mailFailure = "provider_rejected";
    try {
      const body = await response.text();
      if (/only send testing emails/i.test(body)) mailFailure = "test_recipient_restricted";
      else if (/domain.*not verified/i.test(body)) mailFailure = "sender_domain_unverified";
      else if (/api key.*invalid|invalid.*api key/i.test(body)) mailFailure = "invalid_api_key";
    } catch {
      mailFailure = "provider_response_unreadable";
    }
    logger?.error({ mailFailure, providerStatus: response.status }, "Password reset email delivery failed");
    throw mailUnavailable();
  }
}

export function createPasswordResetService(pool: Pool, config: AppConfig, logger?: Pick<FastifyBaseLogger, "error">) {
  return {
    async requestReset(email: string, organizationSlug?: string) {
      const resendApiKey = config.RESEND_API_KEY;
      const fromEmail = config.INVITATION_FROM_EMAIL;
      if (!resendApiKey || !fromEmail) {
        logger?.error({ mailFailure: "configuration_missing" }, "Password reset email delivery failed");
        throw mailUnavailable();
      }

      const recipients = await withContext(pool, "system", async (client) => {
        const users = await queryMany<{ id: string; email: string; token_version: number }>(
          client,
          `SELECT u.id, u.email, u.token_version
             FROM users u
             LEFT JOIN organizations o ON o.id = u.organization_id
            WHERE lower(u.email) = $1
              AND ($2::text IS NULL OR o.slug = $2)
              AND u.active = true
              AND u.deleted_at IS NULL
              AND (u.role = 'system_admin' OR o.active = true)
            ORDER BY u.id
            LIMIT 2
            FOR UPDATE OF u`,
          [email, organizationSlug ?? null],
        );
        const issued: ResetRecipient[] = [];
        for (const user of users) {
          const token = randomBytes(32).toString("base64url");
          const tokenHash = hashOpaqueToken(token);
          const id = randomUUID();
          await client.query(
            "UPDATE password_reset_tokens SET consumed_at = now() WHERE user_id = $1 AND consumed_at IS NULL",
            [user.id],
          );
          await client.query(
            `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, user_token_version)
             VALUES ($1, $2, $3, now() + interval '1 hour', $4)`,
            [id, user.id, tokenHash, user.token_version],
          );
          issued.push({ id, email: user.email, token, tokenHash });
        }
        return issued;
      });

      for (const recipient of recipients) {
        try {
          await sendResetEmail(recipient, resendApiKey, fromEmail, config.TRACEHUB_BASE_URL, logger);
        } catch {
          await withContext(pool, "system", (client) =>
            client.query(
              "UPDATE password_reset_tokens SET consumed_at = now() WHERE token_hash = $1 AND consumed_at IS NULL",
              [recipient.tokenHash],
            ));
          throw mailUnavailable();
        }
      }
      return {
        message: "If an active account matches those details, password reset instructions will be sent.",
      };
    },

    async resetPassword(token: string, password: string) {
      const tokenHash = hashOpaqueToken(token);
      const eligible = await withContext(pool, "system", (client) =>
        queryOne<{ id: string }>(
          client,
          `SELECT r.id
             FROM password_reset_tokens r
             JOIN users u ON u.id = r.user_id
             LEFT JOIN organizations o ON o.id = u.organization_id
            WHERE r.token_hash = $1
              AND r.consumed_at IS NULL
              AND r.expires_at > now()
              AND r.user_token_version = u.token_version
              AND u.active = true
              AND u.deleted_at IS NULL
              AND (u.role = 'system_admin' OR o.active = true)`,
          [tokenHash],
        ));
      if (!eligible) {
        throw new AppError(400, "INVALID_RESET_TOKEN", "The password reset link is invalid or expired.");
      }

      const passwordHash = await hashPassword(password);
      await withContext(pool, "system", async (client) => {
        // Match the issuance lock order: user first, then reset token.
        await client.query(
          "SELECT id FROM users WHERE id = (SELECT user_id FROM password_reset_tokens WHERE token_hash = $1) FOR UPDATE",
          [tokenHash],
        );
        const reset = await queryOne<{ id: string; user_id: string }>(
          client,
          `SELECT r.id, r.user_id
             FROM password_reset_tokens r
             JOIN users u ON u.id = r.user_id
             LEFT JOIN organizations o ON o.id = u.organization_id
            WHERE r.token_hash = $1
              AND r.consumed_at IS NULL
              AND r.expires_at > now()
              AND r.user_token_version = u.token_version
              AND u.active = true
              AND u.deleted_at IS NULL
              AND (u.role = 'system_admin' OR o.active = true)
            FOR UPDATE OF r, u`,
          [tokenHash],
        );
        if (!reset) {
          throw new AppError(400, "INVALID_RESET_TOKEN", "The password reset link is invalid or expired.");
        }

        const consumed = await client.query(
          `UPDATE password_reset_tokens
              SET consumed_at = now()
            WHERE id = $1 AND consumed_at IS NULL AND expires_at > now()`,
          [reset.id],
        );
        if (consumed.rowCount !== 1) {
          throw new AppError(400, "INVALID_RESET_TOKEN", "The password reset link is invalid or expired.");
        }
        await client.query(
          "UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2",
          [passwordHash, reset.user_id],
        );
        await client.query(
          "UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, now()) WHERE user_id = $1",
          [reset.user_id],
        );
        await client.query(
          "UPDATE documents SET upload_expires_at = now() WHERE created_by = $1",
          [reset.user_id],
        );
      });
      return { reset: true };
    },
  };
}
