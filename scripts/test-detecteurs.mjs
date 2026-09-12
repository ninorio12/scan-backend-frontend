#!/usr/bin/env node
/**
 * test-detecteurs.mjs — Le test du testeur.
 *
 * Ce skill reproche aux autres de livrer sans preuve. Il lui faut donc la sienne :
 * un repo piège (fixtures/repo-piege) qui contient exactement un exemplaire de chaque
 * défaut connu, et ce script qui vérifie que chaque détecteur le trouve.
 *
 * Sans ça, une « amélioration » d'un détecteur peut en casser un autre sans que rien
 * ne le signale : exactement la panne silencieuse que le skill traque ailleurs.
 *
 *   node test-detecteurs.mjs        → vérifie tout, sort en code 1 si un détecteur dort
 *   node test-detecteurs.mjs -v     → montre ce que chaque détecteur a réellement trouvé
 */

import path from 'node:path';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const PIEGE = path.join(HERE, '..', 'fixtures', 'repo-piege');
const VERBEUX = process.argv.includes('-v');

// Ce que le repo piège contient, et donc ce que chaque détecteur DOIT trouver.
const ATTENDU = [
  ['A1', /listeMorte/, 'fonction que rien n\'appelle'],
  ['A2', /ecrite_jamais_lue|journal/, 'table orpheline'],
  ['A3', /champJamaisUtilise/, 'champ de schéma inutilisé'],
  ['A4', /fonctionDisparue/, 'cron visant une cible disparue'],
  ['B1', /listeMorte/, 'fonction publique sans garde'],
  ['C1', /leads\.ts/, 'panne masquée par un catch muet'],
  ['C2', /leads\.ts/, 'écriture sans await'],
  ['C6', /leads/, 'collecte non bornée'],
  ['D1', /Sophie/, 'champ pré-rempli en dur'],
  ['D2', /Enregistr/i, 'action qui annonce un succès sans écrire'],
  ['D6', /Exporter|button/, 'bouton sans action'],
  ['D7', /1 247|87/, 'chiffre affiché en dur'],
  ['E1', /syncQuotidien/, 'cron visant une fonction gardée'],
  ['E2', /leads/, 'table à discriminant lue sans filtre'],
  ['E3', /ALL_MODULES|NAV_PAGES/, 'registres parallèles désynchronisés'],
  ['E4', /en_cours/, 'valeur hors du vocabulaire déclaré'],
  ['E6', /leads/, 'données de démonstration comptées comme réelles'],
];

function auditer() {
  try {
    return JSON.parse(execFileSync('node', [path.join(HERE, 'audit-backend.mjs'), PIEGE, '--json', '--full'],
      { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));
  } catch (e) {
    if (e.stdout) return JSON.parse(e.stdout);
    console.error('Audit impossible sur le repo piège :\n' + (e.stderr || e.message));
    process.exit(2);
  }
}

const audit = auditer();
const parRegle = new Map(audit.findings.map((f) => [f.id, f.items]));

console.log(`\n╔══ TEST DES DÉTECTEURS ─ repo piège`);
console.log(`╚══ ${ATTENDU.length} défauts plantés, ${audit.findings.length} règles ont parlé\n`);

let dorment = 0, aveugles = 0;
for (const [regle, motif, quoi] of ATTENDU) {
  const items = parRegle.get(regle);
  if (!items || !items.length) {
    console.log(`  ✗ ${regle.padEnd(4)} MUET        ${quoi}`);
    dorment++;
    continue;
  }
  const trouve = items.some((i) => motif.test(i));
  if (!trouve) {
    console.log(`  ~ ${regle.padEnd(4)} À CÔTÉ      ${quoi}`);
    console.log(`         a trouvé : ${items.slice(0, 2).join(' | ').slice(0, 100)}`);
    aveugles++;
    continue;
  }
  console.log(`  ✓ ${regle.padEnd(4)} ${String(items.length).padStart(3)} trouvé(s)  ${quoi}`);
  if (VERBEUX) for (const i of items.slice(0, 3)) console.log(`         ${i}`);
}

// Le revers : ce que les détecteurs signalent et qu'on n'a PAS planté volontairement.
const attenduIds = new Set(ATTENDU.map(([id]) => id));
const enTrop = audit.findings.filter((f) => !attenduIds.has(f.id) && f.items.length);
if (enTrop.length) {
  console.log(`\n  Signalé en plus (à vérifier : soit un défaut réel du piège, soit un faux positif) :`);
  for (const f of enTrop) console.log(`    ${f.id} ${f.titre.replace(/ \(.*/, '')} — ${f.items.length}`);
}

console.log(`\n${dorment || aveugles
  ? `⚠️  ${dorment} détecteur(s) muet(s), ${aveugles} qui trouvent autre chose. Le skill a une régression.`
  : '✓ Tous les détecteurs attrapent leur défaut.'}\n`);
process.exitCode = dorment || aveugles ? 1 : 0;
