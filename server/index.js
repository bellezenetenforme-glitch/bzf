import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import nodemailer from 'nodemailer';

const app = express();

/* ------------------------------------------------------------------
   CORS : n'autoriser que le front (ou tout en dev).
------------------------------------------------------------------ */
const origin =
  process.env.CLIENT_ORIGIN === 'true'
    ? true
    : (process.env.CLIENT_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean) || true;

app.use(cors({ origin }));
app.use(express.json({ limit: '64kb' }));

/* ------------------------------------------------------------------
   Transporteur email (Nodemailer) via un SMTP configurable.
   MAIL_DRY_RUN=true -> on écrit dans la console au lieu d'envoyer.
------------------------------------------------------------------ */
const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT) || 587;
const SMTP_SECURE = (process.env.SMTP_SECURE || '').toLowerCase() === 'true';
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER || 'contact@bzf.local';
const CONTACT_EMAIL = process.env.CONTACT_EMAIL || SMTP_USER;
const DRY_RUN = (process.env.MAIL_DRY_RUN || '').toLowerCase() === 'true';

const transport =
  !DRY_RUN && SMTP_HOST
    ? nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_SECURE,
        auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
      })
    : null;

function escHtml(s = '') {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function toHtml(body) {
  return String(body || '')
    .split('\n')
    .map((l) => (l.trim() === '' ? '' : escHtml(l)))
    .map((l) => `<div style="font-size:14px;line-height:1.55;">${l || '&nbsp;'}</div>`)
    .join('');
}

async function deliver(subject, text, html) {
  if (DRY_RUN || !transport) {
    console.log('\n=== [DRY RUN / SMTP non configuré] Questionnaire reçu ===');
    console.log('Subject:', subject);
    console.log('To:', CONTACT_EMAIL);
    console.log(text);
    console.log('========================================================\n');
    return { ok: true, dryRun: true };
  }

  await transport.sendMail({
    from: SMTP_FROM,
    to: CONTACT_EMAIL,
    replyTo: undefined, // on répond depuis la boîte de reception normale
    subject,
    text,
    html,
  });
  return { ok: true };
}

/* ------------------------------------------------------------------
   POST /api/contact — reçoit les réponses du questionnaire.
   Format attendu (en provenance de index.html) :
   { _subject, Prenom, Contact, Canal, Message }
------------------------------------------------------------------ */
app.post('/api/contact', async (req, res) => {
  const { _subject, Prenom, Contact, Canal, Message } = req.body || {};

  if (!Message || !String(Message).trim()) {
    return res.status(400).json({ success: false, error: 'Corps de message manquant.' });
  }
  if (!Prenom || !String(Prenom).trim()) {
    return res.status(400).json({ success: false, error: 'Prénom manquant.' });
  }

  const subject = String(_subject || '🩷 Nouveau message — ' + Prenom).slice(0, 150);
  const text = `Prénom : ${Prenom || '-'}\nContact : ${Contact || '-'}\nCanal : ${Canal || '-'}\n\n${Message}`;
  const html =
    `<h3 style="margin:0 0 12px;color:#c4005e;">Nouveau message du site BZF</h3>` +
    `<table style="border-collapse:collapse;margin-bottom:14px;">` +
    `<tr><td style="padding:4px 12px 4px 0;color:#666;">Prénom</td><td>${escHtml(Prenom)}</td></tr>` +
    `<tr><td style="padding:4px 12px 4px 0;color:#666;">Contact</td><td>${escHtml(Contact)}</td></tr>` +
    `<tr><td style="padding:4px 12px 4px 0;color:#666;">Canal</td><td>${escHtml(Canal)}</td></tr>` +
    `</table>` +
    `<div style="border-left:3px solid #ff057d;padding-left:12px;">${toHtml(Message)}</div>`;

  try {
    const out = await deliver(subject, text, html);
    res.json({ success: true, dryRun: !!out.dryRun });
  } catch (e) {
    console.error('Échec de l\'envoi email :', e);
    res.status(500).json({ success: false, error: e.message || 'Erreur serveur.' });
  }
});

/* ------------------------------------------------------------------
   Santé
------------------------------------------------------------------ */
app.get('/health', (_req, res) => {
  const ready = DRY_RUN || !!SMTP_HOST;
  res.json({ status: 'ok', mailReady: ready, mode: DRY_RUN ? 'dry-run' : 'smtp' });
});

const PORT = Number(process.env.PORT) || 4000;
app.listen(PORT, () => {
  console.log('Serveur contact BZF démarré sur http://localhost:' + PORT);
  console.log('Mode email :', DRY_RUN ? 'DRY RUN (console)' : SMTP_HOST ? 'SMTP (' + SMTP_HOST + ')' : 'NON CONFIGURÉ');
});
