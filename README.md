# BZF — Belle, zen et en forme

Site vitrine + questionnaire de contact. Le formulaire envoie ses réponses par email
via une **Netlify Function** (serverless) utilisant l'API **Resend**.

## Structure

- `src/index.html` — la source du site (statique, HTML + CSS + JS inline).
- `build.mjs` — génère une vraie page par langue dans `dist/`.
- `src/og.svg` — gabarit de la carte de partage, rendu en PNG par `@resvg/resvg-js`.
- `src/fonts/` — les polices de la charte, versionnées pour que la carte de
  partage rende pareil sur n'importe quelle machine.
- `netlify/functions/contact.mjs` — Netlify Function : reçoit `POST` et envoie
  l'email via l'API REST Resend (`fetch`, aucun SDK à bundler).

## Construire et vérifier

```bash
npm install         # une seule dépendance : @resvg/resvg-js
npm test            # 19 tests de la fonction de contact
npm run build       # -> dist/
npm run check:config  # vérifie que les emails partiront vraiment
npm run dev         # netlify dev
```

`dist/` n'est pas commité, il est produit par Netlify à chaque déploiement.

### `npm run check:config`

Le contrôle qui compte avant un déploiement. Il lit l'environnement (et `.env`
en local) et signale ce qui empêcherait les emails d'arriver. Il a notamment un
cas particulier pour `onboarding@resend.dev`, qui répond 200 sans rien livrer :
sans ce contrôle, on ne s'en aperçoit qu'en perdant un client.

Il sort en code 1 si un envoi email serait cassé, en code 0 sinon.

### `npm test`

19 tests qui chargent le handler sans réseau : `RESEND_API_KEY` est vide, donc
une requête qui franchit tous les filtres s'arrête sur un 503 — ce qui prouve
qu'elle a atteint l'étape Resend. Ils couvrent le honeypot, le temps de
remplissage, le contrôle d'origine, le rate limit, et l'absence de repli sur le
domaine de test.

## Les pages et les langues

Le site est une page unique dont le texte est traduit en JS à l'exécution. Le
build produit une **vraie page par langue** :

| URL | Fichier | Usage |
| --- | --- | --- |
| `/` | `dist/index.html` | français, `og:locale=fr_FR` |
| `/en/` | `dist/en/index.html` | anglais, `og:locale=en_GB` |
| `/es/` | `dist/es/index.html` | espagnol, `og:locale=es_ES` |

Chaque page a son `<title>`, sa description, son `canonical`, ses `hreflang`
et sa carte de partage `og-{langue}.png`. Le build écrit aussi `sitemap.xml`
et `robots.txt`.

`build.mjs` injecte `window.__BZF_LANG__` dans chaque page et `detectLang()` le
privilégie sur `localStorage` : sans cela, un visiteur français arrivant sur
`/en/` se verrait rebasculer en français et les `hreflang` pointeraient vers un
contenu qui ne correspond pas à l'URL.

Le sélecteur de langue navigue vers la bonne URL. Hors build (si tu sers
`src/index.html` directement), il se contente de changer le texte, comme avant.

### Ce que le build ne prerend pas

Les 19 produits et le quiz sont générés par `renderQuiz()` et `renderNeeds()` à
l'exécution : le HTML ne contient que les coquilles `<main id="needContainer">`
et `<div id="quizGrid">`, vides.

**Ce n'est plus un blocage technique.** Les images étant désormais des fichiers
dans `dist/img/` (`commit a4c4656`), un pré-rendu ne coûterait plus de poids :
il suffirait de scinder `renderNeeds()` en une fonction pure qui renvoie la
chaîne HTML, et une fonction qui branche les événements. C'est reporté, pas
écarté.

Ce qui reste vrai, et qui limite l'intérêt de la chose :

- **Google** exécute le JS et indexe déjà les 21 produits aujourd'hui ;
- **les scrapers sociaux** (WhatsApp, Instagram, Facebook) n'exécutent pas de
  JS, mais ils n'ont jamais utilisé le corps de la page : ils lisent
  `og:title`, `og:description` et `og:image`, tous trois déjà en place.

