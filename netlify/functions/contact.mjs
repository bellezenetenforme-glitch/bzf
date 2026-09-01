import { Resend } from 'resend';

/* ------------------------------------------------------------------
   Netlify Function — reçoit les réponses du questionnaire BZF
   et les envoie par email via l'API Resend.
   Endpoint déployé : /.netlify/functions/contact
   Config : voir variables d'environnement dans netlify.toml / le dashboard.
------------------------------------------------------------------ */

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const TO_EMAIL = process.env.TO_EMAIL || process.env.CONTACT_EMAIL || '';
const FROM_EMAIL = process.env.FROM_EMAIL || 'BZF <onboarding@resend.dev>';

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

  const { _subject, Prenom, Contact, Canal, Message } = body || {};

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
    const resend = new Resend(RESEND_API_KEY);
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: [TO_EMAIL],
      subject,
      text,
      html,
    });
    if (error) {
      console.error('Resend error :', error);
      return json(null, 502, { success: false, error: error.message || 'Échec Resend.' });
    }
    return json(null, 200, { success: true, id: data?.id });
  } catch (e) {
    console.error('Erreur fonction contact :', e);
    return json(null, 500, { success: false, error: e.message || 'Erreur serveur.' });
  }
};
