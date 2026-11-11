export type InvitationEnv = { DB: D1Database; APP_ORIGIN?: string; ADMIN_ACCESS_ENABLED?: string; CLERK_AUTH_ENABLED?: string; CLERK_ISSUER?: string; CLERK_SECRET_KEY?: string; CLERK_PUBLISHABLE_KEY?: string; INVITATIONS_ENABLED?: string; RESEND_FROM?: string; RESEND_API_KEY?: string };
export type MailMessage = { to: string; subject: string; text: string; idempotencyKey: string };
export type MailTransport = { send(message: MailMessage): Promise<{ id: string }> };
export function appOrigin(env: InvitationEnv): string {
  if (!env.APP_ORIGIN) throw new Error('Invitation delivery is not configured.');
  const url = new URL(env.APP_ORIGIN);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Configure an HTTPS application origin.');
  return url.origin;
}
export function invitationMail(env: InvitationEnv, fake?: MailTransport): MailTransport {
  appOrigin(env);
  if (fake) return fake;
  if (env.INVITATIONS_ENABLED !== 'true' || !env.RESEND_FROM || !env.RESEND_API_KEY) throw new Error('Invitation delivery is disabled.');
  return { async send(message) {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': message.idempotencyKey },
      body: JSON.stringify({ from: env.RESEND_FROM, to: [message.to], subject: message.subject, text: message.text }),
      signal: AbortSignal.timeout(15000),
    });
    // All failures are uncertain: never retry a send with a lost raw token.
    if (!response.ok) throw new Error('Email send outcome is uncertain.');
    const data = await response.json() as { id?: string };
    if (!data.id) throw new Error('Email send outcome is uncertain.');
    return { id: data.id };
  } };
}
