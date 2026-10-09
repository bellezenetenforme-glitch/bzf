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

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { join, resolve, relative } from 'node:path';
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
    title: 'BZF — Belle, zen et en forme | Conseil FitLine personnalisé',
    desc: 'Steff, partenaire indépendante FitLine, compose avec toi une routine de produits adaptée à ton objectif : énergie, sommeil, glow ou forme. Réponds en 2 minutes.',
  },
  en: {
    title: 'BZF — Beautiful, calm and in shape | FitLine advice',
    desc: 'Steff, an independent FitLine partner, builds a routine matched to your goal: energy, sleep, glow or shape. Fill in the 2-minute questionnaire.',
  },
  es: {
    title: 'BZF — Bella, zen y en forma | Consejo personalizado FitLine',
    desc: 'Steff, partner independiente de FitLine, te recomienda una rutina según tu objetivo: energía, sueño, glow o figura. Rellena el cuestionario en 2 minutos.',
  },
};

/* Google tronque le titre autour de 60 caracteres et la description autour de
   160. On verifie plutot que de le decouvrir apres coup dans les resultats.
   Les textes sont affiches aux utilisateurs : ils doivent porter leurs
   accents, contrairement au reste du code qui est en ASCII. */
const SEO_TITLE_MAX = 65;
const SEO_DESC_MAX = 160;
function checkSeo(lang) {
  const { title, desc } = SEO[lang];
  if (title.length > SEO_TITLE_MAX) problems.push(`${lang}: titre SEO trop long (${title.length} > ${SEO_TITLE_MAX})`);
  if (desc.length > SEO_DESC_MAX) problems.push(`${lang}: description SEO trop longue (${desc.length} > ${SEO_DESC_MAX})`);
  if (/[a-z]/.test(title) && !/[àâçéèêëîïôùûüÿœæ]/i.test(title + desc) && lang === 'fr') {
    problems.push(`${lang}: textes SEO sans accent`);
  }
}

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

/* ---------- extraction des images inline ----------

   La source embarque 594 Ko d'images en base64, soit 63 % du fichier :
   elles sont telechargees d'un bloc, jamais paresseusement, et dupliquees
   dans chacune des 3 pages generees. On les sort en fichiers.

   Le nom contient un hash court du contenu : l'URL ne change que si
   l'image change, donc un cache longue duree reste sur, et un build sans
   modification d'image ne regenere pas de nouveaux noms. */

