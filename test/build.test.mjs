/* ------------------------------------------------------------------
   Tests du HTML genere par build.mjs.

   Ils tournent contre un build existant : lance `npm run build` avant
   `npm test`, ou utilise `npm run verify` qui enchaine les deux.

   Point d'attention : ces tests verifient des *comptages minimum*. Un
   controle du style « aucune reference cassee » passerait a vide si la
   funcionalidad disparaissait completement — c'est deja arrive pendant le
   developpement, un `git checkout` ayant annule une correction. On compte
   donc ce qui doit etre la.

   node --test test/
------------------------------------------------------------------ */

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, relative } from 'node:path';
import { SITE_ORIGIN } from '../src/site.config.mjs';

const ORIGIN_RE = SITE_ORIGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const DIST = new URL('../dist/', import.meta.url);
let built = false;

before(() => {
  // On construit si besoin : les tests doivent toujours porter sur un dist
  // correspondant au source courant, sinon ils verifient un vieux build.
  if (!existsSync(new URL('index.html', DIST))) {
    execFileSync('node', ['build.mjs'], { cwd: new URL('..', import.meta.url).pathname });
  }
  built = true;
});

const page = (rel) => readFileSync(new URL(rel, DIST), 'utf8');

test('le build a produit les 3 pages', () => {
  assert.ok(built);
  for (const f of ['index.html', 'en/index.html', 'es/index.html']) {
    assert.ok(existsSync(new URL(f, DIST)), `${f} manquant — lance npm run build`);
  }
});

test('chaque page a un head localise et unique', () => {
  const seen = new Set();
  const titles = [];
  for (const [rel, lang] of [['index.html', 'fr'], ['en/index.html', 'en'], ['es/index.html', 'es']]) {
    const p = page(rel);
    assert.match(p, new RegExp(`<html lang="${lang}">`), `${rel} : <html lang> incorrect`);
    // Le terme cible doit etre present dans les trois langues : c'est la
    // garantie qu'on cherche, pas un mot de marque fige dans un test.
    const keyword = { fr: 'nutrition', en: 'nutrition', es: 'nutrición' }[lang];
    const title = /<title>([^<]*)<\/title>/.exec(p)[1];
    const desc = /<meta name="description" content="([^"]*)"/.exec(p)[1];
    assert.match(title.toLowerCase(), new RegExp(keyword), `${rel} : "${keyword}" absent du titre`);
    assert.match(desc.toLowerCase(), new RegExp(keyword), `${rel} : "${keyword}" absent de la description`);
    titles.push(title);
    assert.match(p, new RegExp(`__BZF_LANG__="${lang}"`));
    const canonical = /rel="canonical" href="([^"]+)"/.exec(p)[1];
    assert.equal(canonical, SITE_ORIGIN + (lang === 'fr' ? '/' : `/${lang}/`),
      `${rel} : canonical ${canonical} au lieu de ${SITE_ORIGIN}`);
    seen.add(canonical);
  }
  assert.equal(seen.size, 3, 'les 3 canonical doivent differer');
  assert.equal(new Set(titles).size, 3, 'les 3 titres doivent differer');
});

test('les hreflang sont reciproques sur les 3 pages', () => {
  for (const rel of ['index.html', 'en/index.html', 'es/index.html']) {
    const p = page(rel);
    for (const l of ['fr', 'en', 'es']) {
      const attendu = SITE_ORIGIN + (l === 'fr' ? '/' : `/${l}/`);
      assert.ok(p.includes(`hreflang="${l}" href="${attendu}"`),
        `${rel} : hreflang ${l} ne pointe pas sur ${attendu}`);
    }
    assert.match(p, /hreflang="x-default"/, `${rel} : x-default manquant`);
  }
});

