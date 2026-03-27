import { Resend } from "resend";
import type { EmailProvider } from "@/features/config/config.schema";
import type { EmailUnsubscribeType } from "@/lib/db/schema";

// ---------------------------------------------------------------------------
// Email client interface — unified contract for all providers
// ---------------------------------------------------------------------------

export interface EmailClient {
  send(options: {
    from: string;
    to: string;
    subject: string;
    html: string;
    headers?: Record<string, string>;
  }): Promise<{ error: { message: string } | null }>;
}

// ---------------------------------------------------------------------------
// Resend
// ---------------------------------------------------------------------------

export function createResendClient({ apiKey }: { apiKey: string }): EmailClient {
  const resend = new Resend(apiKey);
  return {
    async send({ from, to, subject, html, headers }) {
      const result = await resend.emails.send({ from, to, subject, html, headers });
      return { error: result.error ?? null };
    },
  };
}

// ---------------------------------------------------------------------------
// Postmark
// ---------------------------------------------------------------------------

export function createPostmarkClient({
  apiKey,
  serverId,
}: {
  apiKey: string;
  serverId?: number;
}): EmailClient {
  return {
    async send({ from, to, subject, html, headers }) {
      try {
        const body: Record<string, unknown> = {
          From: from,
          To: to,
          Subject: subject,
          HtmlBody: html,
          Headers: headers ? Object.entries(headers).map(([k, v]) => ({ Name: k, Value: v })) : undefined,
        };
        if (serverId) {
          body.ServerId = serverId;
        }
        const response = await fetch("https://api.postmarkapp.com/email", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Postmark-Server-Token": apiKey,
          },
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          const data = await response.json() as { Message?: string };
          return { error: { message: data.Message ?? `Postmark error: ${response.status}` } };
        }
        return { error: null };
      } catch (err) {
        return { error: { message: err instanceof Error ? err.message : "Unknown error" } };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Mailgun
// ---------------------------------------------------------------------------

export function createMailgunClient({
  apiKey,
  domain,
}: {
  apiKey: string;
  domain: string;
}): EmailClient {
  return {
    async send({ from, to, subject, html, headers }) {
      try {
        const response = await fetch(
          `https://api.mailgun.net/v3/${domain}/messages`,
          {
            method: "POST",
            headers: {
              Authorization: `Basic ${btoa(`api:${apiKey}`)}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              from,
              to,
              subject,
              html,
              ...(headers?.["Reply-To"] ? { "h:Reply-To": headers["Reply-To"] } : {}),
            }),
          },
        );
        if (!response.ok) {
          const data = await response.json() as { message?: string };
          return { error: { message: data.message ?? `Mailgun error: ${response.status}` } };
        }
        return { error: null };
      } catch (err) {
        return { error: { message: err instanceof Error ? err.message : "Unknown error" } };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// SendGrid
// ---------------------------------------------------------------------------

export function createSendGridClient({ apiKey }: { apiKey: string }): EmailClient {
  return {
    async send({ from, to, subject, html, headers }) {
      try {
        const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            personalizations: [{ to: [{ email: to }] }],
            from: { email: from },
            subject,
            content: [{ type: "text/html", value: html }],
            ...(headers?.["Reply-To"] ? { reply_to: { email: headers["Reply-To"] } } : {}),
          }),
        });
        if (!response.ok) {
          const data = await response.json() as { errors?: Array<{ message: string }> };
          return { error: { message: data.errors?.[0]?.message ?? `SendGrid error: ${response.status}` } };
        }
        return { error: null };
      } catch (err) {
        return { error: { message: err instanceof Error ? err.message : "Unknown error" } };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Mandrill
// ---------------------------------------------------------------------------

export function createMandrillClient({ apiKey }: { apiKey: string }): EmailClient {
  return {
    async send({ from, to, subject, html }) {
      try {
        const response = await fetch("https://mandrillapp.com/api/1.0/messages/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            key: apiKey,
            message: {
              from_email: from,
              subject,
              html,
              to: [{ email: to, type: "to" }],
            },
          }),
        });
        if (!response.ok) {
          const data = await response.json() as { status?: string; message?: string };
          return { error: { message: data.message ?? `Mandrill error: ${response.status}` } };
        }
        const data = await response.json() as Array<{ status: string; reject_reason?: string }>;
        const result = data[0];
        if (result?.status === "rejected" || result?.status === "invalid") {
          return { error: { message: result.reject_reason ?? "Mandrill rejected the message" } };
        }
        return { error: null };
      } catch (err) {
        return { error: { message: err instanceof Error ? err.message : "Unknown error" } };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Factory — 根据 provider 创建对应 client
// ---------------------------------------------------------------------------

export function createEmailClientFactory(
  provider: EmailProvider,
  config: {
    apiKey?: string;
    domain?: string;
    serverId?: number;
  },
): EmailClient {
  switch (provider) {
    case "resend":
      if (!config.apiKey) throw new Error("Resend API key is required");
      return createResendClient({ apiKey: config.apiKey });
    case "postmark":
      if (!config.apiKey) throw new Error("Postmark API key is required");
      return createPostmarkClient({ apiKey: config.apiKey, serverId: config.serverId });
    case "mailgun":
      if (!config.apiKey || !config.domain) throw new Error("Mailgun API key and domain are required");
      return createMailgunClient({ apiKey: config.apiKey, domain: config.domain });
    case "sendgrid":
      if (!config.apiKey) throw new Error("SendGrid API key is required");
      return createSendGridClient({ apiKey: config.apiKey });
    case "mandrill":
      if (!config.apiKey) throw new Error("Mandrill API key is required");
      return createMandrillClient({ apiKey: config.apiKey });
    default:
      throw new Error(`Unsupported email provider: ${provider satisfies never}`);
  }
}

// ---------------------------------------------------------------------------
// Unsubscribe token utilities
// ---------------------------------------------------------------------------

export async function generateUnsubscribeToken(
  secret: string,
  userId: string,
  type: EmailUnsubscribeType,
): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    enc.encode(`${userId}:${type}`),
  );
  return btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function verifyUnsubscribeToken(
  secret: string,
  userId: string,
  type: EmailUnsubscribeType,
  token: string,
): Promise<boolean> {
  const expectedToken = await generateUnsubscribeToken(secret, userId, type);
  return token === expectedToken;
}
