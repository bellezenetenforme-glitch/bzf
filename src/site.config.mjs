/* ------------------------------------------------------------------
   Domaine du site, partage par le build et les tests.

   Une seule source de verite : les tests ne doivent pas recopier le
   domaine, sinon ils valideraient une URL que le build ne produit pas.

   SITE_ORIGIN permet de changer de domaine sans toucher au code :
   le build lit la variable d'environnement, sinon cette valeur.
------------------------------------------------------------------ */

export const SITE_ORIGIN = (
  process.env.SITE_ORIGIN || 'https://bellezenetenforme.netlify.app'
).replace(/\/+$/, '');