test('les chemins d images se resolvent depuis chaque page', () => {
  for (const rel of ['index.html', 'en/index.html', 'es/index.html']) {
    const p = page(rel);
    const dir = resolve('dist', rel.replace(/index\.html$/, ''));
    // Quatre formes de reference coexistent : attributs src/href, url() CSS,
    // valeurs de SECBG et chaines JS des produits. En scanner une seule, on
    // ne verrait que les 6 images du hero, des logos et de l'avatar.
    const refs = new Set([
      ...[...p.matchAll(/(?:src|href)=["']([^"']+\.(?:webp|png|jpe?g))["']/g)].map((m) => m[1]),
      ...[...p.matchAll(/url\(['"]?([^'")]*\.(?:webp|png|jpe?g))/g)].map((m) => m[1]),
      ...[...p.matchAll(/"[^"]+"\s*:\s*"([^"]+\.(?:webp|png|jpe?g))"/g)].map((m) => m[1]),
      ...[...p.matchAll(/\bimg\s*:\s*"([^"]+\.(?:webp|png|jpe?g))"/g)].map((m) => m[1]),
    ]);
    assert.ok(refs.size >= 25, `${rel} : seulement ${refs.size} image(s) referencee(s), 25 attendues`);
    for (const ref of refs) {
      if (/favicon\.png$/.test(ref)) continue;
      assert.ok(existsSync(resolve(dir, ref)), `${rel} : ${ref} ne resout pas`);
    }
  }
});

test('aucune image raster ne reste en base64', () => {
  for (const rel of ['index.html', 'en/index.html', 'es/index.html']) {
    assert.doesNotMatch(page(rel), /data:image\/(webp|png|jpe?g);base64/, `${rel} : base64 subsiste`);
  }
});

test('le hero est precharge et prioritaire, les autres sont paresseuses', () => {
  const p = page('index.html');
  assert.match(p, /<link rel="preload" as="image" href="img\/[^"]+\.webp" fetchpriority="high">/);
  assert.match(p, /<img id="heroImg"[^>]*loading="eager"[^>]*fetchpriority="high"/);
  const lazy = (p.match(/loading="lazy"/g) || []).length;
  assert.ok(lazy >= 2, `seulement ${lazy} image(s) en loading=lazy`);
});

/* ---------- accessibilite du formulaire ---------- */

test('chaque label pointe vers un champ existant', () => {
  for (const rel of ['index.html', 'en/index.html', 'es/index.html']) {
    const p = page(rel);
    const ids = new Set([...p.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
    const fors = [...p.matchAll(/<label for="([^"]+)"/g)].map((m) => m[1]);

    // Comptage minimum : sans cela le test passerait a vide si les labels
    // perdaient leur attribut for.
    assert.ok(fors.length >= 11, `${rel} : seulement ${fors.length} label(s) associe(s), 11 attendus`);

    for (const f of fors) {
      assert.ok(ids.has(f), `${rel} : label for="${f}" ne pointe vers aucun id`);
      // un div de chips n'est pas un element labelable : il faut aria, pas for
      const tag = new RegExp(`id="${f}"[^>]*`).exec(p)[0];
      assert.doesNotMatch(tag, /class="chips/, `${rel} : for pointe vers un div de chips`);
    }
    for (const m of p.matchAll(/aria-labelledby="([^"]+)"/g)) {
      assert.ok(ids.has(m[1]), `${rel} : aria-labelledby="${m[1]}" orphelin`);
    }
  }
});

test('les 3 groupes de chips sont nommes', () => {
  const p = page('index.html');
  const groups = (p.match(/role="group" aria-labelledby=/g) || []).length;
  assert.equal(groups, 3, `${groups} groupe(s) de chips nomme(s), 3 attendus`);
});

/* ---------- SEO ---------- */

test('les textes SEO respectent les limites de Google', () => {
  for (const rel of ['index.html', 'en/index.html', 'es/index.html']) {
    const p = page(rel);
    const title = /<title>([^<]*)<\/title>/.exec(p)[1];
    const desc = /<meta name="description" content="([^"]*)"/.exec(p)[1];
    assert.ok(title.length <= 65, `titre trop long : ${title.length}`);
    assert.ok(desc.length <= 160, `description trop longue : ${desc.length}`);
  }
});

test('le francais porte ses accents', () => {
  const p = page('index.html');
  const title = /<title>([^<]*)<\/title>/.exec(p)[1];
  const desc = /<meta name="description" content="([^"]*)"/.exec(p)[1];
  assert.match(title + desc, /[éèêàçù]/, 'aucun accent dans les textes SEO francais');
});

test('les cartes de partage existent', () => {
  for (const f of ['og-fr.png', 'og-en.png', 'og-es.png', 'favicon.png', 'robots.txt', 'sitemap.xml']) {
    assert.ok(existsSync(new URL(f, DIST)), `${f} manquant`);
  }
});

test('le terme cible et la ville sont dans les trois langues', () => {
  const KEYWORD = { fr: 'nutrition', en: 'nutrition', es: 'nutrición' };
  const CITY = { fr: 'Tours', en: 'Tours', es: 'Tours' };
  for (const [rel, lang] of [['index.html', 'fr'], ['en/index.html', 'en'], ['es/index.html', 'es']]) {
    const p = page(rel);
    const title = /<title>([^<]*)<\/title>/.exec(p)[1];
    const desc = /<meta name="description" content="([^"]*)"/.exec(p)[1];
    const blob = (title + ' ' + desc).toLowerCase();
    assert.match(blob, new RegExp(KEYWORD[lang]), `${rel} : terme cible absent`);
    assert.match(blob, new RegExp(CITY[lang].toLowerCase()), `${rel} : ville absente`);
    // Le titre est le signal local le plus fort : la ville doit y etre aussi,
    // pas seulement dans la description.
    assert.match(title.toLowerCase(), new RegExp(CITY[lang].toLowerCase()), `${rel} : ville absente du titre`);
  }
});

test('donnees structurelees valides et locales', () => {
  for (const rel of ['index.html', 'en/index.html', 'es/index.html']) {
    const p = page(rel);
    const m = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(p);
    assert.ok(m, `${rel} : JSON-LD absent`);

    let data;
    try { data = JSON.parse(m[1]); }
    catch (e) { assert.fail(`${rel} : JSON-LD invalide — ${e.message}`); }

    assert.equal(data['@context'], 'https://schema.org');
    assert.equal(data['@type'], 'HealthAndBeautyBusiness');
    const served = data.areaServed.map((a) => a.name);
    assert.ok(served.includes('Tours'), `${rel} : Tours absent de areaServed`);
    assert.ok(served.includes('Indre-et-Loire'), `${rel} : Indre-et-Loire absent de areaServed`);

    // On ne declare pas d'adresse : c'est un site vitrine sans local.
    assert.equal(data.address, undefined, `${rel} : adresse declaree alors qu'il n'y en a pas`);
    // Les URL publiques doivent correspondre au canonical de la page.
    const canonical = /rel="canonical" href="([^"]+)"/.exec(p)[1];
    assert.equal(data.url, canonical, `${rel} : url JSON-LD != canonical`);
    assert.ok(data.sameAs.length >= 2, `${rel} : profils sociaux manquants`);
  }
});

