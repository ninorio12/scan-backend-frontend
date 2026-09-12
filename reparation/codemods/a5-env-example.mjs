#!/usr/bin/env node
/**
 * a5-env-example.mjs — déclarer les variables d'environnement que le code lit.
 *
 * Le plus simple des codemods, et celui qui rend le plus : une variable lue par le
 * code et absente de .env.example est une panne au prochain déploiement, sur une
 * machine qui n'est pas celle où ça marchait. Le nom est déjà écrit dans le code,
 * il n'y a rien à comprendre : c'est une écriture de fichier.
 *
 * Ce que le codemod ne fait PAS, et qu'il dit à la place : poser la valeur en
 * production. Écrire le nom dans .env.example ne remplit pas l'environnement du
 * serveur, et faire croire le contraire serait exactement le genre de fausse
 * réparation qu'on chasse.
 *
 *   node a5-env-example.mjs <repo> [--appliquer] [--json]
 */

import fs from 'node:fs';
import path from 'node:path';

const RACINE = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : '.');
const APPLIQUER = process.argv.includes('--appliquer');
const EXEMPLE = path.join(RACINE, '.env.example');

function fichiersDe(dir, base = dir, out = []) {
  let e; try { e = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const x of e) {
    if (['node_modules', '.next', '.git', 'dist', '.vercel', 'coverage'].includes(x.name) || x.name.startsWith('.')) continue;
    const p = path.join(dir, x.name);
    if (x.isDirectory()) fichiersDe(p, base, out);
    else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(x.name)) out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}

const lues = new Map();
for (const f of fichiersDe(RACINE)) {
  const txt = fs.readFileSync(path.join(RACINE, f), 'utf8');
  for (const m of txt.matchAll(/process\.env\.([A-Z0-9_]{3,})|process\.env\[["']([A-Z0-9_]{3,})["']\]/g)) {
    const nom = m[1] || m[2];
    if (!lues.has(nom)) lues.set(nom, []);
    lues.get(nom).push(`${f}:${txt.slice(0, m.index).split('\n').length}`);
  }
}

let exemple = '';
try { exemple = fs.readFileSync(EXEMPLE, 'utf8'); } catch { /* à créer */ }
const declarees = new Set([...exemple.matchAll(/^\s*#?\s*([A-Z0-9_]+)\s*=/gm)].map((m) => m[1]));

/* Celles que Node ou l'hébergeur fournissent : les déclarer serait du bruit. */
const FOURNIES = new Set(['NODE_ENV', 'PORT', 'VERCEL', 'VERCEL_ENV', 'VERCEL_URL', 'VERCEL_REGION', 'CI', 'npm_package_version', 'HOME', 'PATH', 'TZ']);

const manquantes = [...lues.entries()].filter(([n]) => !declarees.has(n) && !FOURNIES.has(n)).sort();

if (APPLIQUER && manquantes.length) {
  const bloc = [
    exemple.trim() ? '' : '# Variables lues par le code. Une ligne vide = à remplir avant déploiement.',
    '',
    `# Ajoutées par a5-env-example le ${new Date().toISOString().slice(0, 10)} :`,
    `# le nom est déclaré ici, la VALEUR reste à poser dans l'environnement du serveur.`,
    ...manquantes.map(([n, ou]) => `# lue par ${ou[0]}${ou.length > 1 ? ` (+${ou.length - 1})` : ''}\n${n}=`),
  ].join('\n');
  fs.writeFileSync(EXEMPLE, (exemple.trimEnd() + '\n' + bloc).trimStart() + '\n');
}

const rapport = {
  fichier: '.env.example',
  existait: Boolean(exemple),
  lues: lues.size, declarees: declarees.size,
  manquantes: manquantes.map(([n, ou]) => ({ nom: n, lueDepuis: ou.slice(0, 3), occurrences: ou.length })),
  rappel: "Déclarer le nom ne pose pas la valeur en production. La deuxième moitié du travail est hors du dépôt.",
  applique: APPLIQUER,
};

if (process.argv.includes('--json')) console.log(JSON.stringify(rapport, null, 2));
else {
  console.log(`\n╔══ Variables d'environnement ─ ${path.basename(RACINE)}`);
  console.log(`╚══ ${lues.size} lue(s) par le code · ${declarees.size} déclarée(s) · ${manquantes.length} manquante(s)\n`);
  for (const [n, ou] of manquantes) console.log(`      ${n.padEnd(34)} lue par ${ou[0]}${ou.length > 1 ? `  (+${ou.length - 1})` : ''}`);
  console.log(`\n  ⚠️  ${rapport.rappel}`);
  console.log(APPLIQUER ? `  écrit dans .env.example\n` : `  (à blanc — ajouter --appliquer pour écrire)\n`);
}
