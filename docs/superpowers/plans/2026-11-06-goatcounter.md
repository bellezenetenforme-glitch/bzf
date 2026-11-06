# GoatCounter Compteur de Visites — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compter les visites des 3 pages via GoatCounter, injecté au build seulement si `GOATCOUNTER_CODE` est défini, sans rien afficher sur la page.

**Architecture:** `buildHead()` dans `build.mjs` lit `process.env.GOATCOUNTER_CODE` et, si présent, ajoute la balise script GoatCounter en fin de `<head>` des 3 pages générées. Sans la variable, le HTML est strictement identique à aujourd'hui.

**Tech Stack:** Node.js (build.mjs), node:test (test/build.test.mjs), déploiement Netlify.

**Spec:** `docs/superpowers/specs/2026-11-06-goatcounter-analytics-design.md`

## Global Constraints
- Le code du compteur vient de l'env `GOATCOUNTER_CODE` (ex. `monsite` → `monsite.goatcounter.com`). Jamais codé en dur.
- Sans la variable, aucune balise `goatcounter` ni `zgo.at` ne doit apparaître dans `dist/*.html`.
- Balise exacte (une fois le code connu) : `<script data-goatcounter="https://CODE.goatcounter.com/count" async src="//gc.zgo.at/count.js"></script>`
- Rien ne change côté visible de la page : pas de compteur affiché, pas de bandeau de consentement.
- `npm run verify` (build + 52 tests existants) doit rester vert.

## Review Focus
- **Build local sans env var** : le HTML produit ne doit contenir aucune trace de GoatCounter (test : assertion d'absence sur les 3 pages quand `GOATCOUNTER_CODE` est absent de l'env du test).
- **Build avec env var** : la balise doit être présente dans les 3 pages ET avec le bon code (test : rebuild avec env, assertion de présence, puis rebuild nu pour restaurer).
- **Reconstruction du dist** : le test qui rebuild avec env doit restaurer un build nu à la fin, sinon les autres tests tournent contre un dist tagué (étape : rebuild `node build.mjs` sans env dans `finally`).
- **Échec d'injection silencieux** : si `GOATCOUNTER_CODE` est posé sur Netlify mais que la balise n'est pas émise, le compteur ne comptera rien — testé par le test de présence ci-dessus.
- **Variable vide/placeholder** : `GOATCOUNTER_CODE=""` ne doit pas émettre une balise cassée (test : balise absente si la variable est vide).

---

### Task 1: Injection conditionnelle de GoatCounter dans `buildHead`

**Files:**
- Modify: `build.mjs:319-360` (`buildHead`)
- Test: `test/build.test.mjs` (ajouts en fin de fichier)

**Interfaces:**
- Produces: balise script GoatCounter en fin de `<head>` quand `process.env.GOATCOUNTER_CODE` est non vide ; aucune balise sinon.

- [ ] **Step 1: Écrire les tests ratants**

En fin de `test/build.test.mjs`, après le dernier test existant :

```js
test('goatcounter absent sans GOATCOUNTER_CODE', () => {
  if (process.env.GOATCOUNTER_CODE) return; // env posée : non applicable
  for (const f of ['index.html', 'en/index.html', 'es/index.html']) {
    const html = page(f);
    assert.ok(!html.includes('goatcounter'), `${f} ne doit pas porter goatcounter sans env`);
    assert.ok(!html.includes('zgo.at'), `${f} ne doit pas référencer zgo.at sans env`);
  }
});

test('goatcounter présent avec GOATCOUNTER_CODE, puis dist restauré', () => {
  const cwd = new URL('..', import.meta.url).pathname;
  try {
    execFileSync('node', ['build.mjs'], {
      cwd,
      env: { ...process.env, GOATCOUNTER_CODE: 'bzftest' },
    });
    for (const f of ['index.html', 'en/index.html', 'es/index.html']) {
      const html = page(f);
      assert.ok(
        html.includes('<script data-goatcounter="https://bzftest.goatcounter.com/count" async src="//gc.zgo.at/count.js"></script>'),
        `${f} doit porter la balise goatcounter`,
      );
    }
  } finally {
    execFileSync('node', ['build.mjs'], { cwd }); // restaure un build nu
  }
});
```

- [ ] **Step 2: Lancer les tests, vérifier l'échec**

Run: `npm run verify`
Expected: le test « goatcounter présent avec GOATCOUNTER_CODE » échoue (balise absente) ; le test « absent sans » passe déjà.

- [ ] **Step 3: Implémenter l'injection dans `buildHead` (`build.mjs`)**

Juste avant `return lines.join('\n');` (fin de `buildHead`, ~ligne 358) :

```js
const gc = (process.env.GOATCOUNTER_CODE || '').trim();
if (gc) {
  lines.push(`<script data-goatcounter="https://${gc}.goatcounter.com/count" async src="//gc.zgo.at/count.js"></script>`);
}
```

Le `trim()` + test de vide couvre `GOATCOUNTER_CODE=""` (variable posée mais vide → aucune balise).

- [ ] **Step 4: Relancer la suite complète**

Run: `npm run verify`
Expected: tous les tests passent (54 : 52 existants + 2 nouveaux).

- [ ] **Step 5: Commit**

```bash
git add build.mjs test/build.test.mjs
git commit -m "Stats : compteur de visites GoatCounter injecte au build via GOATCOUNTER_CODE"
```

---

### Task 2: Étapes manuelles (utilisateur — pas de code)

- [ ] Créer le compte sur goatcounter.com, noter le code (ex. `bzfsteff`).
- [ ] Poser `GOATCOUNTER_CODE=<code>` dans le dashboard Netlify (Site configuration > Environment variables), puis redéployer.
- [ ] Vérifier en ligne : une visite apparaît dans le dashboard GoatCounter.
