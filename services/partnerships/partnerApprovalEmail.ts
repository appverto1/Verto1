import { Resend } from 'resend';

type ApprovedPartner = { display_name: string; contact_email: string };

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] || character));

/**
 * A one-time onboarding link is delivered only after administrative approval.
 * The partner later signs in with password or Google; no recurring magic links.
 * Never log the generated action_link or include it in API responses.
 */
export async function sendPartnerApprovalEmail(supabase: any, partner: ApprovedPartner) {
  const from = String(process.env.RESEND_FROM_EMAIL || '').trim();
  const apiKey = String(process.env.RESEND_API_KEY || '').trim();
  const configuredBase = String(process.env.VERTO_APP_BASE_URL || '').trim();
  if (!from || !apiKey || !configuredBase) throw new Error('PARTNER_EMAIL_NOT_CONFIGURED');
  const baseUrl = new URL(configuredBase);
  if (baseUrl.protocol !== 'https:' || baseUrl.username || baseUrl.password || !baseUrl.hostname) {
    throw new Error('PARTNER_APP_URL_INVALID');
  }
  const redirectTo = new URL('/parcerias?partner_oauth=1&partner_setup=1', baseUrl.origin).toString();
  const email = String(partner.contact_email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('PARTNER_EMAIL_INVALID');

  const generated = await supabase.auth.admin.generateLink({
    type: 'magiclink', email, options: { redirectTo },
  });
  const link = generated.data?.properties?.action_link;
  if (generated.error || typeof link !== 'string' || !link.startsWith('https://')) {
    throw new Error('PARTNER_LINK_GENERATION_FAILED');
  }

  const name = String(partner.display_name || 'Parceiro').trim().slice(0, 180);
  const html = `<div style="font:16px Arial,sans-serif;color:#1e293b;line-height:1.65">
    <h2 style="color:#6d28d9">Sua parceria com a Verto foi aprovada!</h2>
    <p>Olá, ${escapeHtml(name)}!</p>
    <p>Seu acesso ao Portal do Parceiro está liberado, <strong>sem custo</strong>.
    Clique no botão para cadastrar sua senha ou acessar com sua conta Google do mesmo e-mail.</p>
    <p><a href="${escapeHtml(link)}" style="display:inline-block;background:#6d28d9;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none">Ativar meu acesso</a></p>
    <p>Este link é de uso único. Após a ativação, seus próximos acessos serão com e-mail e senha ou Google, sem precisar receber outro link.</p>
    <p>Se não solicitou esta parceria, ignore esta mensagem.</p>
  </div>`;
  const client = new Resend(apiKey);
  const sent = await client.emails.send({
    from, to: email, subject: 'Verto — sua parceria foi aprovada', html,
    text: `Olá, ${name}! Sua parceria com a Verto foi aprovada, sem custo. Ative sua conta pelo link: ${link} . Depois entre com e-mail e senha ou Google.`,
  });
  if (sent.error || !sent.data?.id) throw new Error('PARTNER_EMAIL_DELIVERY_FAILED');
}
