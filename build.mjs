/* ------------------------------------------------------------------
   Generateur de build BZF.

   Le site est en une seule page traduite en JS a l'execution. Ce script
   produit une VRAIE page par langue, pour que les moteurs de recherche
   voient le texte et que les scrapers sociaux (WhatsApp, Instagram,
   Facebook) qui n'executent pas de JS aient un contenu a afficher.

   Sortie :
     dist/index.html        fr
     dist/en/index.html     en
     dist/es/index.html     es
     dist/og-fr.png         carte de partage, une par langue
     dist/favicon.png       logo extrait des variables CSS de la source
     dist/sitemap.xml
     dist/robots.txt

   Ce que le script ne fait PAS : prerendre renderQuiz() et renderNeeds().
   Ces deux fonctions genèrent leurs cartes a partir de CATEGORIES, qui
   embarque 609 Ko d'images en base64. Les prerendre triplerait ce poids
   dans le HTML genere. Elles continuent de tourner cote client ; Google
   execute le JS, donc l'indexation n'en souffre pas.
------------------------------------------------------------------ */

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';

const SRC = 'src/index.html';
const OUT = 'dist';
const FONT_DIR = 'src/fonts';
const ORIGIN = 'https://bellezenetenforme.fr';

const LANGS = ['fr', 'en', 'es'];
const ROUTE = { fr: '/', en: '/en/', es: '/es/' };
const OG_LOCALE = { fr: 'fr_FR', en: 'en_GB', es: 'es_ES' };

// Metadonnees de la carte de partage. Le titre est volontairement different
// de celui du site : sur un partage il doit capter l'attention, pas decrire
// la navigation du site.
const OG = {
  fr: { title: 'Belle, zen\net en forme', sub: 'Conseil personnalise FitLine par Steff, partenaire independante.', kicker: 'BZF' },
  en: { title: 'Beautiful, calm\nand in shape', sub: 'Personalised FitLine advice from Steff, independent partner.', kicker: 'BZF' },
  es: { title: 'Bella, zen\ny en forma', sub: 'Consejo personalizado de FitLine con Steff, partner independiente.', kicker: 'BZF' },
};

// Titres et descriptions par langue, pour la recherche et les liens.
const SEO = {
  fr: {
    title: 'BZF — Belle, zen et en forme | Conseil FitLine personnalise',
    desc: 'Steff, partenaire independante FitLine, te conseille et te compose une routine de produits adapted a ton objectif : energie, sommeil, glow ou forme. Remplis le questionnaire en 2 minutes.',
  },
  en: {
    title: 'BZF — Beautiful, calm and in shape | Personalised FitLine advice',
    desc: 'Steff, an independent FitLine partner, builds a routine matched to your goal: energy, sleep, glow or shape. Fill in the 2-minute questionnaire.',
  },
  es: {
    title: 'BZF — Bella, zen y en forma | Consejo personalizado FitLine',
    desc: 'Steff, partner independiente de FitLine, te recomienda una rutina segun tu objetivo: energia, sueno, glow o figura. Rellena el cuestionario en 2 minutos.',
  },
};

/* ---------- utilitaires ---------- */

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/* Extrait le dictionnaire T de la source. Le comptage des accolades ignore
   le contenu des chaines, sinon une accolade dans un texte le ferait
   partir trop tot et on afficherait du code dans le HTML. */
function extractDictionary(src) {
  const at = src.indexOf('const T = {');
  if (at < 0) throw new Error("Dictionnaire `const T = {` introuvable dans " + SRC);
  const start = src.indexOf('{', at);
  let depth = 0, quote = null;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error('Accolades non equilibrees dans le dictionnaire T');
}

const t = (dict, lang, key) => (dict[lang] && dict[lang][key] != null ? dict[lang][key] : null);

/* ---------- prerendu du texte statique ---------- */