Le seul lecteur réellement servi serait un crawler textuel ou un assistant IA,
qui n'extrait aujourd'hui qu'un HTML vide sous les titres. Rapport effort/risque
défavorable sur le cœur commercial du site — d'où le report.

Le build vérifie qu'il ne reste aucun élément i18n vide et échoue avec un code
de sortie 1 sinon.

### Images

Les 30 images de la source sont écrites dans `dist/img/` avec un nom
`produit-<nom>-<hash8>.<ext>`. Le hash dérive du contenu : l'URL ne change que
si l'image change, donc un cache longue durée reste valable.

Le hero est au-dessus de la ligne de flottaison : il reste `eager`, porte
`fetchpriority="high"` et est préchargé dans le `<head>`. Les 23 autres images
passent en `loading="lazy" decoding="async"`.

Les 7 fonds de section (`SECBG`) restent chargés d'un bloc : ce sont des
`background-image` CSS, que le navigateur ne sait pas charger paresseusement,
et `renderNeeds()` crée les 7 sections d'un coup. Les repousser demanderait un
`IntersectionObserver` qui bascule une variable CSS à l'entrée dans le
viewport.

Le build échoue si une seule image reste en base64, si une image est écrite
sans être référencée, ou si une référence ne résout pas vers un fichier
présent sur le disque.

`src/index.html` n'est **pas** censé être ouvert tel quel : sans build, il
n'a plus d'images. Utilise `npm run dev`.

## Le domaine du site

Le domaine vit dans **`src/site.config.mjs`**, importé par le build et par les
tests — une seule source de vérité. Il vaut par défaut
`https://bellezenetenforme.netlify.app`.

**Changer de domaine = poser `SITE_ORIGIN` dans le dashboard Netlify**, puis
redéployer. Tout se régénère : `canonical`, `hreflang`, `og:url`, `sitemap.xml`,
`robots.txt`, JSON-LD. Aucune ligne de code à toucher.

> ⚠️ À ne pas confondre avec `bellezenetenforme.fr` : ce domaine est **un autre
> site**, ton blog TYPO3. Tant que la vitrine est sur `netlify.app`, ne mets pas
> ce domaine-là dans le canonical ni dans `ALLOWED_ORIGINS` — tu déclarerais à
> Google que ton contenu est canonique chez quelqu'un d'autre.

Un `canonical` sur un sous-domaine `netlify.app` est exact mais peu utile : les
signaux d'autorité restent sur un domaine temporaire. Le jour où tu as un
domaine propre, `SITE_ORIGIN` règle l'ensemble.

## Déployer sur Netlify (gratuit)

1. Créer un compte sur https://app.netlify.com et un fichier de clé API Resend sur https://resend.com.
2. Importer ton dépôt git dans Netlify (Add new site > Import from Git),
   ou déployer manuellement via `netlify deploy`.
3. **Valider ton domaine** sur https://resend.com/domains — sans ça, Resend
   refuse tout expéditeur qui ne soit pas `onboarding@resend.dev`.
4. **Renseigner les variables d'environnement** (Site settings > Environment variables) :
   - `RESEND_API_KEY` — ta clé Resend.
   - `CONTACT_EMAIL` — destination des réponses (`bellezenetenforme@gmail.com`).
   - `FROM_EMAIL` — expéditeur sur ton domaine validé, ex.
     `BZF <contact@bellezenetenforme.fr>`.
5. Redéployer. Le formulaire appelle automatiquement `/.netlify/functions/contact`.

## Configurer Resend

### ⚠️ `FROM_EMAIL` est obligatoire, volontairement

La fonction **n'a pas de valeur de repli**. Si `FROM_EMAIL` n'est pas définie,
elle répond `503` et n'envoie rien.

C'est un choix : `onboarding@resend.dev`, le seul expéditeur qui fonctionne sans
domaine validé, ne livre qu'à l'adresse du compte Resend. Avec ce repli,
l'API répond 200, le site affiche « envoyé », et le message n'arrive jamais —
un lead perdu sans le moindre signal. Un échec bruyant vaut mieux.

