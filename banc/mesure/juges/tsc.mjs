#!/usr/bin/env node
/**
 * juges/tsc.mjs — Le juge extérieur qui tranche pour de vrai.
 *
 * Le compilateur TypeScript n'a pas été écrit par nous, ne connaît pas nos règles, et ne
 * se laisse pas amadouer. Il répond à une question précise :
 *
 *     ce défaut est-il DÉJÀ attrapé par un outil que le projet exécute de toute façon ?
 *
 * Deux usages, et les deux comptent :
 *   1. DÉLIMITER LE TERRITOIRE. Un défaut que tsc signale n'appartient pas au domaine du
 *      skill : il est déjà couvert, gratuitement, avant lui. Le compter au rappel
 *      gonflerait le chiffre sans rien apporter au client.
 *   2. VALIDER LES MUTATIONS. Une mutation qui casse la compilation n'est pas un défaut de
 *      câblage, c'est une faute de frappe : elle n'a rien à faire au banc.
 *
 *   node juges/tsc.mjs <repo> [--motifs=ville,journal,...]
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const repo = path.resolve(process.argv[2] || '.');
const motifs = ((process.argv.find((a) => a.startsWith('--motifs=')) || '').split('=')[1] || '').split(',').filter(Boolean);
const t0 = Date.now();

const bin = ['node_modules/.bin/tsc', '../node_modules/.bin/tsc'].map((p) => path.join(repo, p)).find((p) => fs.existsSync(p));
let sortie = '';
try { execFileSync(bin || 'tsc', ['--noEmit', '--skipLibCheck', '-p', repo], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 600000 }); }
catch (e) { sortie = (e.stdout || '') + (e.stderr || ''); }

const erreurs = sortie.split('\n').filter((l) => /error TS\d+/.test(l));
const parCode = {};
for (const l of erreurs) { const c = (l.match(/error (TS\d+)/) || [])[1]; parCode[c] = (parCode[c] || 0) + 1; }

console.log(`\nJUGE EXTÉRIEUR — tsc --noEmit sur ${repo}   (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
console.log(`  ${erreurs.length} erreur(s) de type`);
for (const [c, n] of Object.entries(parCode).sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(4)} × ${c}`);
if (motifs.length) {
  const re = new RegExp(motifs.join('|'), 'i');
  const touchent = erreurs.filter((l) => re.test(l));
  console.log(`\n  Erreurs qui nomment un des défauts de câblage connus (${motifs.join(', ')}) : ${touchent.length}`);
  console.log(touchent.length
    ? '  → ces défauts-là sont déjà couverts par le compilateur, ils sortent du territoire du skill.'
    : '  → AUCUNE. Le compilateur ne voit rien de ces défauts : le territoire du skill existe, et il est disjoint du sien.');
}
console.log('');