/* Les substitutions se font sur la chaine HTML, sans DOM ni dependance.
   Les motifs du site sont simples : un attribut data-i18n* par element,
   pas d'imbrication du meme tag. Les assertions plus bas verifient
   qu'il ne reste aucun element vide. */
function bakeText(html, dict, lang) {
  const missing = [];

  // <p data-i18n="cle"></p>  ->  <p data-i18n="cle">texte</p>
  html = html.replace(
    /<([a-z0-9]+)\b([^>]*?)\bdata-i18n="([a-z0-9_]+)"([^>]*)>([\s\S]*?)<\/\1>/gi,
    (m, tag, a, key, b, inner) => {
      const v = t(dict, lang, key);
      if (v == null) { missing.push(key); return m; }
      return `<${tag}${a}data-i18n="${key}"${b}>${esc(v)}</${tag}>`;
    },
  );

  // <p data-i18n-html="cle"></p>  ->  HTML autorise (la source contient des <br>)
  html = html.replace(
    /<([a-z0-9]+)\b([^>]*?)\bdata-i18n-html="([a-z0-9_]+)"([^>]*)>([\s\S]*?)<\/\1>/gi,
    (m, tag, a, key, b) => {
      const v = t(dict, lang, key);
      if (v == null) { missing.push(key); return m; }
      return `<${tag}${a}data-i18n-html="${key}"${b}>${v}</${tag}>`;
    },
  );

  // <input data-i18n-ph="cle">  ->  placeholder injecte ou remplace
  html = html.replace(
    /<(input|textarea)\b([^>]*?)\bdata-i18n-ph="([a-z0-9_]+)"([^>]*)>/gi,
    (m, tag, a, key, b) => {
      const v = t(dict, lang, key);
      if (v == null) { missing.push(key); return m; }
      const attrs = b.replace(/\s+placeholder="[^"]*"/gi, '');
      return `<${tag}${a}data-i18n-ph="${key}"${attrs} placeholder="${esc(v)}">`;
    },
  );

  // <select data-i18n-opts="cle"></select>  ->  options
  html = html.replace(
    /<select\b([^>]*?)\bdata-i18n-opts="([a-z0-9_]+)"([^>]*)>([\s\S]*?)<\/select>/gi,
    (m, a, key, b) => {
      const v = t(dict, lang, key);
      if (!Array.isArray(v)) { missing.push(key); return m; }
      return `<select${a}data-i18n-opts="${key}"${b}>${v.map((o) => `<option>${esc(o)}</option>`).join('')}</select>`;
    },
  );

  // <div data-i18n-chips="cle"></div>  ->  chips
  html = html.replace(
    /<div\b([^>]*?)\bdata-i18n-chips="([a-z0-9_]+)"([^>]*)>([\s\S]*?)<\/div>/gi,
    (m, a, key, b) => {
      const v = t(dict, lang, key);
      if (!Array.isArray(v)) { missing.push(key); return m; }
      return `<div${a}data-i18n-chips="${key}"${b}>${v.map((o) => `<span class="chip">${esc(o)}</span>`).join('')}</div>`;
    },
  );

  return { html, missing };
}

/* ---------- head ---------- */

