#!/usr/bin/env node
/**
 * reparer.mjs — le point d'entrée de la réparation.
 *
 * L'ANCIEN reparer.mjs A ÉTÉ RETIRÉ DU SKILL PARCE QU'IL MENTAIT : il promettait de
 * réparer et n'écrivait qu'un fichier d'état, sans modifier une ligne de code. Celui-ci
 * ne fait rien lui-même — il n'a rien à faire : il appelle `reparation/boucle.mjs`, qui
 * est la machine. Un point d'entrée qui réimplémente la machine est la deuxième source
 * de vérité qu'on passe son temps à traquer ailleurs.
 *
 * L'ORDRE DES CHOSES, et il n'est pas négociable :
 *   1. le scan a tourné et a écrit `<repo>/.backend/` (BILAN.md + les JSON) ;
 *   2. le dépôt est un dépôt git, propre : la boucle impose les baux par worktree ;
 *   3. on travaille sur une COPIE. Un correctif se livre en diff, jamais appliqué
 *      d'autorité sur le dépôt d'un client.
 *
 *   node scripts/reparer.mjs <repo>                 → prépare et montre les lots
 *   node scripts/reparer.mjs <repo> --tourner       → la boucle entière, sans main humaine
 *   node scripts/reparer.mjs <repo> --tourner --lots=3 --essais=1
 *
 * Codes de sortie, comme partout dans le skill : 0 rien à signaler · 1 des défauts
 * restent · 2 le travail n'a pas pu être fait, et on dit pourquoi.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ICI = path.dirname(new URL(import.meta.url).pathname);
const BOUCLE = path.resolve(ICI, '..', 'reparation', 'boucle.mjs');
const RACINE = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : '.');
const RESTE = process.argv.slice(2).filter((a) => a.startsWith('--') && a !== '--tourner');
const TOURNER = process.argv.includes('--tourner');

const stop = (n, ...l) => { for (const x of l) console.error(x); process.exit(n); };

if (!fs.existsSync(RACINE)) stop(2, `Dépôt introuvable : ${RACINE}`);
if (!fs.existsSync(path.join(RACINE, '.backend', 'BILAN.md'))) {
  stop(2, `Pas de bilan dans ${RACINE}/.backend/.`,
    `La réparation part du bilan, jamais d'une liste écrite à la main. Lancer d'abord :`,
    `  node ${path.relative(process.cwd(), path.join(ICI, 'couverture.mjs'))} ${RACINE} --url http://localhost:3000`);
}
if (!fs.existsSync(path.join(RACINE, '.git'))) {
  stop(2, `${RACINE} n'est pas un dépôt git.`,
    `La boucle impose les périmètres par worktree : sans git, deux lots peuvent s'écraser`,
    `et rien ne le détecterait. Sur une copie de travail : git init && git add -A && git commit -m base`);
}

const r = spawnSync('node', [BOUCLE, RACINE, TOURNER ? 'tourner' : 'preparer', ...RESTE], { stdio: 'inherit' });
if (!TOURNER && r.status === 0) spawnSync('node', [BOUCLE, RACINE, 'lots'], { stdio: 'inherit' });
process.exit(r.status ?? 2);
