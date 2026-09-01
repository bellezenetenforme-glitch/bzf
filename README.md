# BZF — Belle, zen et en forme

Site vitrine + questionnaire de contact. Le formulaire envoie ses réponses par email
via une **Netlify Function** (serverless) utilisant l'API **Resend**.

## Structure

- `index.html` — le site (statique, servi par Netlify).
- `netlify/functions/contact.mjs` — Netlify Function : reçoit `POST` et envoie l'email.
- `netlify.toml` — configuration Netlify (publish = `.`, functions = `netlify/functions`).
- `package.json` — dépendance `resend` pour la fonction.
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

## Tester en local

Le plus simple : installer `netlify-cli` (⚠ ne s'installe pas sur Node 26) — à la place,
on peut tester la fonction directement en Node :

```bash
npm install
# validation (ne part pas d'email) :
node --input-type=module -e "import('./netlify/functions/contact.mjs').then(async ({handler})=>{const r=await handler({httpMethod:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({Prenom:'Marie',Message:'Bonjour'})});console.log(r.status, await r.text())})"

# envoi réel (avec une vraie clé Resend) :
RESEND_API_KEY=re_xxx CONTACT_EMAIL=to@mail.com node --input-type=module -e "..." # idem
```

## Configurer Resend

1. Créer une clé API : https://resend.com/api-keys.
2. Ajouter/valider ton domaine pour envoyer depuis ton propre email
   (pendant le test, `onboarding@resend.dev` fonctionne pour un seul destinataire).
3. Renseigner la clé dans Netlify.

Le fallback du front : si l'envoi échoue, le site propose un `mailto:` pré-rempli
avec toutes les réponses afin que rien ne soit perdu.
