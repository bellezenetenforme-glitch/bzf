# Backend d'envoi du questionnaire BZF

> **Ce dossier n'est pas utilisé en production.** Le front appelle
> `/.netlify/functions/contact` (voir `netlify/functions/contact.mjs`).
> Ce serveur est conservé comme alternative si tu quittes Netlify
> (Railway, Render, Fly.io…). Il applique les mêmes contrôles anti-spam.

Petit serveur Node/Express qui reçoit les réponses du formulaire de `index.html`
et les envoie par email à `CONTACT_EMAIL` via un transporteur SMTP (Nodemailer).

## Installation

```bash
cd server
npm install
cp .env.example .env   # puis édite .env
```

## Configuration (fichier `.env`)

- `CONTACT_EMAIL` : destination des réponses (`bellezenetenforme@gmail.com` par défaut).
- `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` : les coordonnées
  SMTP de ton fournisseur d'email.
  - **Gmail** : `smtp.gmail.com`, port `465`, `SMTP_SECURE=true` ; il faut créer un
    **mot de passe d'application** (jamais ton mot de passe normal).
  - **Brevo / Zoho / Outlook / OVH** : utilise leurs coordonnées SMTP.
- `MAIL_DRY_RUN=true` : mode dev — les messages sont affichés dans la **console**
  du serveur au lieu d'être réellement envoyés (aucun email part).
- `CLIENT_ORIGIN` : `true` pour accepter toutes les origines (dev), ou une URL
  (ex: `https://bellezenetenforme.fr`) en production.
- `ALLOWED_ORIGINS` : origines autorisées par le filtre anti-spam (séparées par
  des virgules). Vide → défaut : `bellezenetenforme.fr`, son `www`, tout
  `*.netlify.app`, `*.netlify.com` et `localhost`. **Toute origine absente est
  rejetée silencieusement** (200, aucun email) : ajoute-la si tu changes de
  domaine.
- `PORT` : port d'écoute (4000 par défaut).

## Anti-spam

Mêmes filtres que la Netlify Function : body > 20 000 caractères → `413`,
honeypot `_hp` rempli / remplissage en < 2,5 s (`_t`) / origine hors liste →
rejet **silencieux** (`200 {"success":true}`, rien n'est envoyé), et plus de
3 envois par heure et par IP → `429`. Contrairement à la fonction, ce serveur
est long-running : le compteur de débit tient vraiment.

## Démarrer

```bash
node index.js        # ou : npm start
# mode dev (recharge auto) : npm run dev
```

Le serveur écoute sur `http://localhost:4000`.
Endpoint : `POST /api/contact` — vérif de santé : `GET /health`.

## Tester (sans le front)

```bash
curl -X POST http://localhost:4000/api/contact \
  -H 'Content-Type: application/json' \
  -H 'Origin: http://localhost:4000' \
  -d '{"_subject":"Test","Prenom":"Marie","Contact":"06 12 34 56 78","Canal":"Email","Message":"Bonjour Steff, je veux une routine.","_t":60000}'
```

Le header `Origin` est obligatoire : sans lui la requête est rejetée par le
filtre anti-spam. `_t` est le temps de remplissage en ms — mets une valeur
supérieure à 2500 pour passer le filtre.

Avec `MAIL_DRY_RUN=true`, le message apparaît dans la console du serveur.

## Brancher le front

Le front appelle `/.netlify/functions/contact` par défaut (`API_URL` dans
`index.html`). Pour utiliser ce serveur à la place, remplace cette constante
par l'URL publique de ton endpoint, ex.
`const API_URL = 'https://ton-serveur.example/api/contact';`.

## Déploiement

Héberge ce dossier sur une plateforme Node classique (Railway, Render, Fly.io, Vercel Functions…),
en renseignant les variables d'environnement ci-dessus et en remplaçant `API_URL` côté front
par l'URL de l'endpoint déployé.
