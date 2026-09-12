#!/usr/bin/env node
/**
 * scan.mjs : le scan du code, en une commande.
 *
 *     node scan.mjs <repo>              le scan complet, rapport lisible
 *     node scan.mjs <repo> --full       sans troncature (tous les endroits, pas 3 par règle)
 *     node scan.mjs <repo> --json f     + le détail machine copié là
 *     node scan.mjs <repo> --vite       le scanner seul, sans le jugement
 *
 * C'est le maillon « code » de la chaîne ; la chaîne entière (reconnaissance, code,
 * écrans, base, bilan) est `couverture.mjs`, et le verdict final est `bilan.mjs`.
 *
 * CE QU'IL FAIT, DANS L'ORDRE
 *
 *   1. LE SCANNER voit : les règles d'audit-backend.mjs désignent les endroits suspects.
 *   2. L'APPARIEUR juge. Il ne cherche pas des bugs (liste infinie), il cherche des
 *      choses qui auraient dû être d'accord et ne le sont pas. SEPT attributs
 *      d'accord : existence, source, formule, vocabulaire, unité, population, garde.
 *      Un seul qui diverge fait le défaut, et la liste est FERMÉE.
 *   3. LE RAPPORT classe. Ce que l'apparieur sait expliquer monte en tête, en français,
 *      avec les deux bouts du désaccord. Le reste descend mais ne disparaît jamais.
 *
 * LA RÈGLE QUI TIENT TOUT, payée par une mesure : l'apparieur n'a pas le droit de
 * SUPPRIMER un signalement, seulement de le CLASSER. Une version qui le laissait écarter
 * ce qu'il jugeait sain a fait chuter le rappel de plus de moitié. Le silence d'un juge
 * n'est pas un acquittement. Le rappel courant se mesure, il ne se cite pas :
 * `node banc/mesure/mesurer.mjs --fige`.
 *
 * CE QU'IL NE FAIT PAS : il lit le code, il ne fait pas tourner le produit. La moitié
 * de ce qui casse chez un client ne se voit pas dans le code (une clé expirée, un écran
 * qui ment quand la liste est vide). Pour ça : couverture.mjs, et les agents du parcours
 * réel (`references/parcours-reel.md`).
 *
 * CE QU'IL ÉCRIT : `<repo>/.backend/dialogue.json` (le détail machine).
 * CODES DE SORTIE : 0 rien de compris comme défaut · 1 des désaccords · 2 le scan n'a pas pu tourner.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { dossierBackend } from './dossier-backend.mjs';

const ICI = path.dirname(new URL(import.meta.url).pathname);
const RACINE = path.resolve(process.argv[2] || '.');
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const a = (n) => process.argv.includes(n);

if (!fs.existsSync(RACINE)) {
  console.error(`Dépôt introuvable : ${RACINE}`);
  process.exit(2);
}

const lancer = (script, args) => {
  try {
    return execFileSync('node', [path.join(ICI, script), RACINE, ...args],
      { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 900000 });
  } catch (e) { return e.stdout || ''; }   // code 1 = défauts trouvés, c'est normal
};

/* ── Mode rapide : le scanner seul, quand on veut juste savoir si ça a bougé ── */
if (a('--vite')) {
  process.stdout.write(lancer('audit-backend.mjs', a('--full') ? ['--full'] : []));
  process.exit(0);
}

/* ── Le scan complet ─────────────────────────────────────────────────────────── */

const D = dossierBackend(RACINE);
const brut = path.join(D, 'dialogue.json');

console.log(`\n  SCAN BACKEND · ${path.basename(RACINE)}`);
console.log(`  ${'='.repeat(72)}`);

const sortie = lancer('dialogue.mjs', ['--json', brut]);
/* On ne garde du dialogue que son tableau de bord (jusqu'à la ligne « temps ») :
   sa liste de constats est reformatée plus bas, la réafficher ferait doublon. */
const lignes = sortie.split('\n');
const fin = lignes.findIndex((l) => l.trim().startsWith('temps'));
console.log(lignes.slice(1, fin > 0 ? fin + 1 : 12).join('\n'));

let R;
try { R = JSON.parse(fs.readFileSync(brut, 'utf8')); }
catch {
  console.error('  ⛔ Le dialogue n\'a pas produit de résultat exploitable : le scan n\'a pas tourné.');
  console.error('     Cause fréquente : `typescript` introuvable (node_modules du projet absent). Voir README.');
  process.exit(2);
}

/* ── Le rapport : ce qui est compris d'abord, le reste ensuite ──────────────── */

const compris = (R.constats || []).filter((c) => c.reponse === 'DÉSACCORD' || c.reponse === 'SEUL');
const reste = (R.constats || []).filter((c) => c.reponse !== 'DÉSACCORD' && c.reponse !== 'SEUL');
const PLAFOND = a('--full') ? Infinity : 3;

if (compris.length) {
  console.log(`\n  CE QU'ON COMPREND  (${compris.length})`);
  console.log(`  ${'-'.repeat(72)}`);
  for (const c of compris) {
    console.log(`\n  ${c.titre || c.texte}`);
    console.log(`    ${c.ou || `${c.fichier}:${c.ligne}`}`);
    if (c.detail) console.log(`    ${c.detail}`);
    for (const j of (c.jumeaux || []).slice(0, a('--full') ? 50 : 3)) console.log(`    ↔ ${j}`);
  }
}

/* Le reste est regroupé PAR RÈGLE et plafonné à 3 endroits (sauf --full) : sortir 207
   lignes pour une seule décision d'architecture garantit que le rapport ne sera pas lu. */
if (reste.length) {
  const parRegle = new Map();
  for (const c of reste) {
    const k = c.regle || 'autre';
    if (!parRegle.has(k)) parRegle.set(k, []);
    parRegle.get(k).push(c);
  }
  console.log(`\n\n  À REGARDER, PAS ENCORE EXPLIQUÉ  (${reste.length})`);
  console.log(`  ${'-'.repeat(72)}`);
  for (const [regle, l] of [...parRegle].sort((x, y) => y[1].length - x[1].length)) {
    console.log(`\n  ${regle} · ${l.length} endroit${l.length > 1 ? 's' : ''}`);
    for (const c of l.slice(0, PLAFOND)) console.log(`    ${c.ou || `${c.fichier}:${c.ligne}`}  ${(c.titre || c.texte || '').slice(0, a('--full') ? 400 : 90)}`);
    if (l.length > PLAFOND) console.log(`    … et ${l.length - PLAFOND} autres (--full pour tout voir)`);
  }
}

const j = arg('--json', null);
if (j && path.resolve(j) !== brut) fs.copyFileSync(brut, path.resolve(j));

console.log(`\n  Détail machine : ${brut}\n`);
process.exitCode = compris.length ? 1 : 0;
