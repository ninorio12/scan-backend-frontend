/**
 * atelier.mjs : où vivent les clones et le dossier de travail du corpus.
 *
 * POURQUOI CE FICHIER EXISTE
 *
 * Le corpus se construit à partir de clones complets de nos dépôts (90 Mo) et d'un
 * dossier de travail (2 Mo de worktrees, journaux et lots de classement). Ni l'un ni
 * l'autre n'a sa place dans le dossier du skill :
 *
 *   1. Ils contiennent du code de nos dépôts, et ce skill se publie.
 *   2. Un dossier de skill au-dessus de 8 Mo est REFUSÉ par le linter officiel
 *      (mesuré le 12/09/2026 : 8 391 731 octets, soit 3 123 de trop). Un skill que le
 *      linter refuse est un skill qui peut ne jamais être chargé.
 *
 * Ce qui reste dans le dépôt, c'est le corpus lui-même : `cas/` (la vérité terrain,
 * anonymisée), les scripts, les résultats. 772 Ko, rejouables.
 *
 * OÙ : par défaut `<parent du skill>/scan-backend-frontend-archives/corpus/`, à côté du
 * skill et jamais dedans. `CORPUS_ATELIER=/un/autre/chemin` le déplace.
 */

import path from 'node:path';
import fs from 'node:fs';

const ICI = path.dirname(new URL(import.meta.url).pathname);
const RACINE_SKILL = path.resolve(ICI, '..', '..');

export const ATELIER = process.env.CORPUS_ATELIER
  ? path.resolve(process.env.CORPUS_ATELIER)
  : path.resolve(RACINE_SKILL, '..', path.basename(RACINE_SKILL) + '-archives', 'corpus');

export const CLONES = path.join(ATELIER, 'clones');
export const TRAVAIL = path.join(ATELIER, 'travail');

/** Crée le dossier au besoin et le rend. À n'appeler que quand on va vraiment écrire. */
export function atelier(sous = '') {
  const p = sous ? path.join(ATELIER, sous) : ATELIER;
  fs.mkdirSync(p, { recursive: true });
  return p;
}
