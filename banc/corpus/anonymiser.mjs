/**
 * anonymiser.mjs — Le corpus sort de NOS dépôts : messages de commit et lignes de code y
 * portent des noms de clients, des adresses, parfois une clé. Rien de tout cela ne doit
 * survivre dans banc/corpus/cas/.
 *
 * Trois passes, dans cet ordre (la plus spécifique d'abord) :
 *   1. secrets et identifiants techniques (clés, jetons, longs hexadécimaux) ;
 *   2. coordonnées (courriel, téléphone) ;
 *   3. noms propres de personnes et de sociétés clientes, liste tenue à la main.
 *
 * La liste de noms est relue à l'œil : un scrubber automatique qui devine les noms propres
 * effacerait « Convex » et « Clerk », qui sont de l'information technique utile.
 */

/* LA LISTE DES NOMS NE VIT PAS DANS LE DÉPÔT. Ce sont des noms de personnes réelles :
   les écrire ici pour les effacer ailleurs, c'est les publier. Elle est relue à l'œil
   (un scrubber automatique effacerait « Convex » et « Clerk », qui sont de l'information
   technique utile), donc elle se tient à la main, dans un fichier ignoré par git :

       banc/corpus/noms-locaux.json     ["Prénom", "Nom", "Société cliente", …]

   Sans ce fichier, l'anonymiseur fait quand même les deux premières passes (secrets et
   coordonnées) et le DIT : `NOMS.length === 0` et `restes()` ne peut plus juger des noms.
   Il ne fabrique jamais une expression vide, qui, elle, remplacerait tout. */
import fs from 'node:fs';
import path from 'node:path';

const FICHIER_NOMS = path.join(path.dirname(new URL(import.meta.url).pathname), 'noms-locaux.json');
export const NOMS = (() => {
  try {
    const l = JSON.parse(fs.readFileSync(FICHIER_NOMS, 'utf8'));
    return Array.isArray(l) ? l.filter((x) => typeof x === 'string' && x.trim().length > 1) : [];
  } catch { return []; }
})();
if (!NOMS.length) {
  console.error(`  ⚠️  ${path.basename(FICHIER_NOMS)} absent ou vide : les noms propres ne seront PAS anonymisés.`);
  console.error(`     Y poser la liste des noms à effacer (un tableau JSON de chaînes) avant de construire le corpus.`);
}

const RE_NOMS = NOMS.length ? new RegExp('\\b(' + NOMS.join('|') + ')\\b', 'gi') : null;

export function anonymiser(texte) {
  if (!texte) return texte;
  let t = String(texte);
  t = t.replace(/\b(sk|pk|rk|whsec|xoxb|ghp|glpat)[-_][A-Za-z0-9_-]{8,}/g, '$1_SECRET');
  t = t.replace(/\b[A-Fa-f0-9]{32,}\b/g, 'IDENTIFIANT');
  t = t.replace(/\b(Bearer|token|apiKey|api_key)\s*[:=]\s*["']?[A-Za-z0-9._-]{12,}/gi, '$1 SECRET');
  t = t.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, 'courriel@exemple.test');
  t = t.replace(/(\+\d{1,3}[\s.-]?)?(\(?\d{2,3}\)?[\s.-]?){3,5}\d{2,4}/g, (m) =>
    (m.replace(/\D/g, '').length >= 9 ? '00 00 00 00 00' : m));
  if (RE_NOMS) t = t.replace(RE_NOMS, 'CLIENT');
  return t;
}

/** Contrôle de sortie : rend les motifs interdits encore présents dans un texte. */
export function restes(texte) {
  const t = String(texte || '');
  const trouves = [];
  if (!RE_NOMS) trouves.push('noms non vérifiés (liste absente)');
  else { if (RE_NOMS.test(t)) trouves.push('nom'); RE_NOMS.lastIndex = 0; }
  if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(t)) trouves.push('courriel');
  if (/\b(sk|pk|whsec|xoxb|ghp)[-_][A-Za-z0-9_-]{8,}/.test(t)) trouves.push('secret');
  return trouves;
}
