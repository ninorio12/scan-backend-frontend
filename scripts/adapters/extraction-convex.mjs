/**
 * extraction-convex.mjs — ce que « une table », « une lecture », « une écriture »
 * veulent dire en Convex.
 *
 * POURQUOI CE FICHIER EXISTE
 *
 * `extraire.mjs` supposait Convex : `defineSchema`, `ctx.db.query`, `ctx.db.insert`
 * étaient écrits dans son corps. Sur un projet Prisma, Drizzle ou Supabase, il ne
 * trouvait donc AUCUNE table et AUCUNE écriture, et tous les juges en aval (lexical,
 * apparier, dialogue) rendaient un zéro souriant. Mesuré le 2026-09-12 : 0 table,
 * 0 écriture, 0 arête sur les trois bancs de `banc/stacks/`.
 *
 * Le savoir de chaque base vit maintenant dans un adaptateur. Celui-ci est Convex,
 * déplacé SANS changement de comportement : le sceau du banc figé doit rester le même
 * avant et après ce déplacement, et c'est la condition qui a été vérifiée.
 */

/** Les huit constructeurs d'une fonction serveur Convex. */
export const KIND_SERVEUR = new Set(['query', 'mutation', 'action', 'internalQuery',
  'internalMutation', 'internalAction', 'httpAction']);