Si un client te dit « j'ai envoyé le formulaire et rien reçu », regarde d'abord
si `FROM_EMAIL` est bien posée sur Netlify : c'est la cause la plus fréquente.

### Si un vrai client ne reçoit rien

Deux causes possibles, dans cet ordre :

1. `FROM_EMAIL` absente ou pointant sur `onboarding@resend.dev` → la fonction
   répond 503 et l'écran d'erreur du site propose le `mailto:` de secours.
2. Ton origine n'est pas dans la liste `ALLOWED_ORIGINS` → la requête est
   rejetée **en silence** (voir la section anti-spam plus bas).

### Le secours : pourquoi un `mailto:` alors que l'email n'est plus proposé

Quand l'envoi technique échoue, le site propose un `mailto:` **pré-rempli avec
le sujet et toutes les réponses**.

C'est délibéré, et ce n'est pas une incohérence avec le retrait de l'email parmi
les canaux du formulaire :

- le formulaire demande à la cliente **comment elle préfère être recontactée** ;
- le secours utilise **la boîte de Steff** pour recevoir le lead.

Les deux couches sont différentes. Retirer l'email de la question ne change pas
le fait que Steff lit sa boîte aux lettres.

Un lien Messenger ne conviendrait pas : il ne transporte rien, et Steff devrait
redemander le questionnaire à la cliente. Remplacer le `mailto:` ferait perdre
précisément ce que le secours existe pour sauver.

L'écran d'erreur explique ce qu'il va se passer — les réponses sont déjà
écrites, il ne reste qu'à envoyer — parce que sur mobile, un `mailto:` peut
n'apparaître dans rien si aucune application mail n'est configurée.

## Ce que le formulaire ne devine pas

Chaque liste déroulante commence par une **option vide** (« — »). Sans elle, le
navigateur sélectionne la première réponse et chaque lead se voit attribuer des
réponses qu'il n'a jamais données : « Non jamais » pour les compléments, « Moins
de 50 € » pour le budget, « Messenger » pour le canal. Sur les 5 listes, cela
faussait le profil de tout le monde.

Quand un champ est laissé vide, l'email affiche `—` plutôt qu'une valeur fausse.
L'option vide est présente **à la fois** dans le HTML généré et dans `setLang()` :
sans cela, un changement de langue la supprimerait et le problème reviendrait.

## Liens de vente à renseigner

Quatre constantes en haut du script de `src/index.html` (ligne ~857) sont encore
à `#` ou vides. Tant qu'elles le sont, `npm run build` le signale et
`npm run check:config` les liste.

Ce sont des **ancres internes**, pas des URL : elles valent `#questionnaire` et
`#team`, pas `https://…`.

| Constante | Ce qu'elle pilote |
| --- | --- |
| `CONTACT_LINK` → `#questionnaire` | le bouton « Écris-moi directement » de l'écran d'erreur, qui renvoie vers le formulaire |
| `TEAM_LINK` → `#team` | le bouton « Rejoindre la Team » de l'en-tête |
| `PROMO_LINK` → à définir | le lien à côté du code partenaire dans le footer |
| `PROMO_CODE` → à définir | le texte affiché ; le bloc footer est masqué tant que c'est vide |

Une ancre qui pointe vers un `id` inexistant est un lien mort silencieux — la
page ne bouge pas. Un test échoue si une de ces ancres n'existe pas, et vérifie
aussi que le bouton Team porte bien l'`id` que `TEAM_LINK` pilote : sans ça,
une constante invalide passerait inaperçue derrière une ancre en dur.

Les boutons « Commande maintenant » des sections produits, eux, fonctionnent
déjà : ils passent par `shopUrl(c.shop)`, de vrais liens FitLine.

## Titres et descriptions SEO

`build.mjs` les porte, avec une assertion qui refuse de publier un titre de
plus de 65 caractères, une description de plus de 160, ou un texte français
sans accent — c'est du contenu affiché par Google, pas du code.