const IMG_TOKEN = '__BZF_IMG__';
const IMG_EXT = { 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/svg+xml': 'svg' };

/* Nom lisible deduit du contexte. Les ancres sont testees sur les ~700
   caracteres qui precedent le blob ; elles sont uniques dans la source.
   --logo-bzf-noir doit etre teste avant --logo-bzf. */
const NAME_HINTS = [
  [/\-\-logo-bzf-noir:url\('$/, 'logo-bzf-noir'],
  [/\-\-logo-bzf:url\('$/, 'logo-bzf'],
  [/\-\-whybg:url\('$/, 'why'],
  [/<img id="heroImg"[^>]*src="$/, 'hero'],
  [/<span class="logo-disc fit"><img[^>]*src="$/, 'logo-fitline'],
  [/<div class="avatar"><img[^>]*src="$/, 'avatar'],
];

// FNV-1a : suffisant pour un nom de fichier, et sans dependance.
function hash8(buf) {
  let h = 0x811c9dc5;
  for (const b of buf) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

function slug(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 28) || 'x';
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Nom d'un produit : name:"X", ou name:{fr:"X",...} pour les noms traduits.
const NAME_RE = /(?<![A-Za-z0-9_])name:(?:\{fr:")?\{?"([^"]+)"/g;

/* Retire les data-URI de `text` et renvoie le texte remplace, l'ensemble des
   fichiers a ecrire, et le chemin de l'image du hero pour le preload.
   Chaque blob n'est ecrit qu'une fois, meme s'il apparait plusieurs fois. */
function extractImages(text) {
  const names = new Map();   // base64 -> nom de fichier
  const files = new Map();   // nom de fichier -> octets
  let out = '', last = 0, seq = 0, hero = null;
  const re = /data:image\/([a-z+]+);base64,([A-Za-z0-9+/=]+)/g;
  let m = re.exec(text);

  while (m !== null) {
    const [whole, mime, b64] = m;
    const ext = IMG_EXT['image/' + mime];
    const at = m.index; // conserve avant d'avancer le curseur
    m = re.exec(text);
    if (!ext) continue; // type inconnu : on laisse tel quel

    if (!names.has(b64)) {
      const before = text.slice(Math.max(0, at - 700), at);
      let hint = null;
      for (const [anchor, name] of NAME_HINTS) {
        if (anchor.test(before)) { hint = name; break; }
      }
      if (!hint) hint = guessHint(text, whole, at) || ('img-' + (++seq));
      const buf = Buffer.from(b64, 'base64');
      const name = `${hint}-${hash8(buf)}.${ext}`;
      names.set(b64, name);
      files.set(name, buf);
      if (hint === 'hero') hero = name;
    }
    // On emet un jeton plutot que le chemin final : le prefixe differe selon
    // la langue (img/ sur la racine, ../img/ depuis /en/ et /es/) et il faut
    // le poser au moment de generer chaque page, pas une fois pour toutes.
    // Un remplacement par motif attraperait les attributs src/href mais pas
    // les chaines JS ni les url(...) CSS : c'etait exactement le trou.
    out += text.slice(last, at) + IMG_TOKEN + names.get(b64);
    last = at + whole.length;
  }
  out += text.slice(last);
  return { text: out, files, hero };
}

/* Les sections et les produits tirent leur nom de la donnee qui porte le blob :
   const SECBG={"energie":"data:..." et { name:"Restorate", ..., img:"data:...". */
function guessHint(text, whole, at) {
  const sec = /const SECBG=\{(.*?)\}/.exec(text);
  if (sec) {
    for (const [, key, val] of sec[1].matchAll(/"([^"]+)":"([^"]+)"/g)) {
      if (val === whole) return 'sec-' + slug(key);
    }
  }
  // Pour un produit, on prend le nom le plus proche en amont de l'image.
  // Un balayage paresseux sur tout le fichier serait faux : il traverserait
  // la frontiere entre deux objets et nommerait une image d'apres un autre
  // produit. Entre name: et img: il n'y a que url/hook/bullets, donc 400
  // caracteres suffisent largement et ne debordent jamais sur l'objet suivant.
  const before = text.slice(Math.max(0, at - 400), at);
  const names = [...before.matchAll(NAME_RE)];
  if (names.length) return 'produit-' + slug(names[names.length - 1][1]);
  return null;
}

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

function buildHead(lang, hero) {
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
  // Le hero est au-dessus de la ligne de flottaison et porte fetchpriority :
  // sans preload le navigateur ne le decouvrirait qu'apres le parsing du HTML.
  if (hero) lines.push(`<link rel="preload" as="image" href="${hero}" fetchpriority="high">`);
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

// Le logo sert a la fois au favicon et a la carte de partage : on le garde
// en base64 le temps de ces deux usages, puis on retire toutes les images
// de la page HTML.
const logoMatch = src.match(/--logo-bzf:url\('(data:image\/png;base64,[^']+)'\)/);
if (!logoMatch) throw new Error('Logo --logo-bzf introuvable dans ' + SRC);
const logoDataUri = logoMatch[1];

const stripped = extractImages(src);
if (!stripped.hero) throw new Error('Image hero introuvable : le preload ne peut pas etre genere');

mkdirSync(join(OUT, 'img'), { recursive: true });
mkdirSync(join(OUT, 'en'), { recursive: true });
mkdirSync(join(OUT, 'es'), { recursive: true });

for (const [name, buf] of stripped.files) writeFileSync(join(OUT, 'img', name), buf);

// Le hero est un chemin relatif : depuis /en/ et /es/ il faut remonter d'un cran.
const heroFor = (lang) => (lang === 'fr' ? '' : '../') + 'img/' + stripped.hero;

const problems = [];
const writtenImgs = new Set();
for (const l of LANGS) checkSeo(l);

for (const lang of LANGS) {
  let page = stripped.text
    .replace(/<html lang="[a-z]+">/, `<html lang="${lang}">`)
    .replace(/<title>[\s\S]*?<\/title>\s*/, '')
    .replace(/<meta name="description"[^>]*>\s*/, '');

  const baked = bakeText(page, dict, lang);
  page = baked.html;
  if (baked.missing.length) problems.push(`${lang}: clés i18n absentes -> ${[...new Set(baked.missing)].join(', ')}`);

  page = page.replace(/(<meta name="viewport"[^>]*>)/, (m) => `${m}\n${buildHead(lang, heroFor(lang))}`);

  // Les chemins d'images sont relatifs au document : sur /en/ et /es/ il
  // faut remonter d'un cran, comme pour le favicon.
  page = page.split(IMG_TOKEN).join(lang === 'fr' ? 'img/' : '../img/');
  if (lang !== 'fr') page = page.replace(/href="favicon\.png"/g, 'href="../favicon.png"');

  // Toute image citee, quel que soit son chemin, doit exister sur le disque.
  // Quatre formes de reference coexistent, et aucune n'est optionnelle :
  // attributs src/href, url(...) CSS, valeurs de l'objet SECBG, et chaines JS
  // des produits (img:"..."). C'est ce controle qui garantit qu'aucune page ne
  // sort avec une image cassee.
  const refs = new Set();
  const collect = (re, pick = (m) => m[1]) => {
    for (const m of page.matchAll(re)) refs.add(pick(m));
  };
  collect(/(?:src|href)=["']([^"']+\.(?:webp|png|jpe?g))["']/g);
  collect(/url\(['"]?([^'")]*\.(?:webp|png|jpe?g))/g);
  collect(/"[^"]+"\s*:\s*"([^"]+\.(?:webp|png|jpe?g))"/g);   // SECBG et produit
  collect(/\bimg\s*:\s*"([^"]+\.(?:webp|png|jpe?g))"/g);

  // On resout chaque reference comme le navigateur le fera, depuis le
  // repertoire de la page. Comparer seulement le NOM de fichier laissait
  // passer un src="hero.webp" sans le dossier img/ : c'est precisement ce
  // controle qui l'attrape maintenant.
  const pageDir = resolve(lang === 'fr' ? OUT : join(OUT, lang));
  const imgDir = resolve(OUT, 'img');
  for (const ref of refs) {
    // Le favicon n'est pas dans img/ : il est ecrit a part depuis le logo.
    if (/favicon\.png$/.test(ref)) continue;
    const name = relative(imgDir, resolve(pageDir, ref));
    // On interroge le disque, pas la carte en memoire : une image listee mais
    // non ecrite produirait sinon une page cassee avec un build au vert.
    if (name.startsWith('..') || !stripped.files.has(name) || !existsSync(join(imgDir, name))) {
      problems.push(`${lang}: image referencee non resolue -> ${ref}`);
    } else {
      writtenImgs.add(name);
    }
  }

  // On ne vise que les images raster en base64 : la fleche du <select> est un
  // SVG de 200 octets encode en URL, inline dans le CSS, et doit y rester.
  if (/data:image\/(webp|png|jpe?g);base64,/.test(page)) problems.push(`${lang}: il reste une image raster en base64`);
  if (!/<img id="heroImg"[^>]*fetchpriority="high"/.test(page)) problems.push(`${lang}: hero sans fetchpriority`);

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

// Une image ecrite mais jamais referencee signale un nom casse ou un blob
// orphelin : dans les deux cas, on laisse un fichier inutile sur le disque.
for (const name of stripped.files.keys()) {
  if (!writtenImgs.has(name)) problems.push(`image ecrite jamais referencee -> ${name}`);
}

if (problems.length) {
  console.error('\nProblemes detectes :');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
console.log('\nOK : 3 pages, 3 cartes de partage, favicon, sitemap, robots.');