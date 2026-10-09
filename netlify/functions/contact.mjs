/* ------------------------------------------------------------------
   Netlify Function — reçoit les réponses du questionnaire BZF
   et les envoie par email via l'API REST Resend (fetch).
   Endpoint déployé : /.netlify/functions/contact
   Config : voir variables d'environnement dans netlify.toml / le dashboard.
------------------------------------------------------------------ */

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const TO_EMAIL = process.env.TO_EMAIL || process.env.CONTACT_EMAIL || '';
const FROM_EMAIL = process.env.FROM_EMAIL || 'BZF <onboarding@resend.dev>';

/* ------------------------------------------------------------------
   Anti-spam
   ------------------------------------------------------------------ */
const MAX_BODY = 20000;         // caracteres
const MIN_FILL_MS = 2500;       // en dessous, ce n'est pas humain
const RATE_MAX = 3;             // envois
const RATE_WINDOW_MS = 60 * 60 * 1000;

// Origines autorisees. ALLOWED_ORIGINS remplace integralement cette liste.
// ATTENTION : toute origine non listee est rejetee SILENCIEUSEMENT (200, aucun
// email). Si tu as un domaine custom, ajoute-le ici ou dans ALLOWED_ORIGINS,
// sinon les vrais clients ne recoivent rien.
const DEFAULT_ORIGINS = [
  'bellezenetenforme.fr', 'www.bellezenetenforme.fr',
  'localhost', '127.0.0.1',
  '.netlify.app', '.netlify.com',
];
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const ORIGINS = ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS : DEFAULT_ORIGINS;

/* Les compteurs vivent sur globalThis : le module est conserve entre les
   invocations a chaud d'une meme instance, donc le quota tient un peu
   dans le temps. Les instances sont ephemeres, ce n'est pas une garantie. */
const store = (globalThis.__bzfRate ??= { hits: new Map() });

function originAllowed(event) {
  const h = event.headers || {};
  const raw = (h.origin && String(h.origin).trim())
    || (h.referer && String(h.referer).trim());
  if (!raw) return false; // ni Origin ni Referer : ce n'est pas un navigateur
  let host;
  // hostname (sans port) : le port de dev ne doit pas casser la correspondance
  try { host = new URL(raw).hostname.toLowerCase(); } catch { return false; }
  return ORIGINS.some((o) => (o.startsWith('.') ? host.endsWith(o) : host === o || host.endsWith('.' + o)));
}

function tooManySends(ip) {
  const now = Date.now();
  const seen = (store.hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  seen.push(now);
  store.hits.set(ip, seen);
  if (store.hits.size > 5000) store.hits.clear(); // garde-fou memoire
  return seen.length > RATE_MAX;
}

function escHtml(s = '') {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function json(res, status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function readBody(ev) {
  const ct = (ev.headers['content-type'] || '').toLowerCase();
  if (ct.includes('application/json')) {
    return typeof ev.body === 'string' ? JSON.parse(ev.body) : ev.json();
  }
  return typeof ev.body === 'string' ? JSON.parse(ev.body || '{}') : ev.json();
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(null, 405, { success: false, error: 'Méthode non autorisée.' });
  }

  let body;
  try {
    body = await readBody(event);
  } catch (e) {
    return json(null, 400, { success: false, error: 'JSON invalide.' });
  }

  const { _subject, Prenom, Contact, Canal, Message, _hp, _t } = body || {};

  const ip = String((event.headers || {})['x-nf-client-connection-ip']
    || (event.headers || {})['x-forwarded-for'] || 'inconnu').split(',')[0].trim();

  // --- Filtres anti-spam, du moins cher au plus cher ---
  if (typeof event.body === 'string' && event.body.length > MAX_BODY) {
    return json(null, 413, { success: false, error: 'Requete trop volumineuse.' });
  }
  // Un honeypot rempli, un remplissage trop rapide ou une origine hors
  // domaine : on repond comme si tout allait bien, sans rien envoyer.
  // Le bot n'a ainsi aucun signal pour apprendre a contourner le filtre.
  const honey = String(_hp || '').trim();
  const elapsed = Number(_t);
  if (honey || !Number.isFinite(elapsed) || elapsed < MIN_FILL_MS || !originAllowed(event)) {
    if (honey) console.warn('Anti-spam : honeypot rempli.');
    else if (!Number.isFinite(elapsed) || elapsed < MIN_FILL_MS) console.warn('Anti-spam : remplissage trop rapide.');
    else console.warn('Anti-spam : origine refusee.');
    return json(null, 200, { success: true });
  }

  if (tooManySends(ip)) {
    return json(null, 429, { success: false, error: 'Trop de demandes. Reessayez plus tard.' });
  }

  if (!Message || !String(Message).trim()) {
    return json(null, 400, { success: false, error: 'Corps de message manquant.' });
  }
  if (!Prenom || !String(Prenom).trim()) {
    return json(null, 400, { success: false, error: 'Prénom manquant.' });
  }
  if (!RESEND_API_KEY) {
    return json(null, 503, { success: false, error: 'Resend non configuré (RESEND_API_KEY manquant).' });
  }
  if (!TO_EMAIL) {
    return json(null, 503, { success: false, error: 'Email de destination manquant (CONTACT_EMAIL/TO_EMAIL).' });
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
    `<div style="border-left:3px solid #ff057d;padding-left:12px;">` +
    String(Message).split('\n').map((l) => `<div style="font-size:14px;line-height:1.55;">${escHtml(l) || '&nbsp;'}</div>`).join('') +
    `</div>`;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: FROM_EMAIL, to: [TO_EMAIL], subject, text, html }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error('Resend error :', JSON.stringify(result));
      return json(null, response.status, { success: false, error: result.message || 'Échec Resend.' });
    }
    return json(null, 200, { success: true, id: result?.id });
  } catch (e) {
    console.error('Erreur fonction contact :', e);
    return json(null, 500, { success: false, error: e.message || 'Erreur serveur.' });
  }
};
