#!/usr/bin/env node
/**
 * construire-corpus.mjs — Fusionne la moisson (travail/candidats.json) et le classement
 * (travail/classement/lot-*.json) en un corpus rejouable : un fichier par défaut dans cas/.
 *
 * Ce que le fichier de cas contient, et pourquoi :
 *   — les DEUX commits (cassé = le parent, réparé = le commit lui-même) : c'est la seule
 *     chose dont on a besoin pour refaire la mesure, et c'est infalsifiable par nous ;
 *   — les ancres (fichier, lignes côté AVANT, symboles) : de quoi juger si un signalement
 *     tombe au bon endroit ;
 *   — la famille et le symptôme, écrits en regardant le diff, jamais en regardant l'auditeur ;
 *   — AUCUN code de nos dépôts au-delà de deux lignes de preuve, anonymisées.
 *
 *   node construire-corpus.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DEPOTS } from './moissonner-corpus.mjs';
import { anonymiser, restes } from './anonymiser.mjs';
import { FAMILLES } from '../mesure/familles.mjs';
import { FAMILLES_CORPUS, familleFinale } from './familles-corpus.mjs';
import { TRAVAIL, CLONES } from './atelier.mjs';

const ICI = path.dirname(new URL(import.meta.url).pathname);
const CAS = path.join(ICI, 'cas');

const clone = (nom) => DEPOTS.find((d) => d.nom === nom).clone;
const git = (r, a) => { try { return execFileSync('git', ['-C', r, ...a], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); } catch { return ''; } };

const MOTS_VIDES = new Set(['export', 'const', 'let', 'var', 'async', 'function', 'return', 'if', 'for',
  'await', 'new', 'default', 'class', 'interface', 'type', 'import', 'from', 'args', 'handler', 'ctx', 'db']);

/** Symboles : ce que git met après le @@ (le contexte de fonction) + les définitions supprimées. */
function symboles(repo, c, f) {
  const d = git(repo, ['diff', '-U0', c.parent, c.sha, '--', f]);
  const out = new Set();
  for (const m of d.matchAll(/^@@[^@]*@@\s*(.*)$/gm))
    for (const w of (m[1] || '').matchAll(/[A-Za-z_$][A-Za-z0-9_$]{2,}/g))
      if (!MOTS_VIDES.has(w[0])) out.add(w[0]);
  for (const m of d.matchAll(/^-\s*(?:export\s+)?(?:const|function|async function|let)\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm)) out.add(m[1]);
  return [...out].slice(0, 8);
}

const { cas: candidats, stats } = JSON.parse(fs.readFileSync(path.join(TRAVAIL, 'candidats.json'), 'utf8'));
const classement = [];
for (const f of fs.readdirSync(path.join(TRAVAIL, 'classement')).filter((x) => x.endsWith('.json')).sort())
  classement.push(...JSON.parse(fs.readFileSync(path.join(TRAVAIL, 'classement', f), 'utf8')));

const parId = Object.fromEntries(classement.map((c) => [c.id, c]));
const manquants = candidats.filter((c) => !parId[c.id]).map((c) => c.id);
if (manquants.length) console.log(`⚠ ${manquants.length} candidats non classés : ${manquants.join(', ')}`);

fs.rmSync(CAS, { recursive: true, force: true });
fs.mkdirSync(CAS, { recursive: true });

const ecartes = [];
const nouvelles = {};
let n = 0;
const alertes = [];

