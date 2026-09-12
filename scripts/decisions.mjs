#!/usr/bin/env node
/**
 * decisions.mjs — ce que la machine ne peut pas deviner, on le demande. Une fois.
 *
 *     node decisions.mjs <repo>              prépare les questions à poser
 *     node decisions.mjs <repo> --verifier   contrôle le code contre les réponses
 *
 * POURQUOI
 *
 * L'outil sait dire que « rendez-vous » est lu depuis quatre sources différentes. Il ne
 * sait pas laquelle est la bonne : c'est une décision métier, pas un fait technique.
 * Deviner serait pire que se taire, parce qu'on corrigerait vers la mauvaise source.
 *
 * Alors on demande. UNE fois. Et la réponse devient une règle : à partir de là, toute
 * lecture ailleurs que dans la source déclarée est un défaut, et l'outil le dit à chaque
 * passage. C'est le renversement : une question posée une fois vaut un détecteur pour
 * toujours.
 *
 * Les réponses vivent dans `<repo>/.backend/decisions.json`, versionné avec le projet :
 *
 *   { "rdv":     { "source": "rendezVous",   "decide": "2026-09-12", "par": "Thomas" },
 *     "contact": { "source": "crm_contacts", "decide": "2026-09-12", "par": "Thomas" } }
 *
 * CE QUE CE FICHIER NE FAIT PAS : poser les questions lui-même. Il les PRÉPARE, avec
 * pour chacune les sources candidates, leur poids, et où elles sont lues. C'est l'agent
 * qui les pose à l'humain, en une fois, et qui écrit les réponses.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const ICI = path.dirname(new URL(import.meta.url).pathname);
const RACINE = path.resolve(process.argv[2] || '.');
const a = (n) => process.argv.includes(n);
const FICHIER = path.join(RACINE, '.backend', 'decisions.json');

const decisions = (() => { try { return JSON.parse(fs.readFileSync(FICHIER, 'utf8')); } catch { return {}; } })();

/* On relance l'analyse des liens logiques pour avoir les conflits à jour. */
const tmp = path.join(os.tmpdir(), `lex-${process.pid}.json`);
try {
  execFileSync('node', [path.join(ICI, 'lexical.mjs'), RACINE, '--json', tmp],
    { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, timeout: 600000, stdio: 'ignore' });
} catch { /* code 1 = des conflits, c'est normal */ }
let L; try { L = JSON.parse(fs.readFileSync(tmp, 'utf8')); } catch { L = { sourcesMultiples: [], sansProprietaire: [] }; }
try { fs.unlinkSync(tmp); } catch { /* déjà parti */ }

/* ── Mode vérification : le code respecte-t-il ce qui a été décidé ? ────────── */

if (a('--verifier')) {
  const manquements = [];
  for (const c of L.sourcesMultiples) {
    const d = decisions[c.concept];
    if (!d) continue;                       // pas encore tranché : ce n'est pas un manquement
    for (const s of c.sources) {
      if (s.table === d.source) continue;
      manquements.push({ concept: c.concept, attendu: d.source, trouve: s.table, n: s.n, ou: s.ou });
    }
  }
  console.log(`\n  DÉCISIONS — ${path.basename(RACINE)}`);
  console.log(`  ${'-'.repeat(72)}`);
  console.log(`  ${Object.keys(decisions).length} concept(s) tranché(s) · ${manquements.length} lecture(s) hors source déclarée\n`);
  for (const m of manquements) {
    console.log(`  « ${m.concept} » doit venir de ${m.attendu}, mais ${m.n} lecture(s) prennent ${m.trouve}`);
    for (const o of (m.ou || []).slice(0, 3)) console.log(`      ${o}`);
  }
  if (!manquements.length && Object.keys(decisions).length) console.log('  Tout le code respecte les sources déclarées.\n');
  if (!Object.keys(decisions).length) console.log('  Aucune décision prise. Lancer sans --verifier pour préparer les questions.\n');
  process.exitCode = manquements.length ? 1 : 0;
  process.exit();
}

/* ── Mode préparation : les questions à poser ───────────────────────────────── */

const questions = [];
for (const c of L.sourcesMultiples) {
  if (decisions[c.concept]) continue;       // déjà tranché
  questions.push({
    concept: c.concept,
    question: `Dans ce produit, « ${c.concept} » est lu depuis ${c.sources.length} endroits différents. Lequel fait foi ?`,
    options: c.sources.slice(0, 4).map((s) => ({
      source: s.table, lectures: s.n, exemple: s.ou?.[0] || '',
    })),
  });
}
for (const d of L.sansProprietaire.slice(0, 6)) {
  const cle = `proprietaire:${d.table}`;
  if (decisions[cle]) continue;
  questions.push({
    concept: cle,
    question: `La table « ${d.table} » est écrite depuis ${d.locataires.length + 1} modules. Lequel doit en être le seul propriétaire ?`,
    options: [d.proprietaire, ...d.locataires].filter(Boolean).slice(0, 4)
      .map((m) => ({ source: path.basename(m), lectures: null, exemple: m })),
  });
}

console.log(`\n  QUESTIONS À POSER — ${path.basename(RACINE)}`);
console.log(`  ${'-'.repeat(72)}`);
if (!questions.length) {
  console.log(`\n  Aucune. ${Object.keys(decisions).length} concept(s) déjà tranché(s), et rien de nouveau.\n`);
} else {
  console.log(`  ${questions.length} décision(s) que la machine ne peut pas prendre seule.\n`);
  for (const [i, q] of questions.entries()) {
    console.log(`  ${i + 1}. ${q.question}`);
    for (const o of q.options) {
      console.log(`       ${o.source.padEnd(24)}${o.lectures ? `${o.lectures} lectures` : ''}   ${o.exemple}`);
    }
    console.log();
  }
  console.log(`  Écrire les réponses dans ${FICHIER} :`);
  console.log(`    { "<concept>": { "source": "<table>", "decide": "${new Date().toISOString().slice(0, 10)}", "par": "<qui>" } }`);
  console.log(`  Puis « --verifier » signale à chaque passage toute lecture hors de la source déclarée.\n`);
}

fs.mkdirSync(path.dirname(FICHIER), { recursive: true });
fs.writeFileSync(path.join(RACINE, '.backend', 'questions.json'), JSON.stringify(questions, null, 1));
process.exitCode = questions.length ? 1 : 0;
