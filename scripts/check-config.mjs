/* ------------------------------------------------------------------
   Verification de la configuration avant deploiement.

   Le piege principal est onboarding@resend.dev : c'est le seul
   expediteur qui fonctionne sans domaine valide, et Resend ne livre
   alors qu'a l'adresse du compte Resend. L'API repond 200, le site
   affiche "envoye", et le message n'arrive jamais. Ce script detecte ce
   cas avant qu'il ne coute un lead.

   node scripts/check-config.mjs
------------------------------------------------------------------ */

import { readFileSync } from 'node:fs';

/* Les variables sont lues dans l'environnement, et en repli dans .env
   pour que le controle soit utile en local aussi. */
function loadDotEnv() {
  try {
    for (const line of readFileSync('.env', 'utf8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i < 0) continue;
      const k = t.slice(0, i).trim();
      if (process.env[k] === undefined) process.env[k] = t.slice(i + 1).trim();
    }
  } catch { /* pas de .env : on ne verifie que l'environnement */ }
}
loadDotEnv();

const TEST_SENDER = /onboarding@resend\.dev|@resend\.dev/;
const checks = [];
const add = (ok, label, detail) => checks.push({ ok, label, detail });

/* ---------- 1. Variables de la fonction ---------- */

const key = process.env.RESEND_API_KEY;
add(!!key, 'RESEND_API_KEY definie', key ? 'presente' : 'MANQUANTE : la fonction repond 503');

const to = process.env.CONTACT_EMAIL || process.env.TO_EMAIL;
add(!!to, 'CONTACT_EMAIL definie', to || 'MANQUANTE : la fonction repond 503');

const from = process.env.FROM_EMAIL;
if (!from) {
  add(false, 'FROM_EMAIL definie', 'MANQUANTE : la fonction repond 503 et n\'envoie rien');
} else if (TEST_SENDER.test(from)) {
  add(false, 'FROM_EMAIL exploitable',
    `"${from}" est le domaine de TEST de Resend : il ne livre qu'a l'adresse du compte`
    + ' Resend. Valide ton domaine sur resend.com/domains, sinon chaque lead est perdu.');
} else {
  add(true, 'FROM_EMAIL exploitable', from);
}

/* ---------- 2. Coherence avec le front ---------- */

const src = readFileSync('src/index.html', 'utf8');
const inPage = (src.match(/const CONTACT_EMAIL\s*=\s*"([^"]*)"/) || [, ''])[1].trim();
if (!inPage) {
  add(false, 'CONTACT_EMAIL du front', 'VIDE dans src/index.html');
} else if (to && inPage !== to) {
  add(false, 'CONTACT_EMAIL du front',
    `divergent : front="${inPage}" mais variable="${to}". Le site enverrait les leads`
    + " a une adresse differente de celle du lien mailto.");
} else {
  add(true, 'CONTACT_EMAIL du front', inPage);
}

/* ---------- 3. Liens de vente ---------- */

for (const name of ['CONTACT_LINK', 'PROMO_LINK', 'TEAM_LINK']) {
  const m = new RegExp('const ' + name + '\\s*=\\s*"([^"]*)"').exec(src);
  const v = m ? m[1].trim() : '';
  add(!!v && v !== '#', `${name} renseigne`,
    v && v !== '#' ? v : 'encore a "#" : ce bouton ne mene nulle part');
}
const promo = (src.match(/const PROMO_CODE\s*=\s*"([^"]*)"/) || [, ''])[1].trim();
add(!!promo, 'PROMO_CODE renseigne', promo || 'vide : le bloc de code promo est masque');

const sponsor = (src.match(/const SPONSOR_ID\s*=\s*"([^"]*)"/) || [, ''])[1].trim();
add(!!sponsor, 'SPONSOR_ID renseigne', sponsor || 'vide : tes liens FitLine n\'auront pas de parametre sponsor');

/* ---------- rapport ---------- */

const width = Math.max(...checks.map((c) => c.label.length));
let hard = 0, soft = 0;

console.log('\nConfiguration BZF\n' + '='.repeat(64));
for (const c of checks) {
  console.log(`  ${c.ok ? 'OK  ' : 'ATTENTION'}  ${c.label.padEnd(width)}   ${c.detail}`);
  c.ok ? hard++ : soft++;
}
console.log('='.repeat(64));

if (soft) {
  console.log(`\n${soft} point(s) a regler.`);
  const bloquants = checks.filter((c) => !c.ok && /^RESEND_API_KEY|^CONTACT_EMAIL|^FROM_EMAIL/.test(c.label));
  if (bloquants.length) {
    console.log('Ceux-la empechent les emails d\'arriver. Les autres n\'empechent pas le site de\nfonctionner : le formulaire de contact, lui, reste operationnel.\n');
    process.exit(1);
  }
  console.log('Aucun envoi email ne sera casse. Le site reste deployable.\n');
} else {
  console.log('\nTout est configure.\n');
}