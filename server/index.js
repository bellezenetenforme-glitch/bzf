import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import nodemailer from 'nodemailer';

const app = express();

/* ------------------------------------------------------------------
   CORS : n'autoriser que le front (ou tout en dev).
   ATTENTION : un tableau vide est truthy en JS, donc le `|| true` de la
   version precedente ne partait jamais et CORS bloquait toutes les origines
   quand CLIENT_ORIGIN etait absent. On teste donc la longueur.
------------------------------------------------------------------ */
const rawOrigins = (process.env.CLIENT_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
const origin =
  process.env.CLIENT_ORIGIN === 'true' || rawOrigins.length === 0
    ? true
    : rawOrigins;

app.use(cors({ origin }));
app.use(express.json({ limit: '64kb' }));
// express rejette les bodies trop gros ou malformes en levant une erreur ;
// sans ce handler la reponse par defaut est un 500 trompeur.
app.use((err, _req, res, _next) => {
  if (err && (err.type === 'entity.too.large' || err.status === 413)) {
    return res.status(413).json({ success: false, error: 'Requete trop volumineuse.' });
  }
  if (err && (err.type === 'entity.parse.failed' || err.status === 400)) {
    return res.status(400).json({ success: false, error: 'JSON invalide.' });
  }
  console.error('Erreur serveur :', err);
  res.status(500).json({ success: false, error: 'Erreur serveur.' });
});

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
/* ------------------------------------------------------------------
   Anti-spam
   Meme jeu de filtres que netlify/functions/contact.mjs, pour que ce
   serveur ne devienne pas un point d'entree non protege s'il est reactivé.
   ------------------------------------------------------------------ */
const MAX_BODY_CHARS = 20000;
const MIN_FILL_MS = 2500;
const RATE_MAX = 3;
const RATE_WINDOW_MS = 60 * 60 * 1000;

// Origines autorisees. Le serveur est long-running : le rate limit tient
// vraiment ici, contrairement a la fonction ou l'instance est ephemere.
const DEFAULT_ORIGINS = [
  'bellezenetenforme.fr', 'www.bellezenetenforme.fr',
  'localhost', '127.0.0.1',
  '.netlify.app', '.netlify.com',
];
const ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const ORIGIN_LIST = ORIGINS.length ? ORIGINS : DEFAULT_ORIGINS;

const hits = new Map();

function originAllowed(req) {
  const raw = req.get('origin') || req.get('referer');
  if (!raw) return false; // ni Origin ni Referer : ce n'est pas un navigateur
  let host;
  try { host = new URL(raw).hostname.toLowerCase(); } catch { return false; }
  return ORIGIN_LIST.some((o) => (o.startsWith('.') ? host.endsWith(o) : host === o || host.endsWith('.' + o)));
}

function tooManySends(ip) {
  const now = Date.now();
  const seen = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  seen.push(now);
  hits.set(ip, seen);
  if (hits.size > 5000) hits.clear();
  return seen.length > RATE_MAX;
}

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
  const { _subject, Prenom, Contact, Canal, Message, _hp, _t } = req.body || {};

  const raw = JSON.stringify(req.body || {});
  if (raw.length > MAX_BODY_CHARS) {
    return res.status(413).json({ success: false, error: 'Requete trop volumineuse.' });
  }

  // Rejets silencieux : reponse 200 sans envoi, aucun signal pour le bot.
  const honey = String(_hp || '').trim();
  const elapsed = Number(_t);
  const ip = req.ip || req.socket?.remoteAddress || 'inconnu';
  if (honey || !Number.isFinite(elapsed) || elapsed < MIN_FILL_MS || !originAllowed(req)) {
    if (honey) console.warn('Anti-spam : honeypot rempli.');
    else if (!Number.isFinite(elapsed) || elapsed < MIN_FILL_MS) console.warn('Anti-spam : remplissage trop rapide.');
    else console.warn('Anti-spam : origine refusee.');
    return res.json({ success: true });
  }
  if (tooManySends(ip)) {
    return res.status(429).json({ success: false, error: 'Trop de demandes. Reessayez plus tard.' });
  }

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
