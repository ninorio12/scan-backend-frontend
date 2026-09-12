#!/usr/bin/env node
/**
 * dossiers.mjs — Écrit, pour chaque candidat moissonné, le dossier qu'il faut lire pour le
 * classer : le message humain, et le diff des fichiers backend/câblage.
 *
 * Les dossiers vivent dans travail/ (jamais publié) : ils contiennent du code de nos dépôts.
 * Le corpus livré, lui, ne garde que des ancres (dépôt, commit, fichier, lignes) et une
 * phrase anonymisée.
 *
 *   node dossiers.mjs             → travail/dossiers/lot-1.md … lot-N.md
 *   node dossiers.mjs --par=24    → taille des lots
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DEPOTS } from './moissonner-corpus.mjs';
import { TRAVAIL, CLONES } from './atelier.mjs';

const ICI = path.dirname(new URL(import.meta.url).pathname);
const ARG = (n, d) => { const f = process.argv.find((a) => a.startsWith('--' + n + '=')); return f ? f.split('=')[1] : d; };
const PAR = Number(ARG('par', 24));

const clone = (nom) => DEPOTS.find((d) => d.nom === nom).clone;
const git = (r, a) => { try { return execFileSync('git', ['-C', r, ...a], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); } catch (e) { return String(e.message); } };

const { cas } = JSON.parse(fs.readFileSync(path.join(TRAVAIL, 'candidats.json'), 'utf8'));
fs.mkdirSync(path.join(TRAVAIL, 'dossiers'), { recursive: true });

let lot = [], n = 0;
const ecrire = () => {
  if (!lot.length) return;
  n++;
  fs.writeFileSync(path.join(TRAVAIL, 'dossiers', `lot-${n}.md`), lot.join('\n'));
  lot = [];
};

for (const c of cas) {
  const d = git(clone(c.depot), ['diff', '-U3', c.parent, c.sha, '--', ...c.fichiers]).slice(0, 9000);
  lot.push([
    `\n\n========== CAS ${c.id} ==========`,
    `dépôt: ${c.depot}   date: ${c.date}   lignes changées: ${c.taille.total} (+${c.taille.ajoutees}/-${c.taille.supprimees})`,
    `message: ${c.message}`,
    c.corps ? `corps: ${c.corps.replace(/\n/g, ' | ').slice(0, 400)}` : '',
    `fichiers: ${c.fichiers.join(', ')}`,
    '--- diff ---',
    d,
  ].filter(Boolean).join('\n'));
  if (lot.length >= PAR) ecrire();
}
ecrire();
console.log(`${cas.length} cas répartis en ${n} lots dans travail/dossiers/`);
