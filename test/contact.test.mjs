/* ------------------------------------------------------------------
   Tests de la fonction Netlify `contact`.

   Ces tests chargent le handler directement, sans reseau : RESEND_API_KEY
   est volontairement vide, donc une requete qui franchit tous les
   filtres s'arrete sur le 503 "non configure". Ce 503 est donc la preuve
   qu'une requete a atteint l'etape Resend.

   node --test test/
------------------------------------------------------------------ */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handler } from '../netlify/functions/contact.mjs';

const OK_ORIGIN = 'https://bellezenetenforme.fr';

let seq = 0;
/* Une IP distincte par requete : chaque test a son propre seau de rate limit. */
function ev({ origin = OK_ORIGIN, body = {}, method = 'POST', raw = null, ip } = {}) {
  return {
    httpMethod: method,
    headers: {
      'content-type': 'application/json',
      'x-nf-client-connection-ip': ip || `10.0.${(++seq >> 8) & 255}.${seq & 255}`,
      ...(origin ? { origin } : {}),
    },
    body: raw !== null ? raw : JSON.stringify(body),
  };
}

const valid = (extra = {}) => ({
  _subject: 'test', Prenom: 'Lea', Contact: 'lea@mail.fr', Canal: 'mail',
  Message: 'Bonjour', _t: 60000, ...extra,
});

const status = async (event) => (await handler(event)).status;
const body = async (event) => await (await handler(event)).json();

/* 503 : la requete a franchi les filtres, elle s'arrete sur l'absence de cle. */
const CONFIGURE = 503;

/* ---------- methode et taille ---------- */

test('refuse les methodes autres que POST', async () => {
  assert.equal(await status(ev({ method: 'GET' })), 405);
  assert.equal(await status(ev({ method: 'PUT' })), 405);
});

test('refuse un body trop volumineux', async () => {
  const raw = JSON.stringify({ x: 'a'.repeat(21000) });
  assert.equal(await status(ev({ raw })), 413);
});

test('refuse un JSON invalide', async () => {
  assert.equal(await status(ev({ raw: '{pas du json' })), 400);
});

/* ---------- anti-spam : rejets silencieux ---------- */

test('honeypot rempli : 200 sans envoi', async () => {
  const r = await handler(ev({ body: valid({ _hp: 'http://spam.example' }) }));
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { success: true });
});

test('honeypot compose d espaces : tolere', async () => {
  // Un champ honeypot saisi par un humain peut contenir des espaces.
  assert.equal(await status(ev({ body: valid({ _hp: '   ' }) })), CONFIGURE);
});

test('remplissage trop rapide : 200 sans envoi', async () => {
  assert.equal(await status(ev({ body: valid({ _t: 100 }) })), 200);
  assert.equal(await status(ev({ body: valid({ _t: 2499 }) })), 200);
});

test('au-dela du seuil de temps : la requete passe', async () => {
  assert.equal(await status(ev({ body: valid({ _t: 2500 }) })), CONFIGURE);
});

test('_t absent ou invalide : 200 sans envoi', async () => {
  assert.equal(await status(ev({ body: valid({ _t: undefined }) })), 200);
  assert.equal(await status(ev({ body: valid({ _t: 'vite' }) })), 200);
  assert.equal(await status(ev({ body: valid({ _t: -5000 }) })), 200);
});

test('origines hors liste : 200 sans envoi', async () => {
  assert.equal(await status(ev({ origin: null, body: valid() })), 200);           // ni Origin ni Referer
  assert.equal(await status(ev({ origin: 'https://evil.example', body: valid() })), 200);
  assert.equal(await status(ev({ origin: 'https://bellezenetenforme.fr.evil.com', body: valid() })), 200);
  assert.equal(await status(ev({ origin: 'pas-une-url', body: valid() })), 200);
});

/* ---------- anti-spam : requetes legitimes ---------- */

