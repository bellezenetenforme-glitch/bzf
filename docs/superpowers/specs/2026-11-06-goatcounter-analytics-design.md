# Design : compteur de visites GoatCounter (2026-11-06)

## Intention
Savoir combien de visiteurs reçoit le site, sans rien afficher publiquement et
sans bandeau de consentement. Un compteur de visites « en gros », vu dans un
tableau de bord externe.

## Objectifs
- Compter les visites des 3 pages (fr, en, es) dès le prochain déploiement.
- Zéro impact perceptible : ~1 kB, chargé en async, aucun cookie.
- Zéro changement visible sur la page (pas de compteur affiché).

## Non-objectifs / anti-goals
- Pas de graphiques avancés, objectifs, entonnoirs (Plausible/Matomo hors sujet).
- Pas de chiffre affiché sur la page (choix explicite : « non pas public »).
- Pas de bandeau de consentement : GoatCounter est sans cookies, donc
  exempt de consentement (données hébergées aux Pays-Bas, UE).

## Contraintes
- Site statique généré par `build.mjs`, déployé sur Netlify (build command
  `node build.mjs`, publish `dist/`).
- Aucun outil d'analytics n'existe aujourd'hui (vérifié : ni matomo, ni
  plausible, ni gtag dans le repo).
- Le code du compteur (sous-domaine GoatCounter) est une donnée de
  l'utilisateur : il doit créer le compte sur goatcounter.com.

## Approches envisagées
1. **GoatCounter (retenue)** — gratuit, sans cookies, script injecté au build.
   Trade-off : le tableau de bord vit chez un tiers.
2. **Netlify Analytics** — côté serveur, invisible, mais ~9 $/mois et
   add-on par site. Écarté : payant pour un simple compteur.
3. **Compteur maison (Netlify Function + Blobs)** — un compteur affichable
   publiquement. Écarté : l'utilisateur ne veut rien d'afficher.

## Comment ça marche (décisions)
- `buildHead()` dans `build.mjs` (ligne ~319) injecte dans les 3 pages :
  ```html
  <script data-goatcounter="https://CODE.goatcounter.com/count" async src="//gc.zgo.at/count.js"></script>
  ```
- Le code vient de la variable d'environnement `GOATCOUNTER_CODE`
  (posée dans le dashboard Netlify). Si absente (build local, tests),
  **aucune balise n'est émise** — le build reste identique.
- Le script est ajouté en fin de `<head>`, après `window.__BZF_LANG__`.
- Aucune donnée perso collectée (pas de cookies, IP anonymisées par
  GoatCounter), donc rien à déclarer dans une politique de confidentialité
  au-delà d'une mention si déjà présente.

## Ce qu'il reste au builder
1. Créer le compte sur goatcounter.com et récupérer le code
   (ex. `monsite`, d'où `monsite.goatcounter.com`) — **étape utilisateur**.
2. Modifier `build.mjs` : lecture de `process.env.GOATCOUNTER_CODE`,
   injection conditionnelle dans `buildHead`.
3. Ajouter un test dans `test/build.test.mjs` :
   - sans la variable → aucune balise `goatcounter` dans `dist/*.html` ;
   - avec la variable → la balise est présente dans les 3 pages.
4. Poser `GOATCOUNTER_CODE` dans le dashboard Netlify, redéployer.
5. Vérifier en ligne : le dashboard GoatCounter affiche une visite.
