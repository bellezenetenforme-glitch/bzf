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
