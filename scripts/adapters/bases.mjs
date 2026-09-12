/**
 * bases.mjs — quelle base de données ce dépôt utilise-t-il, et comment le dire.
 *
 * POURQUOI CE FICHIER EXISTE
 *
 * Un organe qui n'a rien compris doit pouvoir le DIRE avec le nom de ce qu'il n'a pas
 * compris. « Rien à signaler » sur un projet Prisma dont l'extracteur ne connaît que
 * Convex est un mensonge ; « je n'ai reconnu aucune table dans ce projet (base Prisma) »
 * est un aveu utilisable. La différence tient à ce fichier : il donne le mot.
 *
 * Ce n'est PAS un adaptateur au sens de `audit-backend.mjs` (il n'a pas de `detect(ctx)`
 * ni d'`units()`), c'est une aide partagée. Le chargeur d'adaptateurs l'ignore.
 */
import fs from 'node:fs';
import path from 'node:path';

const lire = (racine, p) => { try { return fs.readFileSync(path.join(racine, p), 'utf8'); } catch { return null; } };
const existe = (racine, p) => fs.existsSync(path.join(racine, p));

/** Cherche un fichier correspondant au motif, sans descendre dans node_modules. */
function trouve(racine, re, profondeur = 3) {
  const pile = [{ d: racine, p: 0 }];
  while (pile.length) {
    const { d, p } = pile.shift();
    let e2; try { e2 = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of e2) {
      if (/^(node_modules|\.git|\.next|dist|build)$/.test(e.name)) continue;
      const f = path.join(d, e.name);
      if (e.isDirectory()) { if (p < profondeur) pile.push({ d: f, p: p + 1 }); }
      else if (re.test(e.name)) return path.relative(racine, f);
    }
  }
  return null;
}

/**
 * Le nom lisible de la base du dépôt, pour un message d'erreur honnête.
 * Plusieurs bases peuvent cohabiter : on les nomme toutes, dans l'ordre trouvé.
 */
export function baseDetectee(racine) {
  let pkg = {};
  try { pkg = JSON.parse(lire(racine, 'package.json') || '{}'); } catch { /* package.json illisible */ }
  const dep = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const noms = [];

  if (dep.convex || existe(racine, 'convex/schema.ts') || existe(racine, 'src/convex/schema.ts')) noms.push('Convex');
  if (dep['@prisma/client'] || dep.prisma || existe(racine, 'prisma/schema.prisma') || trouve(racine, /\.prisma$/)) noms.push('Prisma');
  if (dep['drizzle-orm'] || existe(racine, 'drizzle/schema.ts') || existe(racine, 'src/db/schema.ts') || existe(racine, 'db/schema.ts')) noms.push('Drizzle');
  if (dep['@supabase/supabase-js'] || dep['@supabase/ssr'] || existe(racine, 'supabase')) noms.push('Supabase');
  if (!noms.length && (dep.pg || dep.mysql2 || dep.knex || dep.kysely || trouve(racine, /\.sql$/))) noms.push('SQL brut');
  if (!noms.length && (dep.mongoose || dep.mongodb)) noms.push('MongoDB');

  return noms.length ? noms.join(' + ') : 'non reconnue';
}

/**
 * Le refus de conclure, en une seule formulation partagée.
 *
 * Un « 0 » qui vient d'une extraction vide n'est jamais un résultat : c'est une panne de
 * lecture. Tout organe dont le travail dépend d'avoir compris la base appelle ceci, sort
 * en code 2, et ne prétend rien.
 */
export function refuser(quoi, racine, précision = '') {
  const base = baseDetectee(racine);
  console.error(`\n  ⛔  ${path.basename(racine)} — je n'ai reconnu aucune ${quoi} dans ce projet ` +
    `(base ${base}) : je ne peux rien dire, ce n'est pas un rapport propre.`);
  if (précision) console.error(`      ${précision}`);
  console.error(`      Un « 0 » qui vient d'une extraction vide n'est pas « rien à signaler ».\n`);
  process.exit(2);
}
