// Sends security emails (verification codes) through the SMTP settings the
// panels already use. Nothing secret is logged.
import nodemailer from 'nodemailer';

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) {
    const err = new Error('Email is not configured (SMTP_HOST, SMTP_USER, SMTP_PASS)');
    err.code = 'smtp_not_configured';
    throw err;
  }
  const port = Number(process.env.SMTP_PORT || 587);
  transporter = nodemailer.createTransport({
    host,
    port,
    secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465,
    auth: { user, pass },
  });
  return transporter;
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function sendVerificationCode({ to, code, appName }) {
  await getTransporter().sendMail({
    from: process.env.FROM_EMAIL || process.env.SMTP_USER,
    to,
    subject: `${appName}: your sign-in code is ${code}`,
    text: `Your sign-in code is ${code}. It expires in 10 minutes. If you did not try to sign in, you can ignore this email.`,
    html: `<p>Your sign-in code is:</p><p style="font-size:24px;font-weight:bold;letter-spacing:4px">${escapeHtml(code)}</p><p>It expires in 10 minutes. If you did not try to sign in, you can ignore this email.</p>`,
  });
}

export function maskEmail(email) {
  const [local, domain] = String(email || '').split('@');
  if (!local || !domain) return '';
  const shown = local.length <= 2 ? local[0] : `${local[0]}${'*'.repeat(Math.min(local.length - 2, 6))}${local.slice(-1)}`;
  return `${shown}@${domain}`;
}