test('les ancres des constantes pointent vers un element qui existe', () => {
  // Une ancre vers un id inexistant est un lien mort silencieux : la page
  // ne bouge pas. Les sections produits (id:"energie"...) ne sont creees que
  // par renderNeeds(), donc on verifie aussi le dictionnaire CATEGORIES, pas
  // seulement le HTML statique.
  const src = readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');
  const const_ = (n) => {
    const m = new RegExp('const ' + n + '\\s*=\\s*"([^"]*)"').exec(src);
    return m ? m[1] : '';
  };

  const statique = new Set(
    [...readFileSync(new URL('index.html', DIST), 'utf8').matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const dynamique = new Set(
    [...src.matchAll(/\bid:"([a-z0-9]+)"/g)].map((m) => m[1]));
  const connus = new Set([...statique, ...dynamique]);

  for (const nom of ['CONTACT_LINK', 'TEAM_LINK']) {
    const v = const_(nom);
    assert.ok(v && v !== '#', `${nom} encore a "#"`);
    assert.match(v, /^#[a-z0-9-]+$/, `${nom} n'est pas une ancre interne : ${v}`);
    const cible = v.slice(1);
    assert.ok(connus.has(cible), `${nom} pointe vers #${cible}, qui n'existe pas`);
  }
});

test('le bouton Team est pilote par TEAM_LINK', () => {
  const p = page('index.html');
  assert.match(p, /id="teamLink"/, "le bouton Team n'a pas d'id, TEAM_LINK ne peut pas le piloter");
  // L'ancre est aussi posee en dur : si TEAM_LINK etait invalide, le bouton
  // resterait fonctionnel, ce qui masque la regression.
  assert.match(p, /id="teamLink"[^>]*href="#team"/);
});

test('un lien vers une ancre interne n\'ouvre pas un nouvel onglet', () => {
  const p = page('index.html');
  const a = /<a[^>]*class="[^"]*contact-link[^"]*"[^>]*>/.exec(p);
  assert.ok(a, 'lien contact-link introuvable');
  assert.doesNotMatch(a[0], /target="_blank"/,
    'target="_blank" sur une ancre interne : le site s\'ouvre dans un nouvel onglet');
  // et le HTML doit rester bien forme : les attributs ne doivent pas avoir
  // ete concatenes en retirant l'espace qui les separait
  assert.match(a[0], /contact-link" data-i18n=/, 'espaces d\'attribut abimes');
});

test('les liens externes gardent target et rel', () => {
  const p = page('index.html');
  for (const id of ['igLink', 'fbLink', 'msLink']) {
    const a = new RegExp(`<a[^>]*id="${id}"[^>]*>`).exec(p);
    assert.ok(a, `${id} introuvable`);
    assert.match(a[0], /target="_blank"/, `${id} : target="_blank" manquant`);
    assert.match(a[0], /rel="noopener"/, `${id} : rel="noopener" manquant`);
  }
});

test('les listes de choix sont identiques en nombre dans les 3 langues', () => {
  // Une option retiree ou ajoutee dans une seule langue produirait un
  // questionnaire qui ne pose pas la meme question selon la page.
  const LISTS = ['sport_opts', 'diet_opts', 'supp_opts', 'budget_opts', 'channel_opts'];
  const counts = {};
  for (const rel of ['index.html', 'en/index.html', 'es/index.html']) {
    const p = page(rel);
    counts[rel] = {};
    for (const key of LISTS) {
      const m = new RegExp(`data-i18n-opts="${key}">([\\s\\S]*?)</select>`).exec(p);
      assert.ok(m, `${rel} : ${key} introuvable`);
      counts[rel][key] = (m[1].match(/<option>/g) || []).length;
    }
  }
  for (const key of LISTS) {
    const vals = Object.values(counts).map((c) => c[key]);
    assert.equal(new Set(vals).size, 1,
      `${key} : ${vals.join('/')} options selon la langue — le questionnaire ne pose pas la meme question`);
  }
});

test('le canal de contact ne propose plus Email', () => {
  for (const rel of ['index.html', 'en/index.html', 'es/index.html']) {
    const p = page(rel);
    const m = /data-i18n-opts="channel_opts">([\s\S]*?)<\/select>/.exec(p);
    assert.doesNotMatch(m[1], /Email/i, `${rel} : l'option Email est toujours proposee`);
  }
});

test('aucune liste de choix n\'impose une reponse', () => {
  // Sans option vide en tete, le navigateur selectionne la premiere reponse
  // et chaque lead se voit attribuer une reponse qu\'il n\'a pas donnee.
  for (const rel of ['index.html', 'en/index.html', 'es/index.html']) {
    const p = page(rel);
    const sels = [...p.matchAll(/<select[^>]*data-i18n-opts="[a-z_]+"[^>]*>([\s\S]*?)<\/select>/g)];
    assert.equal(sels.length, 5, `${rel} : ${sels.length} liste(s) de choix, 5 attendues`);
    for (const [, inner] of sels) {
      const first = /<option[^>]*>/.exec(inner)[0];
      assert.match(first, /value=""/, `${rel} : la premiere option n\'est pas vide (${first})`);
      assert.equal((inner.match(/<option/g) || []).length > 1, true,
        `${rel} : liste vide de vraies options`);
    }
  }
});

test('le runtime reconstruit aussi l\'option vide', () => {
  // Si setLang() ne la recreait pas, elle disparaitrait apres le changement
  // de langue et le navigateur re-selectionnerait la premiere reponse.
  const src = readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');
  const at = src.indexOf("querySelectorAll('[data-i18n-opts]')");
  assert.notEqual(at, -1, "gestion des data-i18n-opts introuvable dans setLang()");
  // On lit la fenetre qui suit : la construction peut tenir sur plusieurs
  // lignes, commentaires compris.
  const fenetre = src.slice(at, at + 500);
  assert.match(fenetre, /<option value="">/, "setLang() ne prevoit pas d'option vide");
});

test('le lien boutique du footer est resolu dans le HTML', () => {
  // Sans resolution au build, le lien serait visible mais pointerait vers "#" :
  // il ne fonctionnerait que si le JavaScript s'execute.
  const src = readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');
  const expected = (src.match(/const PROMO_LINK\s*=\s*"([^"]*)"/) || [, ''])[1];
  assert.ok(expected && expected !== '#', 'PROMO_LINK non renseigne');
  for (const rel of ['index.html', 'en/index.html', 'es/index.html']) {
    const a = /<a [^>]*id="promoShop"[^>]*>/.exec(page(rel));
    assert.ok(a, `${rel} : lien boutique absent`);
    assert.ok(a[0].includes(`href="${expected}"`), `${rel} : href non resolu`);
    assert.match(a[0], /target="_blank"/, `${rel} : un lien externe doit ouvrir un onglet`);
    assert.match(a[0], /rel="noopener"/, `${rel} : rel="noopener" manquant`);
  }
});

test('plus aucune trace de l ancien code promo', () => {
  const src = readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /PROMO_CODE/, 'PROMO_CODE n existe plus');
  assert.doesNotMatch(src, /promoCode2/, 'promoCode2 n existe plus');
  assert.doesNotMatch(src, /footer_promo/, 'footer_promo n existe plus');
});

test('sitemap et robots pointent vers le bon domaine', () => {
  assert.ok(page('sitemap.xml').includes(`<loc>${SITE_ORIGIN}/</loc>`),
    "sitemap : l'URL du site ne correspond pas a SITE_ORIGIN");
  assert.ok(page('robots.txt').includes(`Sitemap: ${SITE_ORIGIN}/sitemap.xml`),
    "robots.txt : l'URL du site ne correspond pas a SITE_ORIGIN");
});
/* ---------- diagnostic de l'ecran d'erreur ----------

   L'ecran d'erreur affiche « Oups, un probleme technique » quel que soit
   l'echec : un 502 de Netlify et un 403 de Resend produisent le meme
   ecran. C'est ce qui a rendu une panne reelle impossible a diagnostiquer
   depuis le site. Le motif exact est donc affiche dans un <details> replie,
   visible par la mainteneuse mais invisible pour la visiteuse. */

test('l ecran d erreur porte un bloc de diagnostic replie', () => {
  for (const rel of ['index.html', 'en/index.html', 'es/index.html']) {
    const p = page(rel);
    assert.match(p, /id="errDiag"/, `${rel} : bloc de diagnostic absent`);
    assert.match(p, /<details[^>]*id="errDiag"/, `${rel} : le diagnostic doit etre un <details>`);
    // Replie par defaut : sans cet attribut, la visiteuse voit du francais
    // technique et l'ecartement de la configuration du compte est public.
    assert.match(p, /<details(?![^>]*\sopen)[^>]*id="errDiag"/,
      `${rel} : le <details> doit etre replie`);
    assert.match(p, /data-i18n="err_details"/, `${rel} : intitule du diagnostic non traduit`);
  }
});

test('chaque langue traduit l intitule du diagnostic', () => {
  const src = readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');
  const labels = { fr: 'Détails techniques', en: 'Technical details', es: 'Detalles técnicos' };
  for (const [lang, label] of Object.entries(labels)) {
    const m = new RegExp(`err_details:"${label}"`).exec(src);
    assert.ok(m, `err_details absent ou incorrect en ${lang} ("${label}")`);
  }
});

test('sendToSteff distingue les echecs au lieu de tout reducing a false', () => {
  const src = readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');
  // Un simple `return false` recreerait exactement l'ecrasement qu'on
  // cherche a supprimer : tous les motifs redevenant indistinguables.
  assert.doesNotMatch(src, /if\(\s*!\s*r\.ok\s*\)\s*return false/,
    'sendToSteff reduit encore tous les echecs HTTP a false');
  // Les raisons doivent etre couvertes, pas seulement le cas nominal.
  for (const reason of ['offline', 'rate', 'server', 'config', 'rejected']) {
    assert.match(src, new RegExp(`'${reason}'|\\b${reason}\\b`),
      `raison "${reason}" jamais produite`);
  }
});
