import type { FastifyBaseLogger } from "fastify";
import type { AppConfig } from "../config.js";
import { AppError } from "../errors.js";

export async function sendAccountEmail(
  config: Pick<AppConfig, "RESEND_API_KEY" | "INVITATION_FROM_EMAIL">,
  mail: { id: string; to: string; subject: string; text: string },
  logger?: Pick<FastifyBaseLogger, "error">,
): Promise<void> {
  const fail = (mailFailure: string, providerStatus?: number): never => {
    logger?.error({ mailFailure, ...(providerStatus === undefined ? {} : { providerStatus }) }, "Account email delivery failed");
    throw new AppError(503, "MAIL_UNAVAILABLE", "Email delivery is temporarily unavailable. Please try again later.");
  };
  if (!config.RESEND_API_KEY || !config.INVITATION_FROM_EMAIL) fail("configuration_missing");
  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": mail.id,
      },
      body: JSON.stringify({ from: config.INVITATION_FROM_EMAIL, to: [mail.to], subject: mail.subject, text: mail.text }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return fail("network_or_timeout");
  }
  if (!response.ok) {
    let cause = "provider_rejected";
    try {
      const body = await response.text();
      if (/only send testing emails/i.test(body)) cause = "test_recipient_restricted";
      else if (/domain.*not verified/i.test(body)) cause = "sender_domain_unverified";
      else if (/api key.*invalid|invalid.*api key/i.test(body)) cause = "invalid_api_key";
    } catch {
      cause = "provider_response_unreadable";
    }
    fail(cause, response.status);
  }
}
