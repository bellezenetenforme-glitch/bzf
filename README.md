# BZF — Belle, zen et en forme

Site vitrine + questionnaire de contact. Le formulaire envoie ses réponses par email
via une **Netlify Function** (serverless) utilisant l'API **Resend**.

## Structure

- `index.html` — le site (statique, servi par Netlify).
- `netlify/functions/contact.mjs` — Netlify Function : reçoit `POST` et envoie l'email via l'API REST Resend (`fetch`, aucun SDK à bundler).
- `server/` — *(optionnel)* backend Express/Nodemailer alternatif pour du dev local
  ou une autre plateforme. Non requis pour Netlify.

## Déployer sur Netlify (gratuit)

1. Créer un compte sur https://app.netlify.com et un fichier de clé API Resend sur https://resend.com.
2. Importer ton dépôt git dans Netlify (Add new site > Import from Git),
   ou déployer manuellement via `netlify deploy`.
3. **Renseigner les variables d'environnement** (Site settings > Environment variables) :
   - `RESEND_API_KEY` — ta clé Resend (exigée pour l'envoi réel).
   - `CONTACT_EMAIL` — destination des réponses (`bellezenetenforme@gmail.com`).
   - `FROM_EMAIL` — expéditeur, ex. `BZF <onboarding@resend.dev>` (à valider dans Resend).
4. Redéployer. Le formulaire appelle automatiquement `/.netlify/functions/contact`.

Aucun build n'est nécessaire : `netlify.toml` indique de publier la racine.

## Configurer Resend

Le fallback du front : si l'envoi échoue, le site propose un `mailto:` pré-rempli
avec toutes les réponses afin que rien ne soit perdu.
