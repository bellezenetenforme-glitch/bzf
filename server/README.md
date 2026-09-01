# Backend d'envoi du questionnaire BZF

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
- `PORT` : port d'écoute (4000 par défaut).

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
  -d '{"_subject":"Test","Prenom":"Marie","Contact":"06 12 34 56 78","Canal":"Email","Message":"Bonjour Steff, je veux une routine."}'
```

Avec `MAIL_DRY_RUN=true`, le message apparaît dans la console du serveur.

## Brancher le front

Le front `index.html` appelle cet endpoint. Vérifie la constante `API_URL` dans le
script (`const API_URL = 'http://localhost:4000/api/contact'`) et pointe-la vers
l'URL publique de ton serveur en production.

## Déploiement

Héberge ce dossier sur une plateforme Node classique (Railway, Render, Fly.io, Vercel Functions…),
en renseignant les variables d'environnement ci-dessus et en remplaçant `API_URL` côté front
par l'URL de l'endpoint déployé.