test('origines de reference acceptees', async () => {
  assert.equal(await status(ev({ origin: OK_ORIGIN, body: valid() })), CONFIGURE);
  assert.equal(await status(ev({ origin: 'https://www.bellezenetenforme.fr', body: valid() })), CONFIGURE);
  assert.equal(await status(ev({ origin: 'https://deploy-preview-12.netlify.app', body: valid() })), CONFIGURE);
  assert.equal(await status(ev({ origin: 'http://localhost:8888', body: valid() })), CONFIGURE);
});

test('Referer seul suffit quand Origin est absent', async () => {
  const e = ev({ origin: null, body: valid() });
  delete e.headers.origin;
  e.headers.referer = OK_ORIGIN + '/';
  assert.equal(await status(e), CONFIGURE);
});

/* ---------- rate limit ---------- */

test('3 envois par heure et par IP, puis 429', async () => {
  const ip = '10.9.9.9';
  assert.equal(await status(ev({ body: valid(), ip })), CONFIGURE);
  assert.equal(await status(ev({ body: valid(), ip })), CONFIGURE);
  assert.equal(await status(ev({ body: valid(), ip })), CONFIGURE);
  assert.equal(await status(ev({ body: valid(), ip })), 429);
  assert.equal(await status(ev({ body: valid(), ip })), 429);
});

test('le rate limit est par IP', async () => {
  assert.equal(await status(ev({ body: valid(), ip: '10.9.9.9' })), 429);
  assert.equal(await status(ev({ body: valid(), ip: '10.8.8.8' })), CONFIGURE);
});

test('une requete rejetee par un filtre ne consomme pas le quota', async () => {
  const ip = '10.7.7.7';
  // 4 tentatives honeypot : aucune ne doit compter dans le quota
  for (let i = 0; i < 4; i++) await status(ev({ body: valid({ _hp: 'x' }), ip }));
  assert.equal(await status(ev({ body: valid(), ip })), CONFIGURE);
});

/* ---------- validation ---------- */

test('exige un message et un prenom', async () => {
  assert.equal(await status(ev({ body: valid({ Message: '' }) })), 400);
  assert.equal(await status(ev({ body: valid({ Message: '   ' }) })), 400);
  assert.equal(await status(ev({ body: valid({ Prenom: '' }) })), 400);
});

/* ---------- configuration ---------- */

test('signale une cle Resend absente', async () => {
  const b = await body(ev({ body: valid() }));
  assert.match(b.error, /RESEND_API_KEY/);
});

/* ---------- expediteur : le piege onboarding@resend.dev ----------

   FROM_EMAIL est lu au chargement du module, donc on recharge le handler
   avec une autre configuration. Le suffixe de requete suffit a faire
   reevaluer le module par le cache ESM. */

test('sans FROM_EMAIL : 503 explicite, aucun envoi silencieux', async () => {
  process.env.RESEND_API_KEY = 'fake';
  process.env.CONTACT_EMAIL = 'test@example.com';
  delete process.env.FROM_EMAIL;
  const m = await import('../netlify/functions/contact.mjs?from=absent');

  const r = await m.handler(ev({ body: valid() }));
  assert.equal(r.status, 503);
  assert.match((await r.json()).error, /FROM_EMAIL/);
});

test('avec FROM_EMAIL : la requete va bien au bout', async () => {
  process.env.RESEND_API_KEY = 'fake';
  process.env.CONTACT_EMAIL = 'test@example.com';
  process.env.FROM_EMAIL = 'BZF <contact@bellezenetenforme.fr>';
  const m = await import('../netlify/functions/contact.mjs?from=present');

  const r = await m.handler(ev({ body: valid() }));
  // Cle factice : Resend repond 401. L'important est que la requete ne soit
  // pas bloquee par la configuration, et surtout pas par un repli silencieux.
  assert.notEqual(r.status, 503);
  assert.doesNotMatch(await r.text(), /FROM_EMAIL manquant/);
});

test('le code ne doit pas retomber sur onboarding@resend.dev', async () => {
  // Ce domaine de test ne livre qu'a l'adresse du compte Resend : avec lui,
  // l'API repond 200, le site affiche "envoye", et le message n'arrive
  // jamais. Le test echoue si quelqu'un remet ce repli.
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../netlify/functions/contact.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /FROM_EMAIL\s*\|\|\s*'[^']*resend\.dev'/);
});