function buildHead(lang) {
  const url = ORIGIN + ROUTE[lang];
  const img = `${ORIGIN}/og-${lang}.png`;
  const alt = dict_title(lang);
  const lines = [
    `<title>${esc(SEO[lang].title)}</title>`,
    `<meta name="description" content="${esc(SEO[lang].desc)}">`,
    `<link rel="canonical" href="${url}">`,
    `<link rel="icon" href="favicon.png" type="image/png">`,
    `<link rel="apple-touch-icon" href="favicon.png">`,
  ];
  for (const l of LANGS) {
    lines.push(`<link rel="alternate" hreflang="${l}" href="${ORIGIN + ROUTE[l]}">`);
  }
  lines.push(`<link rel="alternate" hreflang="x-default" href="${ORIGIN}/">`);
  lines.push(
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="BZF">`,
    `<meta property="og:locale" content="${OG_LOCALE[lang]}">`,
    `<meta property="og:title" content="${esc(SEO[lang].title)}">`,
    `<meta property="og:description" content="${esc(SEO[lang].desc)}">`,
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:image" content="${img}">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta property="og:image:type" content="image/png">`,
    `<meta property="og:image:alt" content="${esc(alt)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(SEO[lang].title)}">`,
    `<meta name="twitter:description" content="${esc(SEO[lang].desc)}">`,
    `<meta name="twitter:image" content="${img}">`,
    // La langue de la page est injectee ici : detectLang() la privilegie
    // a localStorage, sinon un visiteur FR arrivant sur /en/ se verrait
    // rebascule en francais et les hreflang pointeraient vers du francais.
    `<script>window.__BZF_LANG__=${JSON.stringify(lang)};</script>`,
  );
  return lines.join('\n');
}

function dict_title(lang) {
  return `BZF ${OG[lang].title.replace(/\n/g, ', ')}`;
}

/* ---------- carte de partage ---------- */

function buildOg(lang, logoDataUri) {
  const tpl = readFileSync('src/og.svg', 'utf8');

  // Chaque bloc est remplace par un regex global : une substitution par
  // chaine ne remplacerait que la premiere occurrence.
  // Le logo passe par xlink:href, forme SVG 1.1 que resvg comprend.
  let svg = tpl.replace(/__LOGO__/g, logoDataUri);

  // Grille verticale calculee depuis le bas : le titre peut tenir sur
  // plusieurs lignes, on ancre sa derniere ligne et on remonte.
  const TITLE_LINE_H = 100;
  const TITLE_LAST_Y = 462;
  const SUB_Y = 526;
  const KICKER_Y = 570;
  const LEFT = 80;

  const lines = esc(OG[lang].title).split('\n');
  const tspans = lines
    .map((l, i) => `<tspan x="${LEFT}" y="${TITLE_LAST_Y - (lines.length - 1 - i) * TITLE_LINE_H}">${l}</tspan>`)
    .join('');

  svg = svg
    .replace(/(<text[^>]*data-og="title"[^>]*>)[\s\S]*?(<\/text>)/, (m, o, c) => o + tspans + c)
    .replace(/(<text)([^>]*data-og="sub"[^>]*>)/, (m, a, rest) => `<text x="${LEFT}" y="${SUB_Y}"${rest}`)
    .replace(/(<text[^>]*data-og="sub"[^>]*>)[\s\S]*?(<\/text>)/, (m, o, c) => o + esc(OG[lang].sub) + c)
    .replace(/(<text)([^>]*data-og="kicker"[^>]*>)/, (m, a, rest) => `<text x="${LEFT}" y="${KICKER_Y}"${rest}`)
    .replace(/(<text[^>]*data-og="kicker"[^>]*>)[\s\S]*?(<\/text>)/, (m, o, c) => o + esc(OG[lang].kicker) + c);

  for (const marker of ['__LOGO__', '__TITLE__', '__SUB__', '__KICKER__']) {
    if (svg.includes(marker)) throw new Error(`Jeton ${marker} non substitue dans la carte OG ${lang}`);
  }

  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: 1200 },
    font: {
      fontFiles: readdirSync(FONT_DIR).filter((f) => f.endsWith('.ttf')).map((f) => join(FONT_DIR, f)),
      loadSystemFonts: false,
      defaultFontFamily: 'Inter',
    },
  });
  return resvg.render().asPng();
}

/* ---------- build ---------- */

const src = readFileSync(SRC, 'utf8');
const dict = runInNewContext('(' + extractDictionary(src) + ')');

const logoMatch = src.match(/--logo-bzf:url\('(data:image\/png;base64,[^']+)'\)/);
if (!logoMatch) throw new Error('Logo --logo-bzf introuvable dans ' + SRC);
const logoDataUri = logoMatch[1];