export default {
  nom: 'convex',

  /* Le schéma Convex est un nœud de l'AST (`defineSchema({ … })`), pas un fichier à
     part : il se lit au parcours, pas en pré-passe. */
  prePasse: null,

  schemaAuNoeud(nd, api) {
    const { ts, sf, T, C, L, rel, ajouter, lier, litterauxDe } = api;
    if (!ts.isCallExpression(nd) || T(nd.expression) !== 'defineSchema') return false;
    const arg = nd.arguments[0];
    if (!arg || !ts.isObjectLiteralExpression(arg)) return false;
    for (const p of arg.properties) {
      if (!ts.isPropertyAssignment(p)) continue;
      const table = p.name.getText(sf).replace(/["']/g, '');
      const tEl = ajouter({ classe: 'table', nom: table, fichier: rel, ligne: L(p), entite: table, role: 'stockage' });
      let champsObj = null;
      (function chercher(x) {
        if (ts.isCallExpression(x) && /defineTable$/.test(C(x.expression))) {
          const a = x.arguments[0];
          if (a && ts.isObjectLiteralExpression(a)) champsObj = a;
        }
        if (ts.isCallExpression(x) && /\.index$/.test(C(x.expression))) {
          ajouter({
            classe: 'index', nom: x.arguments[0] && ts.isStringLiteral(x.arguments[0]) ? x.arguments[0].text : '?',
            fichier: rel, ligne: L(x), entite: table, role: 'stockage', champs: litterauxDe(x.arguments[1] || x),
          });
        }
        ts.forEachChild(x, chercher);
      })(p.initializer);
      if (!champsObj) continue;
      for (const c of champsObj.properties) {
        if (!ts.isPropertyAssignment(c)) continue;
        const champ = c.name.getText(sf).replace(/["']/g, '');
        const tt = T(c.initializer);
        const el = ajouter({
          classe: 'champ.schema', nom: champ, fichier: rel, ligne: L(c), entite: table, role: 'stockage',
          typeTexte: tt, optionnel: /v\.optional\(/.test(tt),
          vocabulaire: /v\.union\(/.test(tt) ? litterauxDe(c.initializer) : null,
          source: `${table}.${champ}`,
        });
        lier(tEl.id, el.id, 'contient');
        const fk = tt.match(/v\.id\(["']([^"']+)["']\)/);
        if (fk) lier(el.id, `table:${fk[1]}`, 'reference', { table: fk[1] });
      }
    }
    return true;
  },

  /* Ce que lit une fonction : la table, et ce qui borne la lecture. */
  lecture(cible, x, api) {
    const { ts, sf, T, C, pop } = api;
    if (/ctx\.db\.query$/.test(cible) && x.arguments[0] && ts.isStringLiteral(x.arguments[0])) pop.tables.push(x.arguments[0].text);
    if (/\.withIndex$/.test(cible)) {
      pop.bornes.push(`index:${x.arguments[0] && ts.isStringLiteral(x.arguments[0]) ? x.arguments[0].text : '?'}`);
      if (x.arguments[1]) (function w(y) {
        if (ts.isCallExpression(y) && /\.(eq|gt|gte|lt|lte)$/.test(C(y.expression))) {
          pop.predicats.push({
            champ: y.arguments[0] && ts.isStringLiteral(y.arguments[0]) ? y.arguments[0].text : '?',
            op: C(y.expression).split('.').pop(),
            valeur: (y.arguments[1] ? T(y.arguments[1]) : '').slice(0, 80),
            provenance: 'index',
          });
        }
        ts.forEachChild(y, w);
      })(x.arguments[1]);
    }
    if (/\.take$/.test(cible)) pop.bornes.push(`take:${T(x.arguments[0] || x)}`);
    if (/\.first$/.test(cible)) pop.bornes.push('first');
    if (/\.unique$/.test(cible)) pop.bornes.push('unique');
    if (/\.collect$/.test(cible)) pop.bornes.push('collect');
  },

  /* Les variables qui portent une table : `const b = await ctx.db.get(id)`. */
  variableLocale(x, api) {
    const { ts, T, locales, argsTables } = api;
    if (!ts.isVariableDeclaration(x) || !x.initializer || !ts.isIdentifier(x.name)) return;
    const s = T(x.initializer);
    const m = s.match(/ctx\.db\s*\.?\s*query\(["']([^"']+)["']\)/) || s.replace(/\s+/g, '').match(/ctx\.db\.query\(["']([^"']+)["']\)/);
    if (m) locales.set(x.name.text, m[1]);
    const cast = s.match(/ctx\.db\s*\.?\s*get\([^)]*Id<["']([^"']+)["']>/);
    if (cast) locales.set(x.name.text, cast[1]);
    const g = s.match(/ctx\.db\s*\.?\s*get\(\s*args\.([A-Za-z_$][\w$]*)/);
    if (g && !locales.has(x.name.text) && argsTables.has(`*.${g[1]}`)) locales.set(x.name.text, argsTables.get(`*.${g[1]}`));
  },

  /* Les écritures. Trois formes, et deux subtilités payées cher :
     - `ctx.db.patch(offre.bienId, …)` ne touche pas la table de `offre` mais celle que
       `bienId` désigne (la clé étrangère le dit, on la lit) ;
     - quand la table n'est pas établie, on note les clés SANS les attribuer, pour
       pouvoir s'abstenir plus tard au lieu d'accuser. */
  ecriture(cible, x, api) {
    const { ts, sf, T, L, rel, ajouter, lier, etaler, objetsLocaux, locales, argsTables, entiteDef, fEl } = api;

    if (/ctx\.db\.insert$/.test(cible)) {
      const tbl = x.arguments[0] && ts.isStringLiteral(x.arguments[0]) ? x.arguments[0].text : entiteDef;
      const obj = x.arguments[1];
      if (obj && !ts.isObjectLiteralExpression(obj)) {
        ajouter({ classe: 'ecriture.opaque', nom: `${tbl} <- ${T(obj).slice(0, 40)}`, fichier: rel, ligne: L(x), entite: tbl, role: 'ecriture', porteur: fEl.fq, cles: objetsLocaux.get(T(obj)) || null });
      } else if (obj) {
        for (const p of etaler(ts, sf, obj, objetsLocaux, T)) {
          if (!p.cle) { if (p.opaque) ajouter({ classe: 'ecriture.opaque', nom: `${tbl} <- ...${p.opaque}`, fichier: rel, ligne: L(p.noeud), entite: tbl, role: 'ecriture', porteur: fEl.fq }); continue; }
          const el = ajouter({ classe: 'champ.ecrit', nom: p.cle, fichier: rel, ligne: L(p.noeud), entite: tbl, role: 'ecriture', porteur: fEl.fq, formule: p.formule, source: `${tbl}.${p.cle}`, operation: 'insert' });
          lier(fEl.id, el.id, 'ecrit');
        }
      }
      ajouter({ classe: 'operation.ecriture', nom: `insert:${tbl}`, fichier: rel, ligne: L(x), entite: tbl, role: 'ecriture', porteur: fEl.fq });
      return true;
    }

    if (/ctx\.db\.(patch|replace)$/.test(cible)) {
      const brut = x.arguments[0] ? T(x.arguments[0]) : '';
      const v0 = brut.split(/[.[]/)[0].replace(/[!?\s]/g, '');
      const ref = (brut.match(/\.([A-Za-z_$][\w$]*)$/) || [])[1] || (v0 === 'args' ? brut.split('.').pop() : null);
      const sur = (ref && /Id$/.test(ref) && argsTables.get(`*.${ref}`)) || locales.get(v0);
      const tbl = sur || entiteDef;
      const obj = x.arguments[1];
      if (!sur) {
        const cles = obj && ts.isObjectLiteralExpression(obj) ? etaler(ts, sf, obj, objetsLocaux, T).map((q) => q.cle).filter(Boolean) : ['*'];
        ajouter({ classe: 'ecriture.nonlocalisee', nom: cles.join(','), fichier: rel, ligne: L(x), entite: null, role: 'ecriture', porteur: fEl.fq, cles });
      }
      if (obj && !ts.isObjectLiteralExpression(obj)) {
        ajouter({ classe: 'ecriture.opaque', nom: `${tbl} <- ${T(obj).slice(0, 40)}`, fichier: rel, ligne: L(x), entite: tbl, role: 'ecriture', porteur: fEl.fq, cles: objetsLocaux.get(T(obj)) || null });
      } else if (obj && sur) {
        for (const p of etaler(ts, sf, obj, objetsLocaux, T)) {
          if (!p.cle) { if (p.opaque) ajouter({ classe: 'ecriture.opaque', nom: `${tbl} <- ...${p.opaque}`, fichier: rel, ligne: L(p.noeud), entite: tbl, role: 'ecriture', porteur: fEl.fq }); continue; }
          const el = ajouter({ classe: 'champ.ecrit', nom: p.cle, fichier: rel, ligne: L(p.noeud), entite: tbl, role: 'ecriture', porteur: fEl.fq, formule: p.formule, source: `${tbl}.${p.cle}`, operation: 'patch' });
          lier(fEl.id, el.id, 'ecrit');
        }
      }
      return true;
    }

    if (/ctx\.db\.delete$/.test(cible)) {
      const v0 = x.arguments[0] ? T(x.arguments[0]).split(/[.[]/)[0].replace(/[!?\s]/g, '') : '';
      ajouter({ classe: 'operation.suppression', nom: `delete:${locales.get(v0) || entiteDef}`, fichier: rel, ligne: L(x), entite: locales.get(v0) || entiteDef, role: 'ecriture', porteur: fEl.fq });
      return true;
    }

    return false;
  },
};