Les trois langues sont là : `/`, `/en/`, `/es/`, et le terme cible est présent
dans les trois : *nutrition* et *bien-être* en français, *nutrition and wellness*
en anglais, *nutrición y bienestar* en espagnol. Les textes sont dans `SEO` en
haut de `build.mjs`, et un test échoue si le terme cible disparaît d'une langue.

Le build refuse aussi un titre de plus de 65 caractères, une description de plus
de 160, ou un texte français sans accent.

Ces deux termes sont des **têtes de marché** très concurrentielles : une vitrine
de partenaire locale ne se positionnera pas dessus. Ils apportent la pertinence,
pas le trafic. Le trafic viendra du local (nom de la ville, « près de chez
moi ») et des intentions longues que les clientes tapent réellement — un
complément pour le sommeil, une routine fatigue, un avis sur un produit précis.
Le qualificatif local est en place : **Tours (Indre-et-Loire)**, dans les trois
langues.

### Données structurées

Chaque page porte un `HealthAndBeautyBusiness` en JSON-LD, avec la zone
desservie (Tours, Indre-et-Loire) et les profils sociaux repris des constantes
de la page.

**Aucune adresse n'est déclarée.** Steff travaille en direct : publier son
domicile sur un site vitrine relève de la vie privée. Google n'affichera donc pas
de fiche locale enrichie avec adresse ni horaires. Si un jour tu veux cette
fiche, c'est un choix à faire consciemment.

Pour aller plus loin en SEO local, deux leviers restent :
- une page ou une section **par commune** du 37 (Saint-Cyr-sur-Loire, Joué-lès-
  Tours, Amboise…) avec son propre texte : Google aime la proximité nommée ;
- une inscription **Google Business Profile**, qui pèse plus que n'importe quelle
  balise sur une recherche « nutrition + Tours ».

## Anti-spam

La fonction `contact` filtre les robots avant d'appeler Resend, dans cet ordre :

| Filtre | Comportement |
| --- | --- |
| Taille du body > 20 000 car. | `413` |
| Honeypot (`_hp`) rempli | rejeté **en silence** |
| Remplissage en < 2,5 s (`_t`) | rejeté **en silence** |
| `Origin`/`Referer` hors liste | rejeté **en silence** |
| Plus de 3 envois / heure par IP | `429` |

« En silence » = réponse `200 {"success":true}` sans rien envoyer. Le bot n'a
aucun signal pour apprendre, et le quota Resend n'est pas consommé. Le front
affiche donc l'écran de succès : c'est voulu.

### ⚠️ Si un vrai client ne reçoit rien

L'origine de la requête doit figurer dans la liste. Par défaut ce sont
`bellezenetenforme.fr`, `www.bellezenetenforme.fr`, tout `*.netlify.app`,
`*.netlify.com` et `localhost`. **Si tu changes de domaine, ajoute-le** dans la
variable `ALLOWED_ORIGINS` du dashboard Netlify, sinon tous les envois seront
coupés sans message d'erreur. Un point initial signifie « suffixe » :
`.netlify.app` couvre tous les sous-domaines Netlify.

Le rate limit vit en mémoire dans l'instance de la fonction. Netlify détruit
immédiatement une instance inutilisée, donc le compteur peut repartir de zéro :
c'est une barrière contre le spam opportuniste, pas une garantie. Pour un
verrouillage durable, il faudrait Netlify Blobs ou Cloudflare Turnstile.

### Tester en local

`netlify dev`, puis :

```bash
curl -i http://localhost:8888/.netlify/functions/contact \
  -H 'Content-Type: application/json' \
  -H 'Origin: http://localhost:8888' \
  -d '{"_subject":"test","Prenom":"Lea","Contact":"lea@mail.fr","Canal":"mail","Message":"Bonjour","_t":60000}'
```

Sans le header `Origin`, la requête est rejetée : c'est voulu, ça écarte le
`curl` tout simple. Pour les cas rejetés, vérifie que **rien n'arrive** dans le
dashboard Resend.