mkdirSync(join(OUT, 'en'), { recursive: true });
mkdirSync(join(OUT, 'es'), { recursive: true });

const problems = [];

for (const lang of LANGS) {
  let page = src
    .replace(/<html lang="[a-z]+">/, `<html lang="${lang}">`)
    .replace(/<title>[\s\S]*?<\/title>\s*/, '')
    .replace(/<meta name="description"[^>]*>\s*/, '');

  const baked = bakeText(page, dict, lang);
  page = baked.html;
  if (baked.missing.length) problems.push(`${lang}: clés i18n absentes -> ${[...new Set(baked.missing)].join(', ')}`);

  page = page.replace(/(<meta name="viewport"[^>]*>)/, (m) => `${m}\n${buildHead(lang)}`);

  // Le lien vers /favicon.png est relatif : il se resout mal depuis /en/.
  page = lang === 'fr' ? page : page.replace(/href="favicon\.png"/g, 'href="../favicon.png"');

  const outFile = join(OUT, 'index.html');
  writeFileSync(lang === 'fr' ? outFile : join(OUT, lang, 'index.html'), page);

  // Assertions. Le premier motif ne vise que les elements de texte, qui ont
  // une balise fermante ; les <input placeholder> n'en ont pas et seraient
  // sinon pris pour des elements vides.
  const checks = [
    [/\<[a-z0-9]+\b[^>]*\bdata-i18n(?:-html)?="[a-z0-9_]+"[^>]*>\s*\<\/[a-z0-9]+>/gi, 'elements de texte encore vides'],
    [/<(input|textarea)\b[^>]*\bdata-i18n-ph="[a-z0-9_]+"[^>]*>/gi, 'champs sans placeholder', (m) => /placeholder=/.test(m)],
    [/\<select\b[^>]*\bdata-i18n-opts="[a-z0-9_]+"[^>]*>([\s\S]*?)<\/select>/gi, 'select sans option', (m, inner) => /<option/.test(inner)],
    [/\<div\b[^>]*\bdata-i18n-chips="[a-z0-9_]+"[^>]*>([\s\S]*?)<\/div>/gi, 'chips vides', (m, inner) => /class="chip"/.test(inner)],
  ];
  for (const [re, label, extra] of checks) {
    let m, bad = 0;
    while ((m = re.exec(page))) if (!extra || !extra(...m)) bad++;
    if (bad) problems.push(`${lang}: ${bad} ${label}`);
  }

  writeFileSync(join(OUT, `og-${lang}.png`), buildOg(lang, logoDataUri));
  const kb = (n) => Math.round(n / 1024);
  console.log(`${lang.padEnd(3)} -> ${(lang === 'fr' ? OUT : join(OUT, lang)) + '/index.html'}  ${kb(Buffer.byteLength(page))} Ko   og-${lang}.png`);
}

// logo en PNG pour favicon et apple-touch-icon
writeFileSync(join(OUT, 'favicon.png'), Buffer.from(logoDataUri.split(',')[1], 'base64'));

// sitemap : les 3 langues, avec les alternates
const urls = LANGS.map((l) => {
  const alts = LANGS.map((a) => `    <xhtml:link rel="alternate" hreflang="${a}" href="${ORIGIN + ROUTE[a]}"/>`).join('\n');
  return `  <url>\n    <loc>${ORIGIN + ROUTE[l]}</loc>\n    <lastmod>${new Date().toISOString().slice(0, 10)}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>${l === 'fr' ? '1.0' : '0.8'}</priority>\n${alts}\n  </url>`;
}).join('\n');

writeFileSync(join(OUT, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls}\n</urlset>\n`);

writeFileSync(join(OUT, 'robots.txt'),
  `User-agent: *\nAllow: /\n\nSitemap: ${ORIGIN}/sitemap.xml\n`);

if (problems.length) {
  console.error('\nProblemes detectes :');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
console.log('\nOK : 3 pages, 3 cartes de partage, favicon, sitemap, robots.');