for (const c of candidats) {
  const cl = parId[c.id];
  if (!cl) continue;
  if (!cl.retenu) { ecartes.push({ id: c.id, depot: c.depot, motif: cl.motif_ecart || 'non précisé', message: anonymiser(c.message).slice(0, 120) }); continue; }

  const brut = String(cl.famille || '').trim();
  const famille = familleFinale(brut);
  if (!Object.prototype.hasOwnProperty.call(FAMILLES, famille)) {
    nouvelles[famille] = nouvelles[famille] || { nom: famille, definition: FAMILLES_CORPUS[famille] || cl.definition_nouvelle || '', propositions: new Set(), cas: [] };
    nouvelles[famille].cas.push(c.id);
    nouvelles[famille].propositions.add(brut.replace('NOUVELLE:', ''));
  }

  const fiche = {
    id: c.id,
    depot: c.depot,
    provenance: 'historique-git',
    commit_casse: c.parent,
    commit_repare: c.sha,
    date: c.date,
    message_humain: anonymiser(c.message),
    famille,
    famille_proposee: brut,
    familles_secondaires: (cl.familles_secondaires || []).filter(Boolean).map(familleFinale),
    famille_connue: Object.prototype.hasOwnProperty.call(FAMILLES, famille),
    symptome: anonymiser(cl.symptome || ''),
    confiance_classement: cl.confiance || 'moyenne',
    fichiers: c.fichiers,
    fichier_fautif: cl.fichier_fautif || c.fichiers[0],
    lignes_avant: Object.fromEntries(Object.entries(c.ancres).map(([f, a]) => [f, a.map((x) => x.avant)])),
    symboles: Object.fromEntries(c.fichiers.map((f) => [f, symboles(clone(c.depot), c, f)])),
    taille_correctif: c.taille,
    preuve: { avant: anonymiser((cl.preuve_avant || '').slice(0, 160)), apres: anonymiser((cl.preuve_apres || '').slice(0, 160)) },
    rejouer: `git -C ${path.join(CLONES, c.depot)} worktree add --detach <dossier> ${c.parent}`,
  };

  const r = [...restes(JSON.stringify(fiche))];
  if (r.length) alertes.push(`${c.id} : ${r.join(', ')}`);
  fs.writeFileSync(path.join(CAS, c.id + '.json'), JSON.stringify(fiche, null, 2));
  n++;
}

fs.writeFileSync(path.join(CAS, '_ecartes.json'), JSON.stringify(ecartes, null, 2));
fs.writeFileSync(path.join(ICI, 'familles-nouvelles.json'), JSON.stringify(
  Object.values(nouvelles).map((x) => ({ nom: x.nom, definition: x.definition, n: x.cas.length, propositions: [...x.propositions], cas: x.cas })), null, 2));

const parFamille = {};
for (const f of fs.readdirSync(CAS).filter((x) => !x.startsWith('_'))) {
  const j = JSON.parse(fs.readFileSync(path.join(CAS, f), 'utf8'));
  (parFamille[j.famille] = parFamille[j.famille] || []).push(j.id);
}
const parMotif = {};
for (const e of ecartes) parMotif[e.motif] = (parMotif[e.motif] || 0) + 1;

fs.writeFileSync(path.join(ICI, 'classement.json'), JSON.stringify({
  moisson: stats, candidats: candidats.length, retenus: n, ecartes: ecartes.length,
  parMotif, parFamille: Object.fromEntries(Object.entries(parFamille).sort((a, b) => b[1].length - a[1].length).map(([k, v]) => [k, v.length])),
  exemplesParFamille: Object.fromEntries(Object.entries(parFamille).sort((a, b) => b[1].length - a[1].length)),
  famillesNouvelles: Object.values(nouvelles).map((x) => ({ nom: x.nom, definition: x.definition, n: x.cas.length })),
}, null, 2));

console.log(`\nCORPUS CONSTRUIT`);
console.log(`  candidats moissonnés : ${candidats.length}`);
console.log(`  retenus              : ${n}`);
console.log(`  écartés              : ${ecartes.length}   ${Object.entries(parMotif).map(([k, v]) => k + '=' + v).join('  ')}`);
console.log(`\n  CLASSEMENT PAR FRÉQUENCE RÉELLE`);
for (const [f, ids] of Object.entries(parFamille).sort((a, b) => b[1].length - a[1].length))
  console.log(`   ${String(ids.length).padStart(3)}  ${f.padEnd(20)} ${Object.prototype.hasOwnProperty.call(FAMILLES, f) ? '' : '(NOUVELLE) '}${ids.slice(0, 3).join(', ')}`);
if (alertes.length) { console.log(`\n⚠ ANONYMISATION INCOMPLÈTE :`); for (const a of alertes) console.log('   ' + a); }
else console.log(`\n  Anonymisation : aucun nom, courriel ni secret détecté dans les fiches.